// ─── engine.js ─────────────────────────────────────────────────────────────────
// Orchestrator. Calls modules in order, returns results.
// No business logic here — just sequencing.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");
const fetcher = require("./fetcher");
const { computeMetrics } = require("./analyzer");
const { applyRules } = require("./rules");
const store = require("./store");
const watchlist = require("./watchlist");
const { tickerSnapshot, fullSnapshot, claudePrompt } = require("./formatter");

function rankSnapshot(stock) {
  const strengthScore = stock.strength?.score ?? -1;
  const observedRatio = stock.observedCanSlimMax > 0
    ? stock.observedCanSlimTotal / stock.observedCanSlimMax
    : -1;
  return {
    strengthScore,
    observedRatio,
    rs: stock.relative?.vsVNINDEX3m ?? -999,
  };
}

function createScanRunId() {
  return `watchlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createUniverseKey(stocks) {
  return stocks
    .map((stock) => String(stock?.ticker || "").trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

function normalizeLookbackDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(7, Math.min(365, Math.round(parsed)));
}

async function scanOne(stockInfo, options = {}) {
  const { ticker } = stockInfo;
  const defaultLookbackDays = normalizeLookbackDays(options.ohlcvDays) || normalizeLookbackDays(config.sources.ohlcvDays) || 90;
  const autoPopulateWyckoffRange = options.autoPopulateWyckoffRange !== false;
  const repopulateMinDeltaDays = Math.max(1, Number(config.wyckoff?.repopulateMinDeltaDays) || 5);

  let usedLookbackDays = defaultLookbackDays;
  let fetchPasses = 1;

  let raw = await fetcher.fetchAll(ticker, {
    marketBundle: options.marketBundle,
    ohlcvDays: usedLookbackDays,
  });
  let metrics = computeMetrics(raw.ohlcv, raw.overview, raw.foreign, raw.market, raw.meta);
  let scores = applyRules(metrics);
  const initialWyckoffDataProfile = metrics.wyckoff?.dataProfile
    ? { ...metrics.wyckoff.dataProfile }
    : null;

  const initialRecommendedLookbackDays = normalizeLookbackDays(metrics.wyckoff?.dataProfile?.recommendedLookbackDays);
  const initialRecommendationReason = metrics.wyckoff?.dataProfile?.reason || null;
  const shouldRepopulate = autoPopulateWyckoffRange &&
    initialRecommendedLookbackDays != null &&
    Math.abs(initialRecommendedLookbackDays - usedLookbackDays) >= repopulateMinDeltaDays;

  if (shouldRepopulate) {
    usedLookbackDays = initialRecommendedLookbackDays;
    raw = await fetcher.fetchAll(ticker, {
      marketBundle: options.marketBundle,
      ohlcvDays: usedLookbackDays,
    });
    metrics = computeMetrics(raw.ohlcv, raw.overview, raw.foreign, raw.market, raw.meta);
    if (initialWyckoffDataProfile && metrics.wyckoff) {
      metrics.wyckoff.dataProfile = {
        ...metrics.wyckoff.dataProfile,
        ...initialWyckoffDataProfile,
      };
    }
    scores = applyRules(metrics);
    fetchPasses = 2;
  }

  const historyEntry = store.getTicker(ticker);
  const prevScan = historyEntry?.scans?.length ? historyEntry.scans[historyEntry.scans.length - 1] : null;
  const history = historyEntry?.scans || [];

  const snapshot = tickerSnapshot(ticker, stockInfo, metrics, scores, prevScan, history);
  const finalRecommendedLookbackDays = normalizeLookbackDays(metrics.wyckoff?.dataProfile?.recommendedLookbackDays);
  snapshot.dataRange = {
    defaultLookbackDays,
    initialRecommendedLookbackDays,
    finalRecommendedLookbackDays,
    recommendedLookbackDays: initialRecommendedLookbackDays ?? finalRecommendedLookbackDays,
    usedLookbackDays: metrics.meta?.requestedOhlcvDays || usedLookbackDays,
    repopulated: fetchPasses > 1,
    fetchPasses,
    reason: initialRecommendationReason || metrics.wyckoff?.dataProfile?.reason || null,
  };
  snapshot.scanRunId = options.scanRunId || null;
  if (options.persist !== false) {
    store.addScan(ticker, {
      ...snapshot,
      _scanMode: options.scanMode || null,
      _scanUniverseKey: options.scanUniverseKey || null,
    }, {
      name: stockInfo.name,
      sector: stockInfo.sector,
    });
  }
  return snapshot;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildScanSnapshot(results, options = {}) {
  const displayStocks = options.topN ? results.slice(0, options.topN) : results;
  return fullSnapshot(displayStocks, {
    ...options,
    summaryStocks: options.summaryStocks || results,
    previousSummaryStocks: options.previousSummaryStocks || null,
  });
}

async function scanAll(options = {}) {
  const stocks = options.stocks || watchlist.getAll();
  const results = [];
  const errors = [];
  const marketBundle = await fetcher.fetchMarketBundle();
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  const scanMode = options.scanMode || "watchlist";
  const persist = options.persist !== false;
  const comparableWatchlistRun = scanMode === "watchlist" && persist;
  const scanRunId = comparableWatchlistRun ? createScanRunId() : null;
  const scanUniverseKey = comparableWatchlistRun ? createUniverseKey(stocks) : null;

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    try {
      const snapshot = await scanOne(stock, {
        marketBundle,
        persist,
        scanMode,
        scanRunId,
        scanUniverseKey,
        ohlcvDays: options.ohlcvDays,
        autoPopulateWyckoffRange: options.autoPopulateWyckoffRange,
      });
      results.push(snapshot);
      if (options.onProgress) {
        options.onProgress({ ticker: stock.ticker, status: "ok", snapshot });
      }
    } catch (e) {
      errors.push({ ticker: stock.ticker, error: e.message });
      if (options.onProgress) {
        options.onProgress({ ticker: stock.ticker, status: "error", error: e.message });
      }
    }

    if (delayMs > 0 && i < stocks.length - 1) {
      await sleep(delayMs);
    }
  }

  results.sort((a, b) => {
    const ar = rankSnapshot(a);
    const br = rankSnapshot(b);
    if (br.strengthScore !== ar.strengthScore) return br.strengthScore - ar.strengthScore;
    if (br.observedRatio !== ar.observedRatio) return br.observedRatio - ar.observedRatio;
    return br.rs - ar.rs;
  });

  results.forEach((stock, index) => {
    const percentile = results.length > 1
      ? Math.round((1 - index / (results.length - 1)) * 100)
      : 100;
    stock.strength = {
      ...(stock.strength || {}),
      rank: index + 1,
      percentile,
    };
  });

  const requestedCount = stocks.length;
  const scannedCount = results.length;
  const previousSummaryStocks = comparableWatchlistRun && scannedCount === requestedCount
    ? store.getPreviousRunStocks({
        currentRunId: scanRunId,
        scanMode,
        universeKey: scanUniverseKey,
      })
    : null;
  const snapshot = buildScanSnapshot(results, {
    universeCount: requestedCount,
    requestedCount,
    scannedCount,
    errorCount: errors.length,
    scanMode,
    topN: options.topN || null,
    delayMs,
    scanRunId,
    previousSummaryStocks,
  });
  return { snapshot, errors };
}

async function getClaudePrompt(options = {}) {
  const { snapshot, errors } = await scanAll(options);
  return {
    prompt: claudePrompt(snapshot),
    snapshot,
    errors,
  };
}

function getHistory(ticker) {
  return store.getTicker(ticker);
}

function getAllHistory() {
  return store.getAll();
}

module.exports = {
  scanOne,
  scanAll,
  getClaudePrompt,
  getHistory,
  getAllHistory,
  buildScanSnapshot,
};
