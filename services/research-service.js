const crypto = require("crypto");
const config = require("../config");
const watchlist = require("../watchlist");
const { appendJsonl, readJsonl, resolveProjectPath } = require("./file-store");
const freeSources = require("../adapters/free-sources");

function researchPath() {
  return resolveProjectPath(process.env.SAIGON_RESEARCH_PATH || config.store.researchPath || "./data/research.jsonl");
}

function normalizeTicker(value) {
  return watchlist.normalizeTicker(value);
}

function normalizeWindow(value) {
  const raw = String(value || config.research?.defaultWindow || "7d").trim().toLowerCase();
  if (["1d", "7d", "30d"].includes(raw)) return raw;
  return "7d";
}

function windowMs(windowValue) {
  const windowId = normalizeWindow(windowValue);
  if (windowId === "1d") return 24 * 60 * 60 * 1000;
  if (windowId === "30d") return 30 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function toIso(value = new Date()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sourcePriority(source) {
  return config.research?.sourcePriority?.[source] ?? 50;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function tokenizeText(value) {
  return uniq(String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2));
}

function similarity(a, b) {
  const aSet = new Set(tokenizeText(a));
  const bSet = new Set(tokenizeText(b));
  if (!aSet.size || !bSet.size) return 0;

  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }

  return overlap / new Set([...aSet, ...bSet]).size;
}

function evidenceId(prefix, payload) {
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}:${hash}`;
}

function loadStoredEvidence() {
  return readJsonl(researchPath()).filter((item) => item && item.id && item.publishedAt);
}

function persistEvidence(item) {
  appendJsonl(researchPath(), item);
  return item;
}

function findStock(snapshot, ticker) {
  if (!snapshot?.stocks?.length) return null;
  const normalized = normalizeTicker(ticker) || snapshot.stocks[0]?.ticker;
  return snapshot.stocks.find((stock) => stock.ticker === normalized) || snapshot.stocks[0] || null;
}

function scoreEvidence(item, context = {}) {
  const now = Date.now();
  const ageMs = Math.max(0, now - new Date(item.publishedAt || item.createdAt || now).getTime());
  const recency = Math.max(0, Math.round(100 * (1 - Math.min(ageMs, windowMs(context.window) * 1.5) / (windowMs(context.window) * 1.5))));

  const tickerMatch = context.ticker && (item.tickerTags || []).includes(context.ticker);
  const sectorMatch = context.sector && (item.sectorTags || []).includes(context.sector);
  const match = tickerMatch ? 100 : sectorMatch ? 72 : item.kind === "market_event" ? 48 : 24;

  const source = sourcePriority(item.source);
  const novelty = Number.isFinite(Number(item.novelty)) ? Number(item.novelty) : 80;
  const score = Math.round(recency * 0.35 + match * 0.3 + source * 0.2 + novelty * 0.15);

  return {
    recency,
    match,
    source,
    novelty,
    score,
  };
}

function computeNovelty(item, existing = []) {
  const relevant = existing.filter((entry) =>
    entry.source === item.source || (entry.tickerTags || []).some((ticker) => (item.tickerTags || []).includes(ticker))
  );

  if (!relevant.length) return 100;

  const maxSimilarity = relevant.reduce((best, entry) => {
    const candidate = similarity(
      [item.title, item.note, item.url].filter(Boolean).join(" "),
      [entry.title, entry.note, entry.url].filter(Boolean).join(" ")
    );
    return Math.max(best, candidate);
  }, 0);

  return Math.max(5, Math.round((1 - maxSimilarity) * 100));
}

function buildMarketEvidence(snapshot, ticker) {
  if (!snapshot?.stocks?.length) return [];

  const stock = findStock(snapshot, ticker);
  const sectorRow = snapshot.market?.sectors?.all?.find((row) => row.sector === stock?.sector) || null;
  const alerts = (snapshot.alerts?.items || []).filter((alert) =>
    !alert.ticker || alert.ticker === stock?.ticker
  );
  const evidence = [];

  if (snapshot.market?.pulse) {
    evidence.push({
      id: evidenceId("market", {
        ticker: stock?.ticker,
        pulse: snapshot.market.pulse.status,
        generated: snapshot.generated,
      }),
      source: "market_snapshot",
      kind: "market_event",
      tickerTags: stock?.ticker ? [stock.ticker] : [],
      sectorTags: stock?.sector ? [stock.sector] : [],
      title: `Market pulse: ${snapshot.market.pulse.status || "unknown"}`,
      url: null,
      publishedAt: snapshot.generated || toIso(),
      note: snapshot.market.pulse.note || `Exposure ${snapshot.market.pulse.exposure || "n/a"} with ${snapshot.market.pulse.distributionDays ?? "n/a"} distribution days.`,
      meta: {
        regime: snapshot.market.regime || null,
        exposure: snapshot.market.pulse.exposure || null,
      },
    });
  }

  if (stock) {
    evidence.push({
      id: evidenceId("ticker", {
        ticker: stock.ticker,
        signal: stock.signal,
        generated: snapshot.generated,
      }),
      source: "market_snapshot",
      kind: "market_event",
      tickerTags: [stock.ticker],
      sectorTags: [stock.sector],
      title: `${stock.ticker} ${stock.signal} with ${stock.confidence}/10 rule strength`,
      url: null,
      publishedAt: stock.scanTime || snapshot.generated || toIso(),
      note: [
        stock.breakout?.reason,
        stock.executionRisk?.reason,
        stock.delta && stock.delta !== "FIRST_SCAN" ? `Delta: ${stock.delta}` : null,
      ].filter(Boolean).join(" "),
      meta: {
        signal: stock.signal,
        confidence: stock.confidence,
        breakoutState: stock.breakout?.state || null,
      },
    });
  }

  if (sectorRow) {
    evidence.push({
      id: evidenceId("sector", {
        sector: sectorRow.sector,
        rank: sectorRow.rank,
        generated: snapshot.generated,
      }),
      source: "market_snapshot",
      kind: "market_event",
      tickerTags: stock?.ticker ? [stock.ticker] : [],
      sectorTags: [sectorRow.sector],
      title: `${sectorRow.sector} rotation rank #${sectorRow.rank}`,
      url: null,
      publishedAt: snapshot.generated || toIso(),
      note: `Rotation score ${sectorRow.rotationScore}. Avg change ${sectorRow.avgChangePct}% and RS vs VNINDEX ${sectorRow.avgRsVsVNINDEX3m}.`,
      meta: {
        rank: sectorRow.rank,
        rankDelta: sectorRow.rankDelta,
      },
    });
  }

  for (const alert of alerts.slice(0, 4)) {
    evidence.push({
      id: evidenceId("alert", {
        alertId: alert.id,
        ticker: alert.ticker || stock?.ticker || null,
      }),
      source: "market_snapshot",
      kind: "market_event",
      tickerTags: uniq([alert.ticker, stock?.ticker].map(normalizeTicker)),
      sectorTags: stock?.sector ? [stock.sector] : [],
      title: alert.title,
      url: null,
      publishedAt: snapshot.generated || toIso(),
      note: alert.summary || (alert.reasons || []).join(" "),
      meta: {
        level: alert.level,
        category: alert.category,
      },
    });
  }

  return evidence;
}

function normalizeStoredItem(item) {
  return {
    id: item.id,
    source: item.source || "operator_note",
    kind: item.kind || "operator_note",
    tickerTags: uniq((item.tickerTags || []).map(normalizeTicker)),
    sectorTags: uniq((item.sectorTags || []).map((value) => String(value || "").trim().toUpperCase())),
    title: item.title || "Untitled evidence",
    url: item.url || null,
    publishedAt: toIso(item.publishedAt || item.createdAt || new Date()),
    createdAt: toIso(item.createdAt || item.publishedAt || new Date()),
    note: item.note || "",
    novelty: Number.isFinite(Number(item.novelty)) ? Number(item.novelty) : null,
    meta: item.meta || {},
  };
}

function appendOperatorNote(payload = {}) {
  const ticker = normalizeTicker(payload.ticker);
  const stock = ticker ? watchlist.getTicker(ticker) : null;
  const title = String(payload.title || (ticker ? `${ticker} operator note` : "Operator note")).trim();
  const item = normalizeStoredItem({
    id: evidenceId("note", {
      title,
      ticker,
      note: payload.note || "",
      createdAt: new Date().toISOString(),
    }),
    source: "operator_note",
    kind: "operator_note",
    tickerTags: ticker ? [ticker] : [],
    sectorTags: payload.sectorTags || (stock?.sector ? [stock.sector] : []),
    title,
    note: String(payload.note || "").trim(),
    url: payload.url || null,
    publishedAt: payload.publishedAt || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    novelty: 100,
    meta: {
      author: "operator",
      tags: payload.tags || [],
    },
  });

  return persistEvidence(item);
}

function buildBriefing(ticker, snapshot, evidence = []) {
  const stock = findStock(snapshot, ticker);
  if (!stock) return null;

  const topEvidence = evidence
    .filter((item) => item.kind !== "briefing")
    .slice(0, 4)
    .map((item) => `- ${item.title}: ${item.note || "No note"}`)
    .join("\n");

  const briefing = [
    `Ticker: ${stock.ticker} (${stock.name})`,
    `Signal: ${stock.signal} with confidence ${stock.confidence}/10`,
    `Market pulse: ${snapshot.market?.pulse?.status || "unknown"} | Regime ${snapshot.market?.regime || "unknown"}`,
    `Breakout: ${stock.breakout?.state || "unknown"} | Execution ${stock.executionRisk?.liquidityLabel || "unknown"}`,
    `Focus risks: ${(stock.quality?.warnings || []).slice(0, 3).join("; ") || "No major data warnings."}`,
    "Evidence:",
    topEvidence || "- No fresh evidence captured.",
  ].join("\n");

  const briefingId = `briefing:${stock.ticker}:${toIso(snapshot.generated).slice(0, 10)}`;
  return normalizeStoredItem({
    id: briefingId,
    source: "briefing_template",
    kind: "briefing",
    tickerTags: [stock.ticker],
    sectorTags: [stock.sector],
    title: `Desk briefing for ${stock.ticker}`,
    note: briefing,
    publishedAt: snapshot.generated || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    novelty: 100,
    meta: {
      signal: stock.signal,
      confidence: stock.confidence,
    },
  });
}

function saveBriefing(ticker, snapshot, evidence = []) {
  const briefing = buildBriefing(ticker, snapshot, evidence);
  if (!briefing) return null;

  const existing = loadStoredEvidence().find((item) => item.id === briefing.id);
  if (existing) return normalizeStoredItem(existing);
  return persistEvidence(briefing);
}

async function refreshResearch({ ticker, window = "7d", snapshot }) {
  const normalizedTicker = normalizeTicker(ticker);
  const stock = findStock(snapshot, normalizedTicker);
  if (!stock) throw new Error(`Ticker ${normalizedTicker} not found in workspace`);

  const existing = loadStoredEvidence();
  const remote = await freeSources.fetchRemoteEvidence({
    ticker: normalizedTicker,
    companyName: stock.name,
    sector: stock.sector,
    windowDays: normalizeWindow(window),
  });

  const appended = [];
  for (const rawItem of remote.items || []) {
    const item = normalizeStoredItem({
      ...rawItem,
      tickerTags: rawItem.tickerTags || [normalizedTicker],
      sectorTags: rawItem.sectorTags || [stock.sector],
    });
    if (existing.some((entry) => entry.id === item.id)) continue;
    item.novelty = computeNovelty(item, existing);
    persistEvidence(item);
    existing.push(item);
    appended.push(item);
  }

  const liveEvidence = listEvidence({ ticker: normalizedTicker, window, snapshot });
  const briefing = saveBriefing(normalizedTicker, snapshot, liveEvidence.evidence);

  return {
    ticker: normalizedTicker,
    window: normalizeWindow(window),
    appended,
    briefing,
    errors: remote.errors || [],
    sourceHealth: freeSources.sourceHealth(),
  };
}

function filterEvidence(items, context = {}) {
  const cutoff = Date.now() - windowMs(context.window);
  return items.filter((item) => {
    const published = new Date(item.publishedAt || item.createdAt || 0).getTime();
    if (published < cutoff) return false;
    if (!context.ticker) return true;

    if ((item.tickerTags || []).includes(context.ticker)) return true;
    if (context.sector && (item.sectorTags || []).includes(context.sector)) return true;
    return item.kind === "market_event";
  });
}

function listEvidence({ ticker, window = "7d", snapshot }) {
  const stock = findStock(snapshot, ticker);
  const context = {
    ticker: stock?.ticker || normalizeTicker(ticker),
    sector: stock?.sector || null,
    window: normalizeWindow(window),
  };

  const stored = filterEvidence(loadStoredEvidence().map(normalizeStoredItem), context);
  const market = filterEvidence(buildMarketEvidence(snapshot, context.ticker), context);
  const merged = [...market, ...stored]
    .map((item) => {
      const scoring = scoreEvidence(item, context);
      return {
        ...item,
        score: scoring.score,
        novelty: scoring.novelty,
        scoring,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.publishedAt).localeCompare(String(a.publishedAt));
    });

  return {
    ticker: context.ticker,
    window: context.window,
    sourceHealth: freeSources.sourceHealth(),
    count: merged.length,
    evidence: merged,
    latestBriefing: merged.find((item) => item.kind === "briefing") || null,
  };
}

function listRecentNotes(limit = 5) {
  return loadStoredEvidence()
    .map(normalizeStoredItem)
    .filter((item) => item.kind === "operator_note")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

module.exports = {
  normalizeWindow,
  loadStoredEvidence,
  appendOperatorNote,
  buildBriefing,
  saveBriefing,
  refreshResearch,
  listEvidence,
  buildMarketEvidence,
  scoreEvidence,
  computeNovelty,
  listRecentNotes,
};
