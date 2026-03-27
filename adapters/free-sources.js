const config = require("../config");
const { requestJson, createSourceStatus } = require("./http-client");
const { createSourceHealthRow } = require("../services/source-health");

function toIso(input, fallback = null) {
  if (!input) return fallback;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeTags(values) {
  return Array.from(new Set((values || [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)));
}

function alphaVantageEnabled() {
  return Boolean(
    config.research?.remoteAdaptersEnabled &&
    config.research?.remoteAdapters?.alphaVantageNews?.enabled &&
    process.env.ALPHA_VANTAGE_API_KEY
  );
}

function alphaVantageStatus() {
  if (!config.research?.remoteAdaptersEnabled) {
    return createSourceHealthRow({
      id: "alpha_vantage_news",
      name: "Alpha Vantage news",
      critical: false,
      status: "degraded",
      message: "Optional remote adapters are disabled",
    });
  }
  if (!config.research?.remoteAdapters?.alphaVantageNews?.enabled) {
    return createSourceHealthRow({
      id: "alpha_vantage_news",
      name: "Alpha Vantage news",
      critical: false,
      status: "degraded",
      message: "Adapter disabled in config",
    });
  }
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    return createSourceHealthRow({
      id: "alpha_vantage_news",
      name: "Alpha Vantage news",
      critical: false,
      status: "degraded",
      message: "Missing ALPHA_VANTAGE_API_KEY",
    });
  }
  return createSourceHealthRow({
    id: "alpha_vantage_news",
    name: "Alpha Vantage news",
    critical: false,
    status: "ok",
    message: "Available for optional headline enrichment",
  });
}

async function fetchAlphaVantageNews({ ticker, companyName = "", limit = 12 }) {
  if (!alphaVantageEnabled()) return [];

  const params = new URLSearchParams({
    function: "NEWS_SENTIMENT",
    tickers: ticker,
    sort: "LATEST",
    limit: String(limit),
    apikey: process.env.ALPHA_VANTAGE_API_KEY,
  });

  const { data: payload } = await requestJson(`https://www.alphavantage.co/query?${params.toString()}`, {
    headers: { "User-Agent": "SaigonTerminal/2.2" },
    timeoutMs: Math.min(config.sources?.timeout || 15000, 12000),
    source: createSourceStatus({
      id: "alpha_vantage_news",
      name: "Alpha Vantage news",
      critical: false,
    }, "ok", "Available"),
  });
  const feed = Array.isArray(payload.feed) ? payload.feed : [];

  return feed.map((item) => ({
    id: `alpha-vantage:${Buffer.from(String(item.url || item.title || "")).toString("base64url").slice(0, 24)}`,
    source: "alpha_vantage_news",
    kind: "headline",
    tickerTags: normalizeTags([ticker, ...(item.ticker_sentiment || []).map((row) => row.ticker)]),
    sectorTags: [],
    title: item.title || `${ticker} market headline`,
    url: item.url || null,
    publishedAt: toIso(item.time_published, new Date().toISOString()),
    note: item.summary || item.title || "",
    meta: {
      provider: "alpha_vantage",
      authors: item.authors || [],
      source: item.source || null,
      overallSentiment: item.overall_sentiment_label || null,
      companyName,
    },
  }));
}

async function fetchRemoteEvidence(context = {}) {
  const items = [];
  const errors = [];

  try {
    items.push(...await fetchAlphaVantageNews({
      ticker: context.ticker,
      companyName: context.companyName,
      limit: config.research?.remoteAdapters?.alphaVantageNews?.limit || 12,
    }));
  } catch (error) {
    errors.push({ source: "alpha_vantage_news", error: error.message });
  }

  return { items, errors };
}

function sourceHealth() {
  return [
    alphaVantageStatus(),
  ];
}

module.exports = {
  fetchRemoteEvidence,
  sourceHealth,
};
