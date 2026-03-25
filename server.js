#!/usr/bin/env node
// ─── server.js ─────────────────────────────────────────────────────────────────
// HTTP server. REST API + static files.
// All heavy lifting delegated to engine.js.
// ────────────────────────────────────────────────────────────────────────────────

const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const engine = require("./engine");
const { claudePrompt } = require("./formatter");
const publisher = require("./publisher");
const store = require("./store");

const PORT = config.server.port;

// ── Helpers ──

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" }[ext] || "text/plain";
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
    res.end(data);
  });
}

// ── Server ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  try {
    // ── POST /api/scan — scan all stocks, return snapshot + prompt ──
    if (p === "/api/scan" && req.method === "POST") {
      console.log("[scan] Starting full scan...");
      const { snapshot, errors } = await engine.scanAll({
        onProgress: ({ ticker, status, error }) => {
          console.log(`  ${status === "ok" ? "✅" : "❌"} ${ticker}${error ? ": " + error : ""}`);
        },
      });
      console.log(`[scan] Done: ${snapshot.count} stocks, ${errors.length} errors`);
      return json(res, 200, { snapshot, errors });
    }

    // ── GET /api/prompt — scan all + return Claude-ready prompt ──
    if (p === "/api/prompt" && req.method === "GET") {
      console.log("[prompt] Scanning + generating prompt...");
      const { prompt, snapshot, errors } = await engine.getClaudePrompt();
      console.log(`[prompt] Done: ${snapshot.count} stocks`);
      return json(res, 200, { prompt, snapshot, errors });
    }

    // ── POST /api/publish — write docs/index.html for GitHub Pages ──
    if (p === "/api/publish" && req.method === "POST") {
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

    // ── GET /api/scan/:ticker — scan single ticker ──
    const singleMatch = p.match(/^\/api\/scan\/([A-Z]{2,6})$/);
    if (singleMatch && req.method === "GET") {
      const ticker = singleMatch[1];
      const stock = config.stocks.find((s) => s.ticker === ticker);
      if (!stock) return json(res, 404, { error: `Ticker ${ticker} not in watchlist` });
      console.log(`[scan] ${ticker}...`);
      const snapshot = await engine.scanOne(stock);
      return json(res, 200, snapshot);
    }

    // ── GET /api/history — all stored history ──
    if (p === "/api/history") {
      return json(res, 200, engine.getAllHistory());
    }

    // ── GET /api/history/:ticker ──
    const histMatch = p.match(/^\/api\/history\/([A-Z]{2,6})$/);
    if (histMatch) {
      const data = engine.getHistory(histMatch[1]);
      return json(res, 200, data || { error: "No data" });
    }

    // ── DELETE /api/history — clear all ──
    if (p === "/api/history" && req.method === "DELETE") {
      store.clear();
      return json(res, 200, { status: "cleared" });
    }

    // ── GET /api/health ──
    if (p === "/api/health") {
      return json(res, 200, {
        status: "ok",
        engine: "Saigon Terminal v2.0",
        node: process.version,
        stocks: config.stocks.map((s) => s.ticker),
        time: new Date().toISOString(),
      });
    }

    // ── GET /api/test — test market + enrichment connectivity ──
    if (p === "/api/test") {
      console.log("[test] Testing VPS + KBS connectivity...");
      const results = {};
      const fetcher = require("./fetcher");

      // Test OHLCV
      try {
        const bars = await fetcher.ohlcv("FPT");
        const last = bars[bars.length - 1];
        const lastClose = last ? Math.round(last.close > 1000 ? last.close : last.close * 1000) : null;
        results.ohlcv = { status: "ok", bars: bars.length, lastClose, lastDate: last?.date || last?.tradingDate };
        console.log(`  ✅ OHLCV: ${bars.length} bars, close=${lastClose}`);
      } catch (e) {
        results.ohlcv = { status: "error", message: e.message };
        console.log(`  ❌ OHLCV: ${e.message}`);
      }

      // Test Overview / enrichment
      try {
        const ov = await fetcher.overview("FPT");
        results.overview = {
          status: "ok",
          pe: ov.pe,
          eps: ov.epsTTM || ov.eps,
          roe: ov.roe,
          epsGrowthQoQ: ov.epsGrowthQoQ,
          epsGrowth1Y: ov.epsGrowth1Y,
          institutionScore: ov.institutionScore,
          source: ov._source,
          keys: Object.keys(ov).slice(0, 12),
        };
        console.log(`  ✅ Overview: source=${ov._source}`);
      } catch (e) {
        results.overview = { status: "error", message: e.message };
        console.log(`  ❌ Overview: ${e.message}`);
      }

      // Test Foreign
      try {
        const ff = await fetcher.foreign("FPT");
        results.foreign = { status: "ok", records: ff?.data?.length || 0 };
        console.log(`  ✅ Foreign: ${ff?.data?.length || 0} records`);
      } catch (e) {
        results.foreign = { status: "error", message: e.message };
        console.log(`  ❌ Foreign: ${e.message}`);
      }

      const allOk = Object.values(results).every(r => r.status === "ok");
      return json(res, allOk ? 200 : 502, { node: process.version, source: `${config.sources.primary}+kbs`, results });
    }

    // ── Static files ──
    if ((p === "/docs" || p === "/docs/") && req.method === "GET") {
      return serveFile(res, path.join(__dirname, "docs", "index.html"));
    }

    if (p.startsWith("/docs/") && req.method === "GET") {
      const requested = path.normalize(p.slice("/docs/".length));
      const docsRoot = path.join(__dirname, "docs");
      const target = path.join(docsRoot, requested);
      if (!target.startsWith(docsRoot)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      return serveFile(res, target);
    }

    const fp = path.join(__dirname, "public", p === "/" ? "index.html" : p);
    serveFile(res, fp);
  } catch (err) {
    console.error(`[ERROR] ${req.method} ${p}:`, err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ┌──────────────────────────────────────┐");
  console.log("  │      SAIGON TERMINAL v2.0             │");
  console.log("  │      Board-First Desk Monitor         │");
  console.log("  ├──────────────────────────────────────┤");
  console.log(`  │  URL: http://localhost:${PORT}             │`);
  console.log(`  │  Universe: ${config.stocks.map((s) => s.ticker).join(", ")} │`);
  console.log("  │  Feed: VPS market + KBS enrich      │");
  console.log("  ├──────────────────────────────────────┤");
  console.log("  │  Endpoints:                          │");
  console.log("  │  POST /api/scan     → scan all       │");
  console.log("  │  GET  /api/prompt   → prompt export   │");
  console.log("  │  GET  /api/scan/FPT → scan one        │");
  console.log("  │  GET  /api/history  → stored data     │");
  console.log("  └──────────────────────────────────────┘");
  console.log("");
});
