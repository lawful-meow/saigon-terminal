const { execFile } = require("child_process");

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function withTimeoutSignal(timeoutMs) {
  let timer = null;

  try {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup() {} };
  } catch (_) {
    const ac = new AbortController();
    timer = setTimeout(() => ac.abort(), timeoutMs);
    return {
      signal: ac.signal,
      cleanup() {
        if (timer) clearTimeout(timer);
      },
    };
  }
}

function sourceMeta(source = {}) {
  return {
    id: source.id || "remote_source",
    name: source.name || "Remote source",
    critical: source.critical !== false,
  };
}

function createSourceStatus(source, status, message, extra = {}) {
  const meta = sourceMeta(source);
  return {
    id: meta.id,
    name: meta.name,
    critical: meta.critical,
    status,
    message: String(message || "").trim() || null,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function buildHttpError(message, sourceStatus, extra = {}) {
  const error = new Error(message);
  error.sourceStatus = sourceStatus;
  Object.assign(error, extra);
  return error;
}

function errorCode(error) {
  return error?.cause?.code || error?.code || null;
}

function shouldFallbackToCurl(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;

  const code = errorCode(error);
  if (code && NETWORK_CODES.has(code)) return true;

  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("timed out") ||
    message.includes("socket") ||
    message.includes("tls")
  );
}

function parseJson(text, url, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw buildHttpError(
      `Invalid JSON from ${sourceMeta(source).name}: ${error.message} [${url.split("?")[0]}]`,
      createSourceStatus(source, "down", `Invalid JSON: ${error.message}`),
      { code: "INVALID_JSON" }
    );
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function curlJson(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
  const headers = options.headers || {};
  const source = options.source || {};
  const args = [
    "-sS",
    "--fail",
    "--location",
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "-A",
    headers["User-Agent"] || headers["user-agent"] || "SaigonTerminal/2.2",
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (/^user-agent$/i.test(key)) continue;
    args.push("-H", `${key}: ${value}`);
  }

  args.push(url);
  const command = ["curl", ...args.map((value) => shellQuote(value))].join(" ");

  return new Promise((resolve, reject) => {
    execFile(process.env.SHELL || "/bin/zsh", ["-lc", command], { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr || error.message || "curl failed";
        reject(buildHttpError(
          `${sourceMeta(source).name} curl fallback failed: ${detail.trim()}`,
          createSourceStatus(source, "down", detail.trim() || "curl fallback failed"),
          { code: error.code || "CURL_FAILED" }
        ));
        return;
      }

      try {
        const data = parseJson(stdout, url, source);
        resolve({
          data,
          meta: {
            transport: "curl",
            fallbackUsed: true,
            sourceStatus: createSourceStatus(source, "degraded", "Live request succeeded through curl fallback"),
          },
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function requestJson(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000);
  const headers = {
    "User-Agent": "SaigonTerminal/2.2",
    ...(options.headers || {}),
  };
  const source = options.source || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const curlImpl = options.curlImpl || curlJson;

  if (typeof fetchImpl !== "function") {
    throw buildHttpError(
      "Global fetch is unavailable in this runtime",
      createSourceStatus(source, "down", "Global fetch is unavailable"),
      { code: "FETCH_UNAVAILABLE" }
    );
  }

  const { signal, cleanup } = withTimeoutSignal(timeoutMs);

  try {
    const response = await fetchImpl(url, { headers, signal });
    cleanup();

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw buildHttpError(
        `${sourceMeta(source).name} HTTP ${response.status} [${url.split("?")[0]}]: ${body.slice(0, 160)}`,
        createSourceStatus(source, "down", `HTTP ${response.status}`),
        { code: `HTTP_${response.status}` }
      );
    }

    const text = await response.text();
    return {
      data: parseJson(text, url, source),
      meta: {
        transport: "fetch",
        fallbackUsed: false,
        sourceStatus: createSourceStatus(source, "ok", "Live request succeeded"),
      },
    };
  } catch (error) {
    cleanup();

    if (error?.sourceStatus) throw error;
    if (!shouldFallbackToCurl(error)) {
      throw buildHttpError(
        `${sourceMeta(source).name} request failed: ${error.message}`,
        createSourceStatus(source, "down", error.message || "request failed"),
        { code: errorCode(error) || "REQUEST_FAILED" }
      );
    }

    try {
      return await curlImpl(url, { timeoutMs, headers, source });
    } catch (curlError) {
      const fetchDetail = error.message || errorCode(error) || "fetch failed";
      const curlDetail = curlError.message || "curl fallback failed";
      throw buildHttpError(
        `${sourceMeta(source).name} request failed: ${fetchDetail}; fallback failed: ${curlDetail}`,
        createSourceStatus(source, "down", `${fetchDetail}; fallback failed`),
        { code: errorCode(error) || curlError.code || "REQUEST_FAILED" }
      );
    }
  }
}

module.exports = {
  requestJson,
  createSourceStatus,
  shouldFallbackToCurl,
};
