#!/usr/bin/env node
// Local development runner with hot reload:
// - Frontend changes: trigger browser reload via SSE.
// - Backend changes: restart server.js automatically, then reload browser.

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");

const ROOT = __dirname;
const SERVER_ENTRY = path.join(ROOT, "server.js");
const APP_PORT = Number(config.server?.port) || 3000;
const LIVE_RELOAD_PORT = Number(process.env.LIVE_RELOAD_PORT || APP_PORT + 1);

const WATCH_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".md"]);
const IGNORE_PREFIXES = [".git/", "node_modules/", "data/"];
const IGNORE_BASENAMES = new Set([".DS_Store"]);
const FRONTEND_PREFIXES = ["public/", "docs/"];

const clients = new Set();
let appProcess = null;
let shuttingDown = false;
let restarting = false;
let pendingRestartReason = null;
let restartDebounceTimer = null;
let reloadDebounceTimer = null;
let shouldReloadAfterRestart = false;
const watchedFiles = new Set();
let discoveryTimer = null;

function toPosixPath(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

function shouldIgnore(relativePath) {
  const rel = toPosixPath(relativePath).replace(/^\.\/+/, "");
  if (!rel || rel.startsWith("../")) return true;
  if (IGNORE_BASENAMES.has(path.basename(rel))) return true;
  return IGNORE_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix));
}

function hasWatchableExtension(relativePath) {
  return WATCH_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isFrontendPath(relativePath) {
  const rel = toPosixPath(relativePath).replace(/^\.\/+/, "");
  return FRONTEND_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix));
}

function broadcastReload(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of Array.from(clients)) {
    try {
      client.write(data);
    } catch (_) {
      clients.delete(client);
    }
  }
}

function queueReload(reason, file) {
  clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(() => {
    broadcastReload({
      type: "reload",
      reason,
      file,
      at: new Date().toISOString(),
    });
  }, 120);
}

function startLiveReloadServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${LIVE_RELOAD_PORT}`);

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({
        status: "ok",
        clients: clients.size,
        now: new Date().toISOString(),
      }));
      return;
    }

    res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    res.end("Not Found");
  });

  server.listen(LIVE_RELOAD_PORT, () => {
    console.log(`[dev] Live reload channel: http://localhost:${LIVE_RELOAD_PORT}/events`);
  });

  server.on("error", (error) => {
    console.error(`[dev] Live reload server error: ${error.message}`);
  });

  return server;
}

function startAppProcess() {
  appProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      SAIGON_DEV_RUNNER: "1",
    },
  });

  appProcess.on("exit", (code, signal) => {
    if (shuttingDown) return;

    if (restarting) {
      restarting = false;
      const reason = pendingRestartReason;
      pendingRestartReason = null;
      console.log(`[dev] Restarting app after backend change${reason ? ` (${reason})` : ""}...`);
      startAppProcess();
      if (shouldReloadAfterRestart) {
        shouldReloadAfterRestart = false;
        queueReload("backend", reason || "server restart");
      }
      return;
    }

    console.log(`[dev] App exited (code=${code ?? "null"}, signal=${signal ?? "none"}). Restarting in 600ms...`);
    setTimeout(() => {
      if (!shuttingDown) startAppProcess();
    }, 600);
  });
}

function requestBackendRestart(relativePath) {
  pendingRestartReason = relativePath;
  shouldReloadAfterRestart = true;

  if (restarting) return;
  restarting = true;

  if (appProcess && !appProcess.killed) {
    appProcess.kill("SIGTERM");
    setTimeout(() => {
      if (appProcess && !appProcess.killed) appProcess.kill("SIGKILL");
    }, 1500);
    return;
  }

  restarting = false;
  startAppProcess();
}

function onFileChange(relativePath) {
  if (shouldIgnore(relativePath)) return;
  if (!hasWatchableExtension(relativePath)) return;

  const rel = toPosixPath(relativePath).replace(/^\.\/+/, "");

  if (isFrontendPath(rel)) {
    console.log(`[dev] Frontend change: ${rel}`);
    queueReload("frontend", rel);
    return;
  }

  console.log(`[dev] Backend change: ${rel}`);
  clearTimeout(restartDebounceTimer);
  restartDebounceTimer = setTimeout(() => requestBackendRestart(rel), 140);
}

function listWatchableFiles(rootDir) {
  const files = [];

  function walk(current) {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = toPosixPath(path.relative(ROOT, full));
      if (shouldIgnore(rel)) continue;

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (entry.isFile() && hasWatchableExtension(rel)) {
        files.push(full);
      }
    }
  }

  walk(rootDir);
  return files;
}

function attachFileWatch(filePath) {
  if (watchedFiles.has(filePath)) return;
  watchedFiles.add(filePath);
  fs.watchFile(filePath, { interval: 350 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    onFileChange(path.relative(ROOT, filePath));
  });
}

function refreshFileWatchList() {
  const files = listWatchableFiles(ROOT);
  const discovered = new Set(files);

  for (const filePath of discovered) {
    attachFileWatch(filePath);
  }

  for (const watched of Array.from(watchedFiles)) {
    if (discovered.has(watched)) continue;
    fs.unwatchFile(watched);
    watchedFiles.delete(watched);
  }
}

function startProjectWatcher() {
  refreshFileWatchList();
  discoveryTimer = setInterval(refreshFileWatchList, 2000);
  console.log(`[dev] Watching ${watchedFiles.size} files (polling mode).`);
  return {
    close() {
      if (discoveryTimer) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
      }
      for (const filePath of Array.from(watchedFiles)) {
        fs.unwatchFile(filePath);
        watchedFiles.delete(filePath);
      }
    },
  };
}

function gracefulShutdown(reason, watcher, liveReloadServer) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev] ${reason} received. Shutting down...`);

  try {
    watcher?.close?.();
  } catch (_) {}

  try {
    liveReloadServer?.close?.();
  } catch (_) {}

  if (appProcess && !appProcess.killed) {
    appProcess.kill("SIGTERM");
    setTimeout(() => process.exit(0), 250);
    return;
  }

  process.exit(0);
}

const liveReloadServer = startLiveReloadServer();
const watcher = startProjectWatcher();
startAppProcess();

console.log(`[dev] App URL: http://localhost:${APP_PORT}`);

process.on("SIGINT", () => gracefulShutdown("SIGINT", watcher, liveReloadServer));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM", watcher, liveReloadServer));
