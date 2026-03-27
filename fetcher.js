// ─── fetcher.js ────────────────────────────────────────────────────────────────
// Pure I/O: fetch raw data from VPS public endpoints plus optional KBS
// enrichment for fundamentals / ownership.
// The runtime keeps data domains separate so later providers can be merged at
// the field level instead of smashing everything into one opaque blob.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");
const kbs = require("./providers/kbs");
const { requestJson } = require("./adapters/http-client");

const TIMEOUT = config.sources.timeout;
const SNAPSHOT_BASE = config.sources.vpsSnapshot;
const HISTORY_BASE = config.sources.vpsHistory;
const MARKET_BENCHMARKS = config.sources.marketBenchmarks || ["VNINDEX", "VN30"];
const MARKET_TZ = config.sources.marketTimeZone || "Asia/Ho_Chi_Minh";
const DEFAULT_OHLCV_DAYS = Number(config.sources.ohlcvDays) || 90;

function get(url, source) {
  return requestJson(url, {
    timeoutMs: TIMEOUT,
    headers: { "User-Agent": "SaigonEngine/2.2" },
    source,
  });
}

function sourceRow(id, name, critical, status, message) {
  return {
    id,
    name,
    critical,
    status,
    message,
    updatedAt: new Date().toISOString(),
  };
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeHistoryDays(days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) return DEFAULT_OHLCV_DAYS;
  return Math.max(7, Math.min(365, Math.round(parsed)));
}

function marketDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  return `${map.year}-${map.month}-${map.day}`;
}

function isoDateFromUnix(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function maxFinite(...values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function minFinite(...values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function buildHistoryRequest(ticker, days = DEFAULT_OHLCV_DAYS) {
  const normalizedDays = normalizeHistoryDays(days);
  const to = Math.floor(Date.now() / 1000);
  const from = to - normalizedDays * 86400;
  return {
    url: `${HISTORY_BASE}/tradingview/history?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}`,
    from,
    to,
    days: normalizedDays,
  };
}

async function fetchHistory(ticker, options = {}) {
  const request = buildHistoryRequest(ticker, options.days);
  const response = await get(request.url, {
    id: "vps_history",
    name: "VPS history",
    critical: true,
  });
  const data = response.data;
  if (data.s === "no_data" || !Array.isArray(data.t) || data.t.length === 0) {
    throw new Error(`No OHLCV for ${ticker}`);
  }

  const bars = data.t
    .map((ts, i) => ({
      date: isoDateFromUnix(ts),
      open: num(data.o?.[i]),
      high: num(data.h?.[i]),
      low: num(data.l?.[i]),
      close: num(data.c?.[i]),
      volume: Math.round(num(data.v?.[i]) || 0),
      value: 0,
      pctChange: 0,
    }))
    .filter((bar) =>
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close)
    );

  return {
    bars,
    request,
    meta: {
      transport: response.meta.transport,
      sourceStatus: response.meta.sourceStatus,
    },
  };
}

async function fetchSnapshot(ticker) {
  const url = `${SNAPSHOT_BASE}/getliststockdata/${encodeURIComponent(ticker)}`;
  const response = await get(url, {
    id: "vps_snapshot",
    name: "VPS snapshot",
    critical: false,
  });
  const data = response.data;
  const row = Array.isArray(data) ? data[0] : null;
  const lastPrice = num(row?.lastPrice);
  if (!Number.isFinite(lastPrice)) {
    return {
      snapshot: null,
      meta: {
        transport: response.meta.transport,
        sourceStatus: sourceRow("vps_snapshot", "VPS snapshot", false, "degraded", "Snapshot payload did not include a last price"),
      },
    };
  }

  const lot = num(row?.lot);
  const avgPrice = num(row?.avePrice);
  const volume = Number.isFinite(lot) ? Math.round(lot * 10) : null;

  return {
    snapshot: {
      date: marketDate(),
      open: num(row?.openPrice),
      high: num(row?.highPrice),
      low: num(row?.lowPrice),
      close: lastPrice,
      volume,
      value: Number.isFinite(volume) && Number.isFinite(avgPrice)
        ? Math.round(volume * avgPrice * 1000)
        : 0,
      pctChange: num(row?.changePc),
    },
    meta: {
      transport: response.meta.transport,
      sourceStatus: response.meta.sourceStatus,
    },
  };
}

function overlaySnapshot(historyBars, snapshot) {
  if (!snapshot) return { bars: historyBars, snapshotOverlayUsed: false, snapshotFailed: true };
  if (!historyBars.length) return { bars: [snapshot], snapshotOverlayUsed: true, snapshotFailed: false };

  const bars = historyBars.slice();
  const last = bars[bars.length - 1];

  if (last.date === snapshot.date) {
    bars[bars.length - 1] = {
      ...last,
      open: last.open ?? snapshot.open ?? snapshot.close,
      high: maxFinite(last.high, snapshot.high, last.close, snapshot.close),
      low: minFinite(last.low, snapshot.low, last.close, snapshot.close),
      close: snapshot.close ?? last.close,
      volume: Math.round(maxFinite(last.volume, snapshot.volume) || 0),
      value: Math.round(maxFinite(last.value, snapshot.value) || 0),
      pctChange: snapshot.pctChange ?? last.pctChange ?? 0,
    };

    return { bars, snapshotOverlayUsed: true, snapshotFailed: false };
  }

  bars.push({
    date: snapshot.date,
    open: snapshot.open ?? last.close,
    high: maxFinite(snapshot.high, snapshot.open, snapshot.close, last.close),
    low: minFinite(snapshot.low, snapshot.open, snapshot.close, last.close),
    close: snapshot.close ?? last.close,
    volume: Math.round(snapshot.volume || 0),
    value: Math.round(snapshot.value || 0),
    pctChange: snapshot.pctChange ?? 0,
  });

  return { bars, snapshotOverlayUsed: true, snapshotFailed: false };
}

async function fetchOhlcvBundle(ticker, options = {}) {
  const fetchedAt = new Date().toISOString();
  const history = await fetchHistory(ticker, { days: options.days });
  const historyBars = history.bars;

  let snapshot = null;
  let snapshotError = null;
  let snapshotMeta = {
    transport: null,
    sourceStatus: sourceRow("vps_snapshot", "VPS snapshot", false, "degraded", "Snapshot overlay not attempted"),
  };

  try {
    const response = await fetchSnapshot(ticker);
    snapshot = response.snapshot;
    snapshotMeta = response.meta;
  } catch (e) {
    snapshotError = e.message;
    snapshotMeta = {
      transport: null,
      sourceStatus: e.sourceStatus || sourceRow("vps_snapshot", "VPS snapshot", false, "degraded", e.message),
    };
  }

  const merged = overlaySnapshot(historyBars, snapshot);
  return {
    bars: merged.bars,
    meta: {
      fetchedAt,
      requestedDays: history.request.days,
      fromUnix: history.request.from,
      toUnix: history.request.to,
      fromDate: isoDateFromUnix(history.request.from),
      toDate: isoDateFromUnix(history.request.to),
      historyBars: historyBars.length,
      totalBars: merged.bars.length,
      snapshotOverlayUsed: merged.snapshotOverlayUsed,
      snapshotFailed: merged.snapshotFailed,
      snapshotError,
      priceSource: merged.snapshotOverlayUsed ? "vps_snapshot_overlay" : "vps_history_only",
      historyTransport: history.meta.transport,
      snapshotTransport: snapshotMeta.transport,
      sourceHealth: [
        history.meta.sourceStatus,
        merged.snapshotOverlayUsed
          ? snapshotMeta.sourceStatus
          : {
            ...snapshotMeta.sourceStatus,
            status: snapshotMeta.sourceStatus?.status === "down" ? "degraded" : snapshotMeta.sourceStatus?.status || "degraded",
            message: snapshotMeta.sourceStatus?.message || "Snapshot overlay unavailable; using VPS history only",
          },
      ].filter(Boolean),
      priceAsOf: merged.bars[merged.bars.length - 1]?.date || null,
    },
  };
}

async function fetchMarketBundle() {
  const fetchedAt = new Date().toISOString();
  const rows = await Promise.all(
    MARKET_BENCHMARKS.map(async (symbol) => {
      try {
        const bundle = await fetchHistory(symbol);
        return { symbol, bars: bundle.bars, meta: bundle.meta, error: null };
      } catch (error) {
        return { symbol, bars: null, meta: null, error };
      }
    })
  );

  const data = Object.fromEntries(
    rows
      .filter((row) => Array.isArray(row.bars) && row.bars.length > 0)
      .map((row) => [row.symbol, row.bars])
  );
  const failures = rows.filter((row) => row.error);
  const hasData = Object.keys(data).length > 0;
  const usedCurl = rows.some((row) => row.meta?.transport === "curl");

  return {
    data,
    meta: {
      fetchedAt,
      source: "vps_history",
      benchmarks: Object.keys(data),
      warnings: failures.map((row) => `${row.symbol}: ${row.error.message}`),
      transport: usedCurl ? "curl" : "fetch",
      sourceStatus: hasData
        ? sourceRow("vps_market", "VPS market benchmarks", true, failures.length ? "degraded" : (usedCurl ? "degraded" : "ok"), failures.length ? "Loaded with partial benchmark failures" : (usedCurl ? "Loaded through curl fallback" : "Benchmarks loaded"))
        : sourceRow("vps_market", "VPS market benchmarks", true, "down", failures[0]?.error?.message || "Market benchmarks unavailable"),
    },
  };
}

async function indexComponents(indexCode = "VN30") {
  const symbol = normalizeTicker(indexCode);
  if (!symbol) throw new Error("Index code is required");

  const url = `${SNAPSHOT_BASE}/getlistckindex/${encodeURIComponent(symbol)}`;
  const response = await get(url, {
    id: "vps_universe",
    name: "VPS universe",
    critical: false,
  });
  const data = response.data;

  if (!Array.isArray(data)) {
    throw new Error(`Invalid index component payload for ${symbol}`);
  }

  const seen = new Set();
  const tickers = [];
  for (const value of data) {
    const ticker = normalizeTicker(value);
    if (!ticker) continue;
    if (ticker.length < 2 || ticker.length > 12) continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }

  if (!tickers.length) {
    throw new Error(`No components returned for ${symbol}`);
  }

  return tickers;
}

async function ohlcv(ticker) {
  const bundle = await fetchOhlcvBundle(ticker);
  return bundle.bars;
}

async function market() {
  const bundle = await fetchMarketBundle();
  return bundle.data;
}

async function overview(ticker) {
  try {
    return await kbs.enrich(ticker);
  } catch (error) {
    return {
      eps: null,
      pe: null,
      pb: null,
      roe: null,
      roa: null,
      marketCap: null,
      revenueGrowth: null,
      earningsGrowth: null,
      epsGrowthQoQ: null,
      epsGrowth1Y: null,
      institutionScore: null,
      institutionOwnership: null,
      outstandingShares: null,
      dividendYield: null,
      _source: "kbs_unavailable",
      _warnings: [error.message],
      _meta: {
        provider: "kbs",
        fundamentalsSource: "unavailable",
        ownershipSource: "quarantined",
      },
      _sourceHealth: [
        sourceRow("kbs_finance", "KBS finance", false, "degraded", error.message),
        sourceRow("kbs_profile", "KBS profile", false, "degraded", "KBS profile endpoint is quarantined"),
      ],
    };
  }
}

async function foreign(ticker) {
  void ticker;
  return null;
}

async function fetchAll(ticker, options = {}) {
  const [ohlcvBundle, overviewData, foreignData] = await Promise.all([
    fetchOhlcvBundle(ticker, { days: options.ohlcvDays }),
    overview(ticker),
    foreign(ticker),
  ]);

  const marketBundle = options.marketBundle || await fetchMarketBundle();

  return {
    ohlcv: ohlcvBundle.bars,
    overview: overviewData,
    foreign: foreignData,
    market: marketBundle.data,
    meta: {
      fetchedAt: ohlcvBundle.meta.fetchedAt,
      ohlcv: ohlcvBundle.meta,
      market: marketBundle.meta,
      overview: {
        source: overviewData?._source || "unknown",
        warnings: overviewData?._warnings || [],
        sourceHealth: overviewData?._sourceHealth || [],
        fetchedAt: ohlcvBundle.meta.fetchedAt,
      },
      ownership: {
        source: overviewData?._meta?.ownershipSource || "unavailable",
        asOf: overviewData?._meta?.asOf || null,
        fetchedAt: ohlcvBundle.meta.fetchedAt,
      },
      foreign: {
        source: foreignData?._source || "unavailable",
        fetchedAt: ohlcvBundle.meta.fetchedAt,
        records: foreignData?.data?.length || 0,
      },
      sourceHealth: [
        ...(ohlcvBundle.meta.sourceHealth || []),
        marketBundle.meta.sourceStatus,
        ...(overviewData?._sourceHealth || []),
      ].filter(Boolean),
    },
  };
}

module.exports = {
  ohlcv,
  overview,
  foreign,
  market,
  fetchAll,
  fetchMarketBundle,
  fetchOhlcvBundle,
  indexComponents,
};
