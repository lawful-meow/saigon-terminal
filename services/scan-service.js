const path = require("path");
const config = require("../config");
const engine = require("../engine");
const fetcher = require("../fetcher");
const watchlist = require("../watchlist");
const { readJson, writeJson, resolveProjectPath } = require("./file-store");
const { createSourceHealthRow, mergeSourceHealth } = require("./source-health");

function workspacePath() {
  return resolveProjectPath(process.env.SAIGON_WORKSPACE_PATH || config.store.workspacePath || "./data/workspace.json");
}

function docsSnapshotPath() {
  const docsRoot = path.resolve(__dirname, "..", process.env.SAIGON_DOCS_DIR || "docs");
  return path.join(docsRoot, "snapshot.json");
}

function normalizeTicker(value) {
  return watchlist.normalizeTicker(value);
}

function parseTickerList(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || "").split(/[\s,;\n\r\t]+/);

  const tickers = [];
  const seen = new Set();

  for (const value of values) {
    const ticker = normalizeTicker(value);
    if (!ticker || ticker.length < 2 || ticker.length > 12 || seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }

  return tickers;
}

function buildStocksFromTickers(tickers, defaultSector = "USER") {
  const existing = new Map(watchlist.getAll().map((stock) => [stock.ticker, stock]));
  return tickers.map((ticker) => existing.get(ticker) || {
    ticker,
    name: ticker,
    sector: defaultSector,
  });
}

function uniqStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeErrorEntry(entry = {}) {
  return {
    ticker: entry.ticker || null,
    error: String(entry.error || "Unknown scan error"),
    sourceStatus: entry.sourceStatus ? createSourceHealthRow(entry.sourceStatus) : null,
    warnings: uniqStrings(entry.warnings || []),
  };
}

function fallbackSourceHealthFromSnapshot(snapshot) {
  const stock = snapshot?.stocks?.[0] || null;
  const sourceFlags = stock?.quality?.sourceFlags || {};
  const snapshotOverlayUsed = stock?.quality?.snapshotOverlayUsed !== false;

  if (!snapshot) return [];

  return [
    createSourceHealthRow({
      id: "vps_history",
      name: "VPS history",
      critical: true,
      status: snapshot.count > 0 ? "ok" : "degraded",
      message: snapshot.count > 0 ? "Board prices loaded from VPS history" : "No rows were loaded from VPS history",
    }),
    createSourceHealthRow({
      id: "vps_snapshot",
      name: "VPS snapshot",
      critical: false,
      status: snapshotOverlayUsed ? "ok" : "degraded",
      message: snapshotOverlayUsed
        ? "Snapshot overlay is augmenting the latest bar"
        : "Using VPS history only; snapshot overlay unavailable",
    }),
    createSourceHealthRow({
      id: "kbs_finance",
      name: "KBS finance",
      critical: false,
      status: String(sourceFlags.fundamentals || "").includes("unavailable") ? "degraded" : "ok",
      message: String(sourceFlags.fundamentals || "").includes("unavailable")
        ? "Finance enrichment unavailable; board is running VPS-only"
        : "Finance enrichment available",
    }),
    createSourceHealthRow({
      id: "kbs_profile",
      name: "KBS profile",
      critical: false,
      status: "degraded",
      message: "KBS profile endpoint is quarantined",
    }),
  ];
}

function aggregateSourceHealth(snapshot, errors = [], extra = []) {
  const fromStocks = (snapshot?.stocks || []).flatMap((stock) => stock?.quality?.sourceHealth || []);
  const fromFallback = fromStocks.length ? [] : fallbackSourceHealthFromSnapshot(snapshot);
  const fromErrors = errors
    .map(normalizeErrorEntry)
    .map((entry) => entry.sourceStatus)
    .filter(Boolean);

  return mergeSourceHealth(extra, fromStocks, fromFallback, fromErrors);
}

function scanSucceeded(snapshot) {
  return Boolean(snapshot && Array.isArray(snapshot.stocks) && snapshot.stocks.length > 0);
}

function normalizeRecord(record) {
  if (!record) return null;

  if (record.snapshot || record.lastAttemptDiagnostics) {
    return {
      ...record,
      errors: Array.isArray(record.errors) ? record.errors.map(normalizeErrorEntry) : [],
      lastSuccessfulScanAt: record.lastSuccessfulScanAt || record.savedAt || record.snapshot?.generated || null,
      lastAttemptedScanAt: record.lastAttemptedScanAt || record.lastAttemptDiagnostics?.attemptedAt || record.savedAt || null,
      lastAttemptDiagnostics: record.lastAttemptDiagnostics ? {
        ...record.lastAttemptDiagnostics,
        errors: Array.isArray(record.lastAttemptDiagnostics.errors)
          ? record.lastAttemptDiagnostics.errors.map(normalizeErrorEntry)
          : [],
        warnings: uniqStrings(record.lastAttemptDiagnostics.warnings || []),
        sourceHealth: mergeSourceHealth(record.lastAttemptDiagnostics.sourceHealth || []),
      } : null,
    };
  }

  if (!record.snapshot) return null;

  const attemptedAt = record.savedAt || record.snapshot.generated || new Date().toISOString();
  const errors = Array.isArray(record.errors) ? record.errors.map(normalizeErrorEntry) : [];
  const succeeded = scanSucceeded(record.snapshot);
  const sourceHealth = aggregateSourceHealth(record.snapshot, errors);

  return {
    savedAt: record.savedAt || attemptedAt,
    source: record.source || "legacy_snapshot",
    mode: record.mode || record.snapshot?.scanMode || "watchlist",
    selectedTicker: record.selectedTicker || record.snapshot?.stocks?.[0]?.ticker || null,
    prompt: record.prompt || "",
    snapshot: succeeded ? record.snapshot : null,
    errors,
    lastSuccessfulScanAt: succeeded ? attemptedAt : null,
    lastAttemptedScanAt: attemptedAt,
    lastAttemptDiagnostics: {
      attemptedAt,
      succeeded,
      stale: !succeeded,
      warnings: [],
      errors,
      sourceHealth,
      snapshotMeta: {
        generated: record.snapshot?.generated || null,
        count: record.snapshot?.count || 0,
        requestedCount: record.snapshot?.requestedCount || 0,
        scannedCount: record.snapshot?.scannedCount || 0,
        errorCount: record.snapshot?.errorCount || errors.length,
      },
    },
  };
}

function readLocalRecord() {
  return normalizeRecord(readJson(workspacePath(), null));
}

function buildAttemptDiagnostics(snapshot, options = {}) {
  const errors = (options.errors || []).map(normalizeErrorEntry);
  const attemptedAt = options.attemptedAt || new Date().toISOString();
  const succeeded = options.succeeded != null ? !!options.succeeded : scanSucceeded(snapshot);
  const warnings = uniqStrings([
    ...(options.warnings || []),
    ...errors.flatMap((entry) => entry.warnings || []),
  ]);
  const sourceHealth = aggregateSourceHealth(snapshot, errors, options.sourceHealth || []);

  return {
    attemptedAt,
    succeeded,
    stale: !succeeded,
    warnings,
    errors,
    sourceHealth,
    snapshotMeta: {
      generated: snapshot?.generated || null,
      count: snapshot?.count || 0,
      requestedCount: snapshot?.requestedCount || 0,
      scannedCount: snapshot?.scannedCount || 0,
      errorCount: snapshot?.errorCount ?? errors.length,
    },
  };
}

function persistLatestSnapshot(snapshot, meta = {}) {
  const existing = readLocalRecord();
  const savedAt = new Date().toISOString();
  const selectedTicker = meta.selectedTicker || snapshot?.stocks?.[0]?.ticker || existing?.selectedTicker || null;
  const diagnostics = buildAttemptDiagnostics(snapshot, {
    attemptedAt: savedAt,
    succeeded: true,
    warnings: meta.warnings || [],
    errors: meta.errors || [],
    sourceHealth: meta.sourceHealth || [],
  });

  const record = {
    savedAt,
    source: meta.source || "local_scan",
    mode: meta.mode || snapshot?.scanMode || existing?.mode || "watchlist",
    selectedTicker,
    prompt: meta.prompt || existing?.prompt || "",
    snapshot,
    errors: diagnostics.errors,
    lastSuccessfulScanAt: savedAt,
    lastAttemptedScanAt: savedAt,
    lastAttemptDiagnostics: {
      ...diagnostics,
      stale: false,
    },
  };

  writeJson(workspacePath(), record);
  return record;
}

function persistScanOutcome(result, meta = {}) {
  const existing = readLocalRecord();
  const snapshot = result?.snapshot || null;
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const succeeded = scanSucceeded(snapshot);
  const attemptedAt = new Date().toISOString();
  const warnings = uniqStrings([
    ...(meta.warnings || []),
    ...(errors.length ? [`${errors.length} ticker scans failed during the last refresh`] : []),
    ...(!succeeded ? ["Latest scan failed; keeping the last successful workspace"] : []),
  ]);
  const diagnostics = buildAttemptDiagnostics(snapshot, {
    attemptedAt,
    succeeded,
    warnings,
    errors,
    sourceHealth: meta.sourceHealth || [],
  });

  const selectedTicker = meta.selectedTicker ||
    snapshot?.stocks?.[0]?.ticker ||
    existing?.selectedTicker ||
    null;

  const record = {
    savedAt: succeeded ? attemptedAt : (existing?.savedAt || null),
    source: meta.source || existing?.source || "local_scan",
    mode: meta.mode || snapshot?.scanMode || existing?.mode || "watchlist",
    selectedTicker,
    prompt: meta.prompt || existing?.prompt || "",
    snapshot: succeeded ? snapshot : (existing?.snapshot || null),
    errors: diagnostics.errors,
    lastSuccessfulScanAt: succeeded ? attemptedAt : (existing?.lastSuccessfulScanAt || existing?.savedAt || null),
    lastAttemptedScanAt: attemptedAt,
    lastAttemptDiagnostics: diagnostics,
  };

  writeJson(workspacePath(), record);
  return record;
}

function getLatestSnapshotRecord() {
  const local = readLocalRecord();
  if (local?.snapshot || local?.lastAttemptDiagnostics) return local;

  const published = readJson(docsSnapshotPath(), null);
  if (published?.snapshot) {
    const publishedAt = published.publishedAt || new Date().toISOString();
    return {
      savedAt: publishedAt,
      source: "published_snapshot",
      mode: published.snapshot?.scanMode || "published",
      selectedTicker: published.selectedTicker || published.snapshot?.stocks?.[0]?.ticker || null,
      prompt: published.prompt || "",
      snapshot: published.snapshot,
      errors: [],
      lastSuccessfulScanAt: publishedAt,
      lastAttemptedScanAt: publishedAt,
      lastAttemptDiagnostics: {
        attemptedAt: publishedAt,
        succeeded: true,
        stale: false,
        warnings: [],
        errors: [],
        sourceHealth: aggregateSourceHealth(published.snapshot),
        snapshotMeta: {
          generated: published.snapshot?.generated || null,
          count: published.snapshot?.count || 0,
          requestedCount: published.snapshot?.requestedCount || 0,
          scannedCount: published.snapshot?.scannedCount || 0,
          errorCount: published.snapshot?.errorCount || 0,
        },
      },
    };
  }

  return null;
}

async function scanWatchlist(options = {}) {
  const result = await engine.scanAll(options);
  persistScanOutcome(result, {
    source: "local_scan",
    mode: result.snapshot?.scanMode || "watchlist",
  });
  return result;
}

async function scanBatch(tickers, options = {}) {
  const stocks = buildStocksFromTickers(parseTickerList(tickers), "BATCH");
  const result = await engine.scanAll({
    stocks,
    delayMs: options.delayMs,
    persist: false,
    topN: options.topN,
    scanMode: "batch_top_strength",
    onProgress: options.onProgress,
  });

  persistScanOutcome(result, {
    source: "batch_scan",
    mode: result.snapshot?.scanMode || "batch_top_strength",
  });
  return result;
}

async function scanVN30(options = {}) {
  const tickers = await fetcher.indexComponents("VN30");
  const stocks = buildStocksFromTickers(tickers, "VN30");
  const result = await engine.scanAll({
    stocks,
    delayMs: options.delayMs,
    persist: false,
    topN: options.topN,
    scanMode: "vn30_top_strength",
    onProgress: options.onProgress,
  });

  persistScanOutcome(result, {
    source: "vn30_scan",
    mode: result.snapshot?.scanMode || "vn30_top_strength",
  });

  return {
    ...result,
    universeTickers: tickers,
    universeCount: tickers.length,
  };
}

async function scanOneByTicker(ticker, options = {}) {
  const normalized = normalizeTicker(ticker);
  const stock = watchlist.getTicker(normalized) || { ticker: normalized, name: normalized, sector: options.defaultSector || "USER" };
  return engine.scanOne(stock, options);
}

module.exports = {
  parseTickerList,
  buildStocksFromTickers,
  buildAttemptDiagnostics,
  aggregateSourceHealth,
  persistLatestSnapshot,
  persistScanOutcome,
  getLatestSnapshotRecord,
  scanWatchlist,
  scanBatch,
  scanVN30,
  scanOneByTicker,
};
