#!/usr/bin/env node
// HTTP server. REST API + static files.
// All heavy lifting delegated to engine.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const engine = require("./engine");
const { claudePrompt } = require("./formatter");
const publisher = require("./publisher");
const store = require("./store");
const watchlist = require("./watchlist");
const { parseCommand, PRESETS, buildHelpText } = require("./commands");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
  }[ext] || "text/plain";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
    res.end(data);
  });
}

function parseTickerList(input) {
  const parts = Array.isArray(input)
    ? input
    : String(input || "").split(/[\s,;\n\r\t]+/);

  const seen = new Set();
  const tickers = [];

  for (const part of parts) {
    const ticker = watchlist.normalizeTicker(part);
    if (!ticker) continue;
    if (ticker.length < 2 || ticker.length > 12) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }

  return tickers;
}

function createServer(port = config.server.port) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === "/api/scan" && req.method === "POST") {
        console.log("[scan] Starting full scan...");
        const { snapshot, errors } = await engine.scanAll({
          onProgress: ({ ticker, status, error }) => {
            console.log(`  ${status === "ok" ? "OK" : "ERR"} ${ticker}${error ? `: ${error}` : ""}`);
          },
        });
        console.log(`[scan] Done: ${snapshot.count} stocks, ${errors.length} errors`);
        return json(res, 200, { snapshot, errors });
      }

      if (pathname === "/api/scan/batch" && req.method === "POST") {
        const body = await readBody(req);
        let payload = {};
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch (error) {
            return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
          }
        }

        const tickers = parseTickerList(payload.tickers);
        if (!tickers.length) return json(res, 400, { error: "Provide at least one ticker" });
        if (tickers.length > 60) return json(res, 400, { error: "Batch scan is capped at 60 tickers per request" });

        const topN = Math.max(1, Math.min(20, Number(payload.topN) || 10));
        const delayMs = Math.max(250, Math.min(3000, Number(payload.delayMs) || 450));
        const existingMap = new Map(watchlist.getAll().map((stock) => [stock.ticker, stock]));
        const stocks = tickers.map((ticker) => existingMap.get(ticker) || {
          ticker,
          name: ticker,
          sector: "BATCH",
        });

        console.log(`[batch] Scanning ${stocks.length} tickers with ${delayMs}ms spacing, top ${topN}`);
        const { snapshot, errors } = await engine.scanAll({
          stocks,
          delayMs,
          persist: false,
          topN,
          scanMode: "batch_top_strength",
          onProgress: ({ ticker, status, error }) => {
            console.log(`  ${status === "ok" ? "OK" : "ERR"} ${ticker}${error ? `: ${error}` : ""}`);
          },
        });

        return json(res, 200, {
          snapshot,
          errors,
          inputCount: tickers.length,
          topN,
          delayMs,
        });
      }

      if (pathname === "/api/command/parse" && req.method === "POST") {
        const body = await readBody(req);
        let payload = {};
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch (error) {
            return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
          }
        }

        const result = parseCommand(payload.command, {
          topN: payload.topN,
          delayMs: payload.delayMs,
        });

        return json(res, 200, {
          result,
          presets: PRESETS,
          help: result.help || buildHelpText(),
        });
      }

      if (pathname === "/api/prompt" && req.method === "GET") {
        console.log("[prompt] Scanning + generating prompt...");
        const { prompt, snapshot, errors } = await engine.getClaudePrompt();
        console.log(`[prompt] Done: ${snapshot.count} stocks`);
        return json(res, 200, { prompt, snapshot, errors });
      }

      if (pathname === "/api/publish" && req.method === "POST") {
        const body = await readBody(req);
        let payload = {};

        if (body) {
          try {
            payload = JSON.parse(body);
          } catch (error) {
            return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
          }
        }

        let snapshot = payload.snapshot || null;
        let prompt = payload.prompt || null;

        if (!snapshot) {
          const generated = await engine.getClaudePrompt();
          snapshot = generated.snapshot;
          prompt = generated.prompt;
        } else if (!prompt) {
          prompt = claudePrompt(snapshot);
        }

        const result = publisher.publishSnapshot(snapshot, {
          prompt,
          selectedTicker: payload.selectedTicker,
        });

        return json(res, 200, result);
      }

      const singleMatch = pathname.match(/^\/api\/scan\/([A-Z0-9]{2,12})$/i);
      if (singleMatch && req.method === "GET") {
        const ticker = singleMatch[1];
        const stock = watchlist.getTicker(ticker);
        if (!stock) return json(res, 404, { error: `Ticker ${ticker} not in watchlist` });
        console.log(`[scan] ${ticker}...`);
        const snapshot = await engine.scanOne(stock);
        return json(res, 200, snapshot);
      }

      if (pathname === "/api/watchlist" && req.method === "GET") {
        const stocks = watchlist.getAll();
        return json(res, 200, { stocks, count: stocks.length });
      }

      if (pathname === "/api/watchlist" && req.method === "POST") {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch (error) {
          return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
        }

        const stocks = watchlist.add(payload);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      const watchlistMatch = pathname.match(/^\/api\/watchlist\/([A-Z0-9]{2,12})$/i);
      if (watchlistMatch && req.method === "PUT") {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch (error) {
          return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
        }

        const stocks = watchlist.update(watchlistMatch[1], payload);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      if (watchlistMatch && req.method === "DELETE") {
        const stocks = watchlist.remove(watchlistMatch[1]);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      if (pathname === "/api/history" && req.method === "GET") {
        return json(res, 200, engine.getAllHistory());
      }

      if (pathname === "/api/history" && req.method === "DELETE") {
        store.clear();
        return json(res, 200, { status: "cleared" });
      }

      const historyMatch = pathname.match(/^\/api\/history\/([A-Z]{2,6})$/);
      if (historyMatch && req.method === "GET") {
        const data = engine.getHistory(historyMatch[1]);
        return json(res, 200, data || { error: "No data" });
      }

      if (pathname === "/api/health" && req.method === "GET") {
        const stocks = watchlist.getAll();
        return json(res, 200, {
          status: "ok",
          engine: "Saigon Terminal v2.0",
          node: process.version,
          stocks: stocks.map((stock) => stock.ticker),
          time: new Date().toISOString(),
        });
      }

      if (pathname === "/api/test" && req.method === "GET") {
        console.log("[test] Testing VPS + KBS connectivity...");
        const results = {};
        const fetcher = require("./fetcher");

        try {
          const bars = await fetcher.ohlcv("FPT");
          const last = bars[bars.length - 1];
          const lastClose = last ? Math.round(last.close > 1000 ? last.close : last.close * 1000) : null;
          results.ohlcv = { status: "ok", bars: bars.length, lastClose, lastDate: last?.date || last?.tradingDate };
          console.log(`  OK OHLCV: ${bars.length} bars, close=${lastClose}`);
        } catch (error) {
          results.ohlcv = { status: "error", message: error.message };
          console.log(`  ERR OHLCV: ${error.message}`);
        }

        try {
          const overview = await fetcher.overview("FPT");
          results.overview = {
            status: "ok",
            pe: overview.pe,
            eps: overview.epsTTM || overview.eps,
            roe: overview.roe,
            epsGrowthQoQ: overview.epsGrowthQoQ,
            epsGrowth1Y: overview.epsGrowth1Y,
            institutionScore: overview.institutionScore,
            source: overview._source,
            keys: Object.keys(overview).slice(0, 12),
          };
          console.log(`  OK Overview: source=${overview._source}`);
        } catch (error) {
          results.overview = { status: "error", message: error.message };
          console.log(`  ERR Overview: ${error.message}`);
        }

        try {
          const foreign = await fetcher.foreign("FPT");
          results.foreign = { status: "ok", records: foreign?.data?.length || 0 };
          console.log(`  OK Foreign: ${foreign?.data?.length || 0} records`);
        } catch (error) {
          results.foreign = { status: "error", message: error.message };
          console.log(`  ERR Foreign: ${error.message}`);
        }

        const allOk = Object.values(results).every((result) => result.status === "ok");
        return json(res, allOk ? 200 : 502, {
          node: process.version,
          source: `${config.sources.primary}+kbs`,
          results,
        });
      }

      if ((pathname === "/docs" || pathname === "/docs/") && req.method === "GET") {
        return serveFile(res, path.join(__dirname, "docs", "index.html"));
      }

      if (pathname.startsWith("/docs/") && req.method === "GET") {
        const requested = path.normalize(pathname.slice("/docs/".length));
        const docsRoot = path.join(__dirname, "docs");
        const target = path.join(docsRoot, requested);
        if (!target.startsWith(docsRoot)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        return serveFile(res, target);
      }

      const filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
      serveFile(res, filePath);
    } catch (error) {
      console.error(`[ERROR] ${req.method} ${pathname}:`, error.message);
      json(res, 500, { error: error.message });
    }
  });
}

function logStartup(port) {
  const stocks = watchlist.getAll();
  console.log("");
  console.log("  ========================================");
  console.log("  Saigon Terminal v2.0");
  console.log("  Board-First Desk Monitor");
  console.log("  ========================================");
  console.log(`  URL: http://localhost:${port}`);
  console.log(`  Universe: ${stocks.map((stock) => stock.ticker).join(", ")}`);
  console.log("  Feed: VPS market + KBS enrich");
  console.log("  Endpoints:");
  console.log("    POST /api/scan");
  console.log("    POST /api/scan/batch");
  console.log("    GET  /api/prompt");
  console.log("    GET  /api/scan/FPT");
  console.log("    GET  /api/watchlist");
  console.log("    GET  /api/history");
  console.log("");
}

if (require.main === module) {
  const port = config.server.port;
  const server = createServer(port);
  server.listen(port, () => logStartup(port));
}

module.exports = {
  createServer,
  parseTickerList,
};
