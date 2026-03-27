async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function getWorkspace(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request(`/api/workspace${suffix}`);
}

export function parseCommand(command, options = {}) {
  return request("/api/command/parse", {
    method: "POST",
    body: JSON.stringify({
      command,
      topN: options.topN,
      delayMs: options.delayMs,
    }),
  });
}

export function startScanTask(payload = {}) {
  return request("/api/tasks/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startResearchTask(payload = {}) {
  return request("/api/tasks/research-refresh", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startPublishTask(payload = {}) {
  return request("/api/tasks/publish", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTask(id) {
  return request(`/api/tasks/${encodeURIComponent(id)}`);
}

export function subscribeTask(id, handlers = {}) {
  const source = new EventSource(`/api/tasks/${encodeURIComponent(id)}/events`);
  const events = ["created", "status", "task.start", "completed", "failed"];

  source.onopen = () => {
    handlers.onOpen?.();
  };

  events.forEach((eventName) => {
    source.addEventListener(eventName, (event) => {
      const payload = JSON.parse(event.data);
      handlers.onEvent?.(eventName, payload);
    });
  });

  source.onerror = () => {
    handlers.onError?.();
  };

  return source;
}

export function getResearch(params = {}) {
  const query = new URLSearchParams(params);
  return request(`/api/research?${query.toString()}`);
}

export function saveResearchNote(payload = {}) {
  return request("/api/research/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPlaybook(ticker) {
  return request(`/api/playbooks/${encodeURIComponent(ticker)}`);
}

export function savePlaybook(ticker, payload = {}) {
  return request(`/api/playbooks/${encodeURIComponent(ticker)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getJournal(date = "today") {
  const query = new URLSearchParams({ date });
  return request(`/api/journal?${query.toString()}`);
}

export function saveJournal(payload = {}) {
  return request("/api/journal", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addWatchlist(payload = {}) {
  return request("/api/watchlist", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWatchlist(ticker, payload = {}) {
  return request(`/api/watchlist/${encodeURIComponent(ticker)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function removeWatchlist(ticker) {
  return request(`/api/watchlist/${encodeURIComponent(ticker)}`, {
    method: "DELETE",
  });
}

export function getPrompt() {
  return request("/api/prompt");
}

export function getSingleScan(ticker) {
  return request(`/api/scan/${encodeURIComponent(ticker)}`);
}
