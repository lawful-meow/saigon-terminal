#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const store = require("./store");
const watchlist = require("./watchlist");
const fetcher = require("./fetcher");
const { claudePrompt } = require("./formatter");
const publisher = require("./publisher");
const { parseCommand, PRESETS, buildHelpText } = require("./commands");
const scanService = require("./services/scan-service");
const researchService = require("./services/research-service");
const playbookService = require("./services/playbook-service");
const journalService = require("./services/journal-service");
const taskService = require("./services/task-service");
const workspaceService = require("./services/workspace-service");

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

async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
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

function badJson(res, error) {
  return json(res, 400, { error: `Invalid JSON body: ${error.message}` });
}

function normalizeTaskPayload(payload = {}) {
  return {
    topN: Math.max(1, Math.min(20, Number(payload.topN) || 10)),
    delayMs: Math.max(250, Math.min(3000, Number(payload.delayMs) || 450)),
    tickers: scanService.parseTickerList(payload.tickers),
  };
}

function safePrompt(snapshot, fallback = "") {
  try {
    return claudePrompt(snapshot);
  } catch (_) {
    return fallback;
  }
}

function createServer(port = config.server.port) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === "/api/workspace" && req.method === "GET") {
        return json(res, 200, workspaceService.getWorkspace({
          view: url.searchParams.get("view") || "home",
          ticker: url.searchParams.get("ticker"),
          window: url.searchParams.get("window") || "7d",
          date: url.searchParams.get("date") || "today",
        }));
      }

      if (pathname === "/api/tasks/scan" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const normalized = normalizeTaskPayload(payload);
        const mode = String(payload.mode || "watchlist").toLowerCase();
        const task = taskService.createTask("scan", async (ctx) => {
          ctx.log("task.start", { type: "scan", mode });
          ctx.progress(5, "preparing scan");

          let result;
          if (mode === "vn30") {
            let processed = 0;
            result = await scanService.scanVN30({
              topN: normalized.topN,
              delayMs: normalized.delayMs,
              onProgress: () => {
                processed += 1;
                ctx.progress(10 + Math.round((processed / 30) * 75), `scanning VN30 (${processed})`);
              },
            });
          } else if (mode === "batch") {
            const total = normalized.tickers.length;
            let processed = 0;
            result = await scanService.scanBatch(normalized.tickers, {
              topN: normalized.topN,
              delayMs: normalized.delayMs,
              onProgress: () => {
                processed += 1;
                ctx.progress(10 + Math.round((processed / Math.max(total, 1)) * 75), `batch scan ${processed}/${total}`);
              },
            });
          } else {
            const total = watchlist.getAll().length;
            let processed = 0;
            result = await scanService.scanWatchlist({
              onProgress: () => {
                processed += 1;
                ctx.progress(10 + Math.round((processed / Math.max(total, 1)) * 75), `scan ${processed}/${total}`);
              },
            });
          }

          const warnings = [];
          if (Array.isArray(result?.errors) && result.errors.length) {
            const warning = `${result.errors.length} tickers failed during the last scan`;
            ctx.warn(warning);
            warnings.push(warning);
          }
          if (!result?.snapshot?.stocks?.length) {
            throw new Error("Scan failed; no rows were loaded. The last successful workspace is still available if one exists.");
          }

          ctx.progress(95, "finalizing snapshot", {
            warnings,
            resultRef: { type: "snapshot", selectedTicker: payload.selectedTicker || result.snapshot?.stocks?.[0]?.ticker || null },
          });
          return {
            warnings,
            resultRef: { type: "snapshot", selectedTicker: payload.selectedTicker || result.snapshot?.stocks?.[0]?.ticker || null },
          };
        }, {
          initialStep: "queued scan",
          meta: { mode, payload },
        });

        return json(res, 202, task);
      }

      if (pathname === "/api/tasks/research-refresh" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const task = taskService.createTask("research-refresh", async (ctx) => {
          const workspace = workspaceService.getWorkspace({
            ticker: payload.ticker,
            window: payload.window || "7d",
            view: "research",
          });
          if (!workspace.focusTicker || !workspace.snapshotMeta?.generated) {
            throw new Error("Research refresh requires a successful scan first");
          }

          ctx.progress(10, `refreshing research for ${workspace.focusTicker}`);
          const result = await researchService.refreshResearch({
            ticker: workspace.focusTicker,
            window: payload.window || "7d",
            snapshot: {
              generated: workspace.snapshotMeta.generated,
              market: workspace.market,
              stocks: workspace.boardRows,
              alerts: { items: workspace.alerts },
              smartLists: workspace.smartLists,
            },
          });
          const warnings = (result.errors || []).map((entry) => entry?.source ? `${entry.source}: ${entry.error}` : String(entry?.error || entry));
          ctx.progress(95, "research refreshed", {
            warnings,
            resultRef: { type: "research", ticker: workspace.focusTicker },
          });
          return {
            warnings,
            resultRef: { type: "research", ticker: workspace.focusTicker },
            result,
          };
        }, {
          initialStep: "queued research refresh",
          meta: { payload },
        });

        return json(res, 202, task);
      }

      if (pathname === "/api/tasks/publish" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const task = taskService.createTask("publish", async (ctx) => {
          ctx.progress(10, "preparing publish payload");

          const latestRecord = scanService.getLatestSnapshotRecord();
          let snapshot = payload.snapshot || latestRecord?.snapshot || null;
          let prompt = payload.prompt || "";

          if (!snapshot) {
            throw new Error("Publish requires a successful workspace snapshot; run scan first");
          } else if (!prompt) {
            prompt = safePrompt(snapshot, "");
          }

          scanService.persistLatestSnapshot(snapshot, {
            source: "publish_task",
            mode: snapshot.scanMode,
            selectedTicker: payload.selectedTicker || snapshot?.stocks?.[0]?.ticker || null,
          });

          const workspace = workspaceService.buildWorkspaceSnapshotFromSnapshot(snapshot, {
            view: "publish",
            ticker: payload.selectedTicker,
            selectedTicker: payload.selectedTicker || snapshot?.stocks?.[0]?.ticker || null,
          });

          ctx.progress(80, "writing static files");
          const result = publisher.publishSnapshot(snapshot, {
            prompt,
            selectedTicker: payload.selectedTicker,
            workspace,
          });

          ctx.progress(95, "publish completed", {
            resultRef: { type: "publish", previewPath: result.previewPath },
          });
          return { resultRef: { type: "publish", previewPath: result.previewPath }, result };
        }, {
          initialStep: "queued publish",
          meta: { payload },
        });

        return json(res, 202, task);
      }

      const taskEventsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
      if (taskEventsMatch && req.method === "GET") {
        return taskService.subscribe(taskEventsMatch[1], req, res);
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && req.method === "GET") {
        const task = taskService.getTask(taskMatch[1]);
        if (!task) return json(res, 404, { error: "Task not found" });
        return json(res, 200, task);
      }

      if (pathname === "/api/research" && req.method === "GET") {
        const workspace = workspaceService.getWorkspace({
          ticker: url.searchParams.get("ticker"),
          window: url.searchParams.get("window") || "7d",
          view: "research",
        });
        return json(res, 200, workspace.research);
      }

      if (pathname === "/api/research/notes" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }
        return json(res, 200, researchService.appendOperatorNote(payload));
      }

      const playbookMatch = pathname.match(/^\/api\/playbooks\/([A-Z0-9]{2,12})$/i);
      if (playbookMatch && req.method === "GET") {
        const workspace = workspaceService.getWorkspace({
          ticker: playbookMatch[1],
          view: "playbook",
        });
        return json(res, 200, workspace.playbook);
      }

      if (playbookMatch && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const workspace = workspaceService.getWorkspace({
          ticker: playbookMatch[1],
          view: "playbook",
        });
        const snapshot = workspace.market ? {
          generated: workspace.snapshotMeta.generated,
          market: workspace.market,
          stocks: workspace.boardRows,
          alerts: { items: workspace.alerts },
          smartLists: workspace.smartLists,
        } : null;

        return json(res, 200, playbookService.savePlaybook(playbookMatch[1], payload, { snapshot }));
      }

      if (pathname === "/api/journal" && req.method === "GET") {
        const date = url.searchParams.get("date") || "today";
        return json(res, 200, {
          date: journalService.normalizeDate(date),
          entries: journalService.getEntries(date),
        });
      }

      if (pathname === "/api/journal" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }
        return json(res, 200, journalService.addEntry(payload));
      }

      if (pathname === "/api/scan" && req.method === "POST") {
        const result = await scanService.scanWatchlist();
        const record = scanService.getLatestSnapshotRecord();
        return json(res, 200, {
          snapshot: record?.snapshot || result.snapshot,
          errors: result.errors,
          warnings: record?.lastAttemptDiagnostics?.warnings || [],
          sourceHealth: record?.lastAttemptDiagnostics?.sourceHealth || [],
          stale: !!record?.lastAttemptDiagnostics && (!record.lastAttemptDiagnostics.succeeded || record.lastAttemptDiagnostics.stale),
        });
      }

      if (pathname === "/api/scan/batch" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const normalized = normalizeTaskPayload(payload);
        if (!normalized.tickers.length) return json(res, 400, { error: "Provide at least one ticker" });
        if (normalized.tickers.length > 60) return json(res, 400, { error: "Batch scan is capped at 60 tickers per request" });

        const result = await scanService.scanBatch(normalized.tickers, {
          topN: normalized.topN,
          delayMs: normalized.delayMs,
        });
        const record = scanService.getLatestSnapshotRecord();

        return json(res, 200, {
          snapshot: record?.snapshot || result.snapshot,
          errors: result.errors,
          warnings: record?.lastAttemptDiagnostics?.warnings || [],
          sourceHealth: record?.lastAttemptDiagnostics?.sourceHealth || [],
          stale: !!record?.lastAttemptDiagnostics && (!record.lastAttemptDiagnostics.succeeded || record.lastAttemptDiagnostics.stale),
          inputCount: normalized.tickers.length,
          topN: normalized.topN,
          delayMs: normalized.delayMs,
        });
      }

      if (pathname === "/api/universe/vn30" && req.method === "GET") {
        const tickers = await fetcher.indexComponents("VN30");
        return json(res, 200, {
          index: "VN30",
          tickers,
          count: tickers.length,
          source: "vps_getlistckindex",
        });
      }

      if (pathname === "/api/scan/vn30" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const normalized = normalizeTaskPayload(payload);
        const result = await scanService.scanVN30({
          topN: normalized.topN,
          delayMs: normalized.delayMs,
        });
        const record = scanService.getLatestSnapshotRecord();

        return json(res, 200, {
          index: "VN30",
          source: "vps_getlistckindex",
          universeTickers: result.universeTickers,
          universeCount: result.universeCount,
          snapshot: record?.snapshot || result.snapshot,
          errors: result.errors,
          warnings: record?.lastAttemptDiagnostics?.warnings || [],
          sourceHealth: record?.lastAttemptDiagnostics?.sourceHealth || [],
          stale: !!record?.lastAttemptDiagnostics && (!record.lastAttemptDiagnostics.succeeded || record.lastAttemptDiagnostics.stale),
          topN: normalized.topN,
          delayMs: normalized.delayMs,
        });
      }

      if (pathname === "/api/command/parse" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
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
        const record = scanService.getLatestSnapshotRecord();
        const snapshot = record?.snapshot || null;
        if (!snapshot) {
          return json(res, 409, { error: "Prompt generation requires a successful workspace snapshot; run scan first" });
        }
        return json(res, 200, {
          prompt: claudePrompt(snapshot),
          snapshot,
          errors: record?.errors || [],
        });
      }

      if (pathname === "/api/publish" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }

        const latestRecord = scanService.getLatestSnapshotRecord();
        let snapshot = payload.snapshot || latestRecord?.snapshot || null;
        let prompt = payload.prompt || "";

        if (!snapshot) {
          return json(res, 409, { error: "Publish requires a successful workspace snapshot; run scan first" });
        } else if (!prompt) {
          prompt = safePrompt(snapshot, "");
        }

        scanService.persistLatestSnapshot(snapshot, {
          source: "publish_route",
          mode: snapshot.scanMode,
          selectedTicker: payload.selectedTicker || snapshot?.stocks?.[0]?.ticker || null,
          prompt,
        });

        const workspace = workspaceService.buildWorkspaceSnapshotFromSnapshot(snapshot, {
          view: "publish",
          ticker: payload.selectedTicker,
          selectedTicker: payload.selectedTicker || snapshot?.stocks?.[0]?.ticker || null,
        });

        return json(res, 200, publisher.publishSnapshot(snapshot, {
          prompt,
          selectedTicker: payload.selectedTicker,
          workspace,
        }));
      }

      const singleMatch = pathname.match(/^\/api\/scan\/([A-Z0-9]{2,12})$/i);
      if (singleMatch && req.method === "GET") {
        const ticker = singleMatch[1];
        const stock = watchlist.getTicker(ticker);
        if (!stock) return json(res, 404, { error: `Ticker ${ticker} not in watchlist` });
        return json(res, 200, await scanService.scanOneByTicker(ticker));
      }

      if (pathname === "/api/watchlist" && req.method === "GET") {
        const stocks = watchlist.getAll();
        return json(res, 200, { stocks, count: stocks.length });
      }

      if (pathname === "/api/watchlist" && req.method === "POST") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }
        const stocks = watchlist.add(payload);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      const watchlistMatch = pathname.match(/^\/api\/watchlist\/([A-Z0-9]{2,12})$/i);
      if (watchlistMatch && req.method === "PUT") {
        let payload = {};
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          return badJson(res, error);
        }
        const stocks = watchlist.update(watchlistMatch[1], payload);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      if (watchlistMatch && req.method === "DELETE") {
        const stocks = watchlist.remove(watchlistMatch[1]);
        return json(res, 200, { status: "ok", stocks, count: stocks.length });
      }

      if (pathname === "/api/history" && req.method === "GET") {
        return json(res, 200, store.getAll());
      }

      if (pathname === "/api/history" && req.method === "DELETE") {
        store.clear();
        return json(res, 200, { status: "cleared" });
      }

      const historyMatch = pathname.match(/^\/api\/history\/([A-Z]{2,6})$/);
      if (historyMatch && req.method === "GET") {
        const data = store.getTicker(historyMatch[1]);
        return json(res, 200, data || { error: "No data" });
      }

      if (pathname === "/api/health" && req.method === "GET") {
        const stocks = watchlist.getAll();
        return json(res, 200, {
          status: "ok",
          engine: "Saigon Terminal vNext",
          node: process.version,
          stocks: stocks.map((stock) => stock.ticker),
          time: new Date().toISOString(),
        });
      }

      if (pathname === "/api/test" && req.method === "GET") {
        const results = {};

        try {
          const bars = await fetcher.ohlcv("FPT");
          const last = bars[bars.length - 1];
          const lastClose = last ? Math.round(last.close > 1000 ? last.close : last.close * 1000) : null;
          results.ohlcv = { status: "ok", bars: bars.length, lastClose, lastDate: last?.date || last?.tradingDate };
        } catch (error) {
          results.ohlcv = { status: "error", message: error.message };
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
          };
        } catch (error) {
          results.overview = { status: "error", message: error.message };
        }

        try {
          const foreign = await fetcher.foreign("FPT");
          results.foreign = { status: "ok", records: foreign?.data?.length || 0 };
        } catch (error) {
          results.foreign = { status: "error", message: error.message };
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
      return serveFile(res, filePath);
    } catch (error) {
      console.error(`[ERROR] ${req.method} ${pathname}:`, error.message);
      return json(res, 500, { error: error.message });
    }
  });
}

function logStartup(port) {
  const stocks = watchlist.getAll();
  console.log("");
  console.log("  ========================================");
  console.log("  Saigon Terminal vNext");
  console.log("  AI-Free Trading War Hub");
  console.log("  ========================================");
  console.log(`  URL: http://localhost:${port}`);
  console.log(`  Universe: ${stocks.map((stock) => stock.ticker).join(", ")}`);
  console.log("  Core: VPS market + KBS enrich + local research/playbooks/journal");
  console.log("  Endpoints:");
  console.log("    GET  /api/workspace");
  console.log("    POST /api/tasks/scan");
  console.log("    POST /api/tasks/research-refresh");
  console.log("    POST /api/tasks/publish");
  console.log("    GET  /api/research?ticker=FPT");
  console.log("    GET  /api/playbooks/FPT");
  console.log("    GET  /api/journal");
  console.log("    POST /api/scan");
  console.log("    POST /api/publish");
  console.log("");
}

if (require.main === module) {
  const port = config.server.port;
  const server = createServer(port);
  server.listen(port, () => logStartup(port));
}

module.exports = {
  createServer,
  parseTickerList: scanService.parseTickerList,
};
