// ─── store.js ──────────────────────────────────────────────────────────────────
// Persistence layer. JSON file, simple read/write.
// Stores scan history per ticker. Auto-trims to maxScansPerTicker.
// Swap to SQLite/Postgres later by keeping the same interface.
// ────────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const config = require("./config");

const MAX = config.store.maxScansPerTicker;

function storePath() {
  const override = process.env.SAIGON_STORE_PATH;
  return path.resolve(__dirname, override || config.store.path);
}

function ensureDir() {
  const dir = path.dirname(storePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  const target = storePath();
  if (!fs.existsSync(target)) return {};
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (e) {
    console.error("[store] corrupt file, resetting:", e.message);
    return {};
  }
}

function save(data) {
  ensureDir();
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), "utf8");
}

// ── Public interface ──

function getAll() {
  return load();
}

function getTicker(ticker) {
  const db = load();
  return db[ticker] || null;
}

function getLatest(ticker) {
  const entry = getTicker(ticker);
  if (!entry || !entry.scans.length) return null;
  return entry.scans[entry.scans.length - 1];
}

function addScan(ticker, scanData, meta = {}) {
  const db = load();

  if (!db[ticker]) {
    db[ticker] = { ticker, scans: [], meta: {} };
  }

  const scan = {
    id: db[ticker].scans.length + 1,
    timestamp: new Date().toISOString(),
    ...scanData,
  };

  db[ticker].scans.push(scan);
  db[ticker].meta = { ...db[ticker].meta, ...meta };
  db[ticker].lastScan = scan.timestamp;

  // Trim old scans
  if (db[ticker].scans.length > MAX) {
    db[ticker].scans = db[ticker].scans.slice(-MAX);
  }

  save(db);
  return scan;
}

function clear() {
  save({});
}

function expectedRunCount(universeKey) {
  if (!universeKey) return null;
  return universeKey
    .split("|")
    .map((ticker) => ticker.trim())
    .filter(Boolean)
    .length || null;
}

function getPreviousRunStocks({ currentRunId, scanMode, universeKey } = {}) {
  const db = load();
  const runs = new Map();
  const expectedCount = expectedRunCount(universeKey);

  for (const entry of Object.values(db)) {
    for (const scan of entry.scans || []) {
      const runId = scan.scanRunId;
      if (!runId || runId === currentRunId) continue;
      if (scanMode && scan._scanMode !== scanMode) continue;
      if (universeKey && scan._scanUniverseKey !== universeKey) continue;

      if (!runs.has(runId)) {
        runs.set(runId, {
          runId,
          timestamp: scan.scanTime || scan.timestamp || "",
          stocks: [],
        });
      }

      const run = runs.get(runId);
      run.stocks.push(scan);
      const stamp = scan.scanTime || scan.timestamp || "";
      if (stamp > run.timestamp) run.timestamp = stamp;
    }
  }

  return Array.from(runs.values())
    .filter((run) => {
      if (!expectedCount) return run.stocks.length > 0;
      const uniqueTickers = new Set(run.stocks.map((stock) => stock.ticker));
      return uniqueTickers.size === expectedCount;
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0]
    ?.stocks || null;
}

module.exports = {
  getAll,
  getTicker,
  getLatest,
  addScan,
  clear,
  getPreviousRunStocks,
};
