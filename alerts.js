// ─── alerts.js ────────────────────────────────────────────────────────────────
// Pure alert-center builder for Saigon Terminal.
// Input: existing snapshot shape plus optional ticker filters.
// Output: terminal-friendly alert items, grouped counts, severity, and reasons.
// ───────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 25;

const LEVEL_RANK = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const CATEGORY_LABELS = {
  market_risk: "Market Risk",
  bearish_breakdown: "Bearish Breakdown",
  buy_ready: "Buy Ready",
  near_trigger: "Near Trigger",
  leader: "Strength Leader",
  quality: "Data Quality",
};

const CATEGORY_RANK = {
  market_risk: 5,
  bearish_breakdown: 4,
  buy_ready: 3,
  near_trigger: 2,
  leader: 1,
  quality: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeTickerFilter(tickers) {
  if (!tickers) return null;
  const values = Array.isArray(tickers)
    ? tickers
    : String(tickers)
      .split(/[\s,;]+/)
      .filter(Boolean);

  const set = new Set();
  for (const value of values) {
    const ticker = normalizeTicker(value);
    if (ticker) set.add(ticker);
  }
  return set.size ? set : null;
}

function severityLevel(severity) {
  const score = clamp(Number(severity) || 0, 0, 100);
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score >= 15) return "low";
  return "info";
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(value).toFixed(digits);
}

function formatPrice(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(value).toLocaleString("vi-VN");
}

function formatRatioPct(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return null;
  const scaled = Number(value) * 100;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(digits)}%`;
}

function formatPct(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return null;
  return `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;
}

function normalizeSnapshot(input) {
  if (Array.isArray(input)) {
    return { stocks: input.slice() };
  }

  if (!isObject(input)) {
    return { stocks: [] };
  }

  return {
    ...input,
    stocks: asArray(input.stocks).slice(),
  };
}

function createAlert(alert) {
  if (!alert || !alert.category || !alert.title) return null;

  const severity = clamp(Math.round(Number(alert.severity) || 0), 0, 100);
  return {
    id: alert.id || `${alert.category}:${normalizeTicker(alert.ticker || "market")}:${alert.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    category: alert.category,
    categoryLabel: CATEGORY_LABELS[alert.category] || alert.category,
    severity,
    level: alert.level || severityLevel(severity),
    ticker: alert.ticker || null,
    name: alert.name || null,
    title: alert.title,
    summary: alert.summary || "",
    reasons: asArray(alert.reasons),
    next: asArray(alert.next),
    evidence: isObject(alert.evidence) ? alert.evidence : {},
    source: alert.source || "snapshot",
  };
}

function pushAlert(list, alert) {
  const normalized = createAlert(alert);
  if (normalized) list.push(normalized);
}

function compareAlerts(a, b) {
  if (b.severity !== a.severity) return b.severity - a.severity;

  const ar = CATEGORY_RANK[a.category] ?? 0;
  const br = CATEGORY_RANK[b.category] ?? 0;
  if (br !== ar) return br - ar;

  if ((a.ticker || "") !== (b.ticker || "")) {
    return String(a.ticker || "").localeCompare(String(b.ticker || ""));
  }

  return String(a.title || "").localeCompare(String(b.title || ""));
}

function buildMarketRiskAlert(snapshot) {
  const market = snapshot.market || {};
  const pulse = market.pulse || {};
  const regime = String(market.regime || "").toLowerCase();
  const status = String(pulse.status || "").toLowerCase();
  const distributionDays = Number(pulse.distributionDays || 0);
  const exposure = pulse.exposure || "n/a";
  const breadth = market.breadth || {};
  const hasFollowThrough = Boolean(pulse.followThrough?.date);

  const bearish = regime === "bearish" || status === "correction";
  if (!bearish && !distributionDays && !hasFollowThrough) return null;

  let severity = 0;
  if (bearish) severity += 55;
  if (status === "correction") severity += 18;
  if (distributionDays >= 5) severity += 18;
  if (distributionDays >= 7) severity += 6;
  if (!hasFollowThrough) severity += 4;
  if ((Number(breadth.decliners || 0) > Number(breadth.advancers || 0)) && Number(breadth.advancers || 0) < 3) severity += 4;

  const reasons = [];
  if (regime) reasons.push(`Regime ${regime}`);
  if (status) reasons.push(`Pulse ${status}`);
  if (distributionDays) reasons.push(`${distributionDays} distribution day(s)`);
  if (exposure && exposure !== "n/a") reasons.push(`Exposure ${exposure}`);
  if (!hasFollowThrough) reasons.push("No follow-through day yet");

  const next = [
    "Keep new longs in watch mode only.",
    "Respect the current exposure guidance until the pulse repairs.",
  ];

  if (status === "correction" || regime === "bearish") {
    next.push("Wait for a clean follow-through or a broad repair before sizing up.");
  }

  return createAlert({
    id: "market:market-risk",
    category: "market_risk",
    severity: clamp(severity, 40, 100),
    ticker: null,
    title: "Market risk is elevated",
    summary: `${market.pulse?.note || "Market regime is not supportive."} Exposure should stay defensive.`,
    reasons,
    next,
    evidence: {
      regime: market.regime || null,
      pulseStatus: pulse.status || null,
      distributionDays,
      exposure,
      breadth,
      followThrough: pulse.followThrough || null,
    },
    source: "market",
  });
}

function buildBuyReadyAlert(stock) {
  const wyckoff = stock.wyckoff || {};
  const entry = wyckoff.entry || {};
  const plans = asArray(entry.plans);
  const primary = plans[0] || null;
  const bias = String(wyckoff.bias || stock.wyckoffBias || "").toLowerCase();
  const signal = String(stock.signal || "").toUpperCase();
  const buyBias = bias === "buy" || bias === "buy_pullback" || bias === "buy_pilot";
  const buySignal = signal === "BUY" || signal === "STRONG_BUY";
  const activePlan = primary && Number.isFinite(Number(primary.price));

  if (!buyBias && !buySignal && !(activePlan && entry.status === "buy")) return null;

  const severityBase = activePlan ? 88 : 76;
  const strengthScore = Number(stock.strength?.score || 0);
  const severity = clamp(severityBase + (strengthScore >= 80 ? 6 : strengthScore >= 65 ? 3 : 0), 65, 100);
  const entryText = activePlan ? `Entry ${formatPrice(primary.price)}${primary.stop != null ? ` | Stop ${formatPrice(primary.stop)}` : ""}` : "No fixed entry plan attached yet";

  const reasons = [];
  if (wyckoff.label) reasons.push(wyckoff.label);
  if (entry.summary) reasons.push(entry.summary);
  if (stock.strength?.label) reasons.push(`Strength ${stock.strength.label}${stock.strength?.score != null ? ` ${stock.strength.score}/100` : ""}`);
  if (stock.wyckoff?.tests?.summary) reasons.push(stock.wyckoff.tests.summary);
  if (buySignal) reasons.push(`Signal ${signal}`);

  const next = [
    "Review sizing only if the trigger holds with real volume.",
    "Do not chase above the trigger without confirming expansion.",
  ];

  if (primary?.price != null) {
    next.unshift(`Stage the order around ${formatPrice(primary.price)} and keep the stop disciplined.`);
  }

  return createAlert({
    id: `ticker:${stock.ticker}:buy-ready`,
    category: "buy_ready",
    severity,
    ticker: stock.ticker,
    name: stock.name || stock.ticker,
    title: `${stock.ticker} buy-ready`,
    summary: `${entryText}. ${wyckoff.label || "Wyckoff setup"} is actionable.`,
    reasons,
    next,
    evidence: {
      strength: stock.strength || null,
      signal: stock.signal || null,
      wyckoffBias: wyckoff.bias || null,
      wyckoffLabel: wyckoff.label || null,
      entry: entry || null,
    },
    source: "stock",
  });
}

function buildNearTriggerAlert(stock) {
  const wyckoff = stock.wyckoff || {};
  const entry = wyckoff.entry || {};
  const watch = asArray(entry.watch);
  if (!watch.length) return null;

  const signal = String(stock.signal || "").toUpperCase();
  const bias = String(wyckoff.bias || stock.wyckoffBias || "").toLowerCase();
  const watchText = watch
    .slice(0, 3)
    .map((item) => `${item.label}${item.price != null ? ` @ ${formatPrice(item.price)}` : ""}`)
    .join(" | ");

  let severity = 58;
  if (signal === "BUY" || signal === "STRONG_BUY") severity += 6;
  if (bias === "buy_pilot" || bias === "buy_pullback") severity += 4;
  if (watch.length >= 2) severity += 2;

  return createAlert({
    id: `ticker:${stock.ticker}:near-trigger`,
    category: "near_trigger",
    severity,
    ticker: stock.ticker,
    name: stock.name || stock.ticker,
    title: `${stock.ticker} near-trigger watch`,
    summary: watchText || "Watch trigger is defined but empty.",
    reasons: [
      entry.summary || wyckoff.label || "Wyckoff watch state",
      entry.invalidation ? `Invalidation: ${entry.invalidation}` : null,
    ].filter(Boolean),
    next: [
      "Wait for the trigger, not the middle of the range.",
      "Re-check volume expansion at the trigger level.",
    ],
    evidence: {
      watch,
      entry: entry || null,
      wyckoffLabel: wyckoff.label || null,
      signal: stock.signal || null,
    },
    source: "stock",
  });
}

function buildLeaderAlert(stock) {
  const strength = stock.strength || {};
  const score = Number(strength.score || 0);
  const rank = Number(strength.rank || 0);
  const marketLeader = Boolean(strength.marketLeader);

  if (!(marketLeader || score >= 40 || rank > 0)) return null;
  if (score < 40 && rank > 3) return null;

  let severity = 42;
  if (score >= 80) severity = 80;
  else if (score >= 65) severity = 68;
  else if (score >= 50) severity = 58;
  else if (rank <= 3) severity = 48;

  if (rank === 1) severity += 4;
  if (marketLeader) severity += 4;

  const rel3m = stock.relative?.vsVNINDEX3m;
  const relNote = rel3m != null ? ` vs VNINDEX 3M ${formatRatioPct(rel3m)}` : "";

  return createAlert({
    id: `ticker:${stock.ticker}:leader`,
    category: "leader",
    severity,
    ticker: stock.ticker,
    name: stock.name || stock.ticker,
    title: `${stock.ticker} strength leader${rank ? ` #${rank}` : ""}`,
    summary: `${strength.label || "Strength watch"}${score ? ` ${score}/100` : ""}${relNote}.`,
    reasons: [
      strength.label ? `Strength ${strength.label}` : null,
      rank ? `Rank #${rank}` : null,
      marketLeader ? "Market leader vs index" : null,
      stock.relative?.priceVsSma50Pct != null ? `Price vs SMA50 ${formatPct(stock.relative.priceVsSma50Pct)}` : null,
    ].filter(Boolean),
    next: [
      "Keep it on the front page even if the setup is not buy-ready yet.",
      "Promote it only when Wyckoff timing flips constructive.",
    ],
    evidence: {
      strength,
      relative: stock.relative || null,
      signal: stock.signal || null,
    },
    source: "stock",
  });
}

function buildBearishBreakdownAlert(stock) {
  const wyckoff = stock.wyckoff || {};
  const phase = String(wyckoff.phase || stock.wyckoffPhase || "").toLowerCase();
  const bias = String(wyckoff.bias || stock.wyckoffBias || "").toLowerCase();
  const signal = String(stock.signal || "").toUpperCase();
  const activeSow = Boolean(wyckoff.events?.sow?.active);
  const activeUpthrust = Boolean(wyckoff.events?.upthrust?.active);
  const markdown = phase === "markdown";
  const distribution = phase === "distribution";
  const severeSignal = signal === "SELL" || signal === "STRONG_SELL";
  const avoidBias = bias === "avoid";

  if (!(severeSignal || avoidBias || markdown || distribution || activeSow || activeUpthrust)) return null;

  let severity = 68;
  if (severeSignal) severity += 8;
  if (activeSow) severity += 12;
  if (activeUpthrust) severity += 8;
  if (markdown) severity += 10;
  if (distribution) severity += 6;

  const reasons = [];
  if (wyckoff.label) reasons.push(wyckoff.label);
  if (signal) reasons.push(`Signal ${signal}`);
  if (activeSow) reasons.push("Active SOW");
  if (activeUpthrust) reasons.push("Active upthrust");
  if (stock.relative?.vsVNINDEX3m != null) reasons.push(`Relative vs VNINDEX 3M ${formatRatioPct(stock.relative.vsVNINDEX3m)}`);

  const next = [
    "Do not open new longs while the structure is damaged.",
    "Wait for a repaired base, spring, or reclaim before reconsidering.",
  ];

  return createAlert({
    id: `ticker:${stock.ticker}:bearish-breakdown`,
    category: "bearish_breakdown",
    severity,
    ticker: stock.ticker,
    name: stock.name || stock.ticker,
    title: `${stock.ticker} bearish breakdown`,
    summary: `${wyckoff.label || "Bearish structure"} is not a long setup. Bias remains ${bias || "bearish"}.`,
    reasons,
    next,
    evidence: {
      phase: wyckoff.phase || stock.wyckoffPhase || null,
      stage: wyckoff.stage || stock.wyckoffStage || null,
      bias: wyckoff.bias || stock.wyckoffBias || null,
      signal: stock.signal || null,
      events: wyckoff.events || null,
    },
    source: "stock",
  });
}

function buildQualityAlert(stock) {
  const quality = stock.quality || {};
  const coverage = Number(quality.coveragePct ?? stock.coveragePct ?? 0);
  const score = Number(quality.score ?? 0);
  const warnings = asArray(quality.warnings);
  const missingFields = asArray(quality.missingFields);

  if (score >= 85 && coverage >= 90 && warnings.length < 2 && missingFields.length < 2) {
    return null;
  }

  let severity = 20;
  if (score < 75) severity += 18;
  if (score < 60) severity += 12;
  if (coverage < 80) severity += 12;
  if (warnings.length) severity += 8;
  if (missingFields.length) severity += 8;

  const reasons = [];
  if (quality.label) reasons.push(`Quality ${quality.label}${score ? ` ${score}/100` : ""}`);
  if (coverage) reasons.push(`Coverage ${coverage}%`);
  if (warnings.length) reasons.push(warnings[0]);
  if (missingFields.length) reasons.push(`Missing ${missingFields.slice(0, 2).join(", ")}`);

  return createAlert({
    id: `ticker:${stock.ticker}:quality`,
    category: "quality",
    severity,
    ticker: stock.ticker,
    name: stock.name || stock.ticker,
    title: `${stock.ticker} data quality note`,
    summary: warnings[0] || "Some fields are still incomplete or low confidence.",
    reasons,
    next: [
      "Use this name with a lower trust level than a fully-covered ticker.",
      "Cross-check missing fields before acting on the setup.",
    ],
    evidence: {
      quality,
      coveragePct: stock.coveragePct ?? null,
      missingFields,
    },
    source: "stock",
  });
}

function buildStockAlerts(stock, snapshot) {
  if (!isObject(stock)) return [];

  const alerts = [];
  pushAlert(alerts, buildBuyReadyAlert(stock, snapshot));
  pushAlert(alerts, buildNearTriggerAlert(stock, snapshot));
  pushAlert(alerts, buildLeaderAlert(stock, snapshot));
  pushAlert(alerts, buildBearishBreakdownAlert(stock, snapshot));
  pushAlert(alerts, buildQualityAlert(stock, snapshot));
  return alerts;
}

function groupAlerts(items) {
  const groups = [];
  const byCategory = new Map();

  for (const item of items) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, []);
    }
    byCategory.get(item.category).push(item);
  }

  for (const [category, groupItems] of byCategory.entries()) {
    const sorted = groupItems.slice().sort(compareAlerts);
    groups.push({
      category,
      label: CATEGORY_LABELS[category] || category,
      count: sorted.length,
      topSeverity: sorted[0]?.severity ?? 0,
      items: sorted,
    });
  }

  groups.sort((a, b) => {
    const ar = CATEGORY_RANK[a.category] ?? 0;
    const br = CATEGORY_RANK[b.category] ?? 0;
    if (br !== ar) return br - ar;
    if (b.topSeverity !== a.topSeverity) return b.topSeverity - a.topSeverity;
    return a.label.localeCompare(b.label);
  });

  return groups;
}

function buildCounts(items) {
  const byLevel = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = {};
  const byTicker = {};

  for (const item of items) {
    byLevel[item.level] = (byLevel[item.level] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    if (item.ticker) {
      byTicker[item.ticker] = (byTicker[item.ticker] || 0) + 1;
    }
  }

  return {
    total: items.length,
    byLevel,
    byCategory,
    byTicker,
  };
}

function summarizeMarket(snapshot) {
  const market = snapshot.market || {};
  const pulse = market.pulse || {};
  const breadth = market.breadth || {};
  return {
    regime: market.regime || null,
    pulseStatus: pulse.status || null,
    exposure: pulse.exposure || null,
    distributionDays: pulse.distributionDays ?? null,
    followThrough: pulse.followThrough || null,
    breadth: {
      advancers: breadth.advancers ?? null,
      decliners: breadth.decliners ?? null,
      unchanged: breadth.unchanged ?? null,
    },
    note: pulse.note || null,
  };
}

function buildAlertCenter(input, options = {}) {
  const snapshot = normalizeSnapshot(input);
  const tickerFilter = normalizeTickerFilter(options.tickers || options.tickerFilter);
  const includeMarket = options.includeMarket !== false;
  const includeQuality = options.includeQuality !== false;
  const items = [];

  if (includeMarket) {
    pushAlert(items, buildMarketRiskAlert(snapshot, options));
  }

  for (const stock of snapshot.stocks) {
    const ticker = normalizeTicker(stock?.ticker);
    if (!ticker) continue;
    if (tickerFilter && !tickerFilter.has(ticker)) continue;

    const stockItems = buildStockAlerts({ ...stock, ticker }, snapshot, options);
    for (const item of stockItems) {
      if (!includeQuality && item.category === "quality") continue;
      items.push(item);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }

  deduped.sort(compareAlerts);

  const minSeverity = Number.isFinite(Number(options.minSeverity)) ? clamp(Number(options.minSeverity), 0, 100) : 0;
  const filtered = deduped.filter((item) => item.severity >= minSeverity);
  const limit = Number.isFinite(Number(options.maxItems))
    ? clamp(Number(options.maxItems), 1, 200)
    : DEFAULT_LIMIT;
  const itemsOut = filtered.slice(0, limit);

  return {
    generated: snapshot.generated || null,
    scanMode: snapshot.scanMode || "watchlist",
    universeCount: snapshot.universeCount ?? snapshot.stocks.length,
    requestedCount: snapshot.requestedCount ?? snapshot.stocks.length,
    scannedCount: snapshot.scannedCount ?? snapshot.stocks.length,
    errorCount: snapshot.errorCount ?? 0,
    total: itemsOut.length,
    counts: buildCounts(itemsOut),
    groups: groupAlerts(itemsOut),
    items: itemsOut,
    topAlert: itemsOut[0] || null,
    market: summarizeMarket(snapshot),
    meta: {
      source: "alerts.js",
      maxItems: limit,
      minSeverity,
      includeMarket,
      includeQuality,
      tickers: tickerFilter ? Array.from(tickerFilter) : null,
    },
  };
}

module.exports = {
  buildAlertCenter,
  buildStockAlerts,
  buildMarketRiskAlert,
  buildBuyReadyAlert,
  buildNearTriggerAlert,
  buildLeaderAlert,
  buildBearishBreakdownAlert,
  buildQualityAlert,
  buildCounts,
  groupAlerts,
  compareAlerts,
  severityLevel,
  normalizeTickerFilter,
  summarizeMarket,
  formatPrice,
  formatPct,
  formatRatioPct,
  formatNumber,
};
