// ─── engine.js ─────────────────────────────────────────────────────────────────
// Orchestrator. Calls modules in order, returns results.
// No business logic here — just sequencing.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");
const fetcher = require("./fetcher");
const { computeMetrics } = require("./analyzer");
const { applyRules } = require("./rules");
const store = require("./store");
const { tickerSnapshot, fullSnapshot, claudePrompt } = require("./formatter");

function rankSnapshot(stock) {
  const observedRatio = stock.observedCanSlimMax > 0
    ? stock.observedCanSlimTotal / stock.observedCanSlimMax
    : -1;
  return {
    observedRatio,
    rs: stock.relative?.vsVNINDEX3m ?? -999,
  };
}

async function scanOne(stockInfo, options = {}) {
  const { ticker } = stockInfo;
  const raw = await fetcher.fetchAll(ticker, { marketBundle: options.marketBundle });
  const metrics = computeMetrics(raw.ohlcv, raw.overview, raw.foreign, raw.market, raw.meta);
  const scores = applyRules(metrics);

  const historyEntry = store.getTicker(ticker);
  const prevScan = historyEntry?.scans?.length ? historyEntry.scans[historyEntry.scans.length - 1] : null;
  const history = historyEntry?.scans || [];

  const snapshot = tickerSnapshot(ticker, stockInfo, metrics, scores, prevScan, history);
  store.addScan(ticker, snapshot, { name: stockInfo.name, sector: stockInfo.sector });
  return snapshot;
}

async function scanAll(options = {}) {
  const stocks = options.stocks || config.stocks;
  const results = [];
  const errors = [];
  const marketBundle = await fetcher.fetchMarketBundle();

  for (const stock of stocks) {
    try {
      const snapshot = await scanOne(stock, { marketBundle });
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
  }

  results.sort((a, b) => {
    const ar = rankSnapshot(a);
    const br = rankSnapshot(b);
    if (br.observedRatio !== ar.observedRatio) return br.observedRatio - ar.observedRatio;
    return br.rs - ar.rs;
  });

  const snapshot = fullSnapshot(results);
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

module.exports = { scanOne, scanAll, getClaudePrompt, getHistory, getAllHistory };
