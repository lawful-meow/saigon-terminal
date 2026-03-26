// ─── smartlists.js ─────────────────────────────────────────────────────────────
// Pure smart-list builder for Saigon Terminal.
// Takes a snapshot or stock array and returns terminal-style preset lenses.
// No I/O, no dependencies, no coupling to the UI layer.
// ───────────────────────────────────────────────────────────────────────────────

const SMART_LIST_PRESETS = [
  {
    id: "leaders",
    label: "Leadership",
    description: "Top CAN SLIM names with the strongest relative strength and best trend context.",
  },
  {
    id: "near_entry",
    label: "Near Entry",
    description: "Names close to an actionable Wyckoff trigger or already in a buy-ready state.",
  },
  {
    id: "repair_watch",
    label: "Repair Watch",
    description: "Constructive bases that still need repair, confirmation, or a fresh trigger.",
  },
  {
    id: "breakdown_risk",
    label: "Breakdown Risk",
    description: "Names with structural damage, weak trend context, or active markdown pressure.",
  },
  {
    id: "short_candidates",
    label: "High-Conviction Shorts",
    description: "The clearest bearish candidates when the tape is weak and Wyckoff confirms it.",
  },
  {
    id: "quality_names",
    label: "High-Quality Names",
    description: "Highest-quality snapshots with clean coverage and reliable data.",
  },
];

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asStockArray(snapshotOrStocks) {
  if (Array.isArray(snapshotOrStocks)) return snapshotOrStocks;
  if (snapshotOrStocks && Array.isArray(snapshotOrStocks.stocks)) return snapshotOrStocks.stocks;
  return [];
}

function uniq(values) {
  return Array.from(new Set(values.filter((value) => value != null && value !== "")));
}

function safeText(value, fallback = "n/a") {
  return value == null || value === "" ? fallback : String(value);
}

function getStockName(stock) {
  return safeText(stock?.name, safeText(stock?.ticker, "n/a"));
}

function getStrength(stock) {
  const strength = stock?.strength || {};
  return {
    score: toNumber(strength.score, null),
    label: strength.label || null,
    rank: toNumber(strength.rank, null),
    percentile: toNumber(strength.percentile, null),
    marketLeader: Boolean(strength.marketLeader),
  };
}

function getQuality(stock) {
  const quality = stock?.quality || {};
  return {
    score: toNumber(quality.score, null),
    label: quality.label || null,
    coveragePct: toNumber(quality.coveragePct ?? stock?.coveragePct, null),
  };
}

function getRelative(stock) {
  const relative = stock?.relative || {};
  return {
    ret1w: toNumber(relative.ret1w, null),
    ret1m: toNumber(relative.ret1m, null),
    ret3m: toNumber(relative.ret3m, null),
    vsVNINDEX3m: toNumber(relative.vsVNINDEX3m, null),
    vsVN303m: toNumber(relative.vsVN303m, null),
    priceVsSma20Pct: toNumber(relative.priceVsSma20Pct, null),
    priceVsSma50Pct: toNumber(relative.priceVsSma50Pct, null),
  };
}

function getWyckoff(stock) {
  const wyckoff = stock?.wyckoff || {};
  const entry = wyckoff.entry || stock?.wyckoffEntry || {};
  const tests = wyckoff.tests || {};
  const action = wyckoff.action || stock?.wyckoffAction || {};
  const plans = Array.isArray(entry.plans) ? entry.plans : [];
  const watch = Array.isArray(entry.watch) ? entry.watch : [];

  return {
    phase: wyckoff.phase || stock?.wyckoffPhase || null,
    stage: wyckoff.stage || stock?.wyckoffStage || null,
    label: wyckoff.label || null,
    bias: wyckoff.bias || stock?.wyckoffBias || null,
    confidence: toNumber(wyckoff.confidence, null),
    actionLabel: action.label || null,
    entryStatus: entry.status || null,
    entrySummary: entry.summary || null,
    plans,
    watch,
    testsSummary: tests.summary || null,
    activeSide: tests.activeSide || null,
  };
}

function getMarket(snapshot) {
  const market = snapshot?.market || {};
  const pulse = market.pulse || {};
  return {
    regime: market.regime || null,
    session: market.session || null,
    pulseStatus: pulse.status || null,
    exposure: pulse.exposure || null,
    distributionDays: toNumber(pulse.distributionDays, null),
    followThroughDate: pulse.followThrough?.date || null,
  };
}

function triggerDistancePct(stock, triggerPrice) {
  const price = toNumber(stock?.price, null);
  const trigger = toNumber(triggerPrice, null);
  if (price == null || trigger == null || price === 0) return null;
  return +(((trigger - price) / price) * 100).toFixed(2);
}

function primaryTrigger(stock, wyckoff) {
  const plan = wyckoff.plans[0] || null;
  if (plan && plan.price != null) {
    return {
      kind: "entry",
      price: toNumber(plan.price, null),
      label: plan.label || "Entry",
      reason: plan.reason || plan.why || null,
    };
  }

  const watch = wyckoff.watch[0] || null;
  if (watch && watch.price != null) {
    return {
      kind: "watch",
      price: toNumber(watch.price, null),
      label: watch.label || "Watch",
      reason: watch.why || null,
    };
  }

  return null;
}

function buildView(stock, snapshot) {
  const strength = getStrength(stock);
  const quality = getQuality(stock);
  const relative = getRelative(stock);
  const wyckoff = getWyckoff(stock);
  const market = getMarket(snapshot);
  const trigger = primaryTrigger(stock, wyckoff);
  const price = toNumber(stock?.price, null);
  const signal = stock?.signal || null;
  const confidence = toNumber(stock?.confidence, null);
  const shortCandidate = signal === "SELL" || signal === "STRONG_SELL" || wyckoff.bias === "avoid";
  const buyReady = (
    wyckoff.bias === "buy" ||
    wyckoff.bias === "buy_pilot" ||
    wyckoff.bias === "buy_pullback" ||
    wyckoff.entryStatus === "buy" ||
    wyckoff.entryStatus === "pilot" ||
    wyckoff.entryStatus === "buy_pilot"
  );
  const constructiveRepair = (
    wyckoff.phase === "Accumulation" &&
    (wyckoff.stage === "Phase A" || wyckoff.stage === "Phase B" || wyckoff.stage === "Phase C" || wyckoff.bias === "wait")
  );
  const structuralDamage = (
    wyckoff.phase === "Distribution" ||
    wyckoff.phase === "Markdown" ||
    wyckoff.bias === "avoid" ||
    signal === "SELL" ||
    signal === "STRONG_SELL"
  );

  return {
    ticker: normalizeTicker(stock?.ticker),
    name: getStockName(stock),
    sector: safeText(stock?.sector, "n/a"),
    price,
    signal,
    confidence,
    strength,
    quality,
    relative,
    wyckoff,
    market,
    trigger,
    triggerDistancePct: trigger ? triggerDistancePct(stock, trigger.price) : null,
    hasActivePlans: wyckoff.plans.length > 0,
    hasWatchTriggers: wyckoff.watch.length > 0,
    buyReady,
    constructiveRepair,
    structuralDamage,
    riskScore: computeRiskScore(stock, { strength, quality, relative, wyckoff, signal, confidence, market }),
    leadershipScore: computeLeadershipScore(stock, { strength, quality, relative, wyckoff, signal, market }),
  };
}

function computeLeadershipScore(stock, view) {
  let score = 0;
  if (view.strength.score != null) score += view.strength.score * 2;
  if (view.strength.percentile != null) score += view.strength.percentile * 0.5;
  if (view.relative.vsVNINDEX3m != null) score += Math.round(view.relative.vsVNINDEX3m * 100);
  if (view.relative.vsVN303m != null) score += Math.round(view.relative.vsVN303m * 60);
  if (view.quality.score != null) score += Math.round(view.quality.score * 0.3);
  if (view.wyckoff.bias === "buy" || view.wyckoff.bias === "buy_pilot" || view.wyckoff.bias === "buy_pullback") score += 18;
  if (view.signal === "BUY" || view.signal === "STRONG_BUY") score += 12;
  if (view.signal === "SELL" || view.signal === "STRONG_SELL") score -= 20;
  if (view.market?.regime === "bearish") score -= 8;
  return score;
}

function computeRiskScore(stock, view) {
  let score = 0;
  if (view.signal === "STRONG_SELL") score += 45;
  else if (view.signal === "SELL") score += 30;
  else if (view.signal === "HOLD") score += 10;
  if (view.wyckoff.phase === "Markdown") score += 25;
  else if (view.wyckoff.phase === "Distribution") score += 18;
  if (view.wyckoff.bias === "avoid") score += 12;
  if (view.relative.priceVsSma50Pct != null && view.relative.priceVsSma50Pct < 0) score += Math.min(20, Math.abs(view.relative.priceVsSma50Pct) * 0.6);
  if (view.relative.vsVNINDEX3m != null && view.relative.vsVNINDEX3m < 0) score += Math.min(12, Math.abs(view.relative.vsVNINDEX3m) * 100 * 0.35);
  if (view.strength.score != null) score += Math.max(0, 55 - view.strength.score) * 0.35;
  if (view.confidence != null) score += view.confidence * 0.5;
  if (view.market.regime === "bearish") score += 8;
  return score;
}

function listItemBase(view) {
  return {
    ticker: view.ticker,
    name: view.name,
    sector: view.sector,
    price: view.price,
    signal: view.signal,
    confidence: view.confidence,
    strength: view.strength,
    quality: view.quality,
    relative: view.relative,
    wyckoff: {
      phase: view.wyckoff.phase,
      stage: view.wyckoff.stage,
      label: view.wyckoff.label,
      bias: view.wyckoff.bias,
      confidence: view.wyckoff.confidence,
      entryStatus: view.wyckoff.entryStatus,
    },
    trigger: view.trigger,
    triggerDistancePct: view.triggerDistancePct,
  };
}

function buildLeadershipList(view) {
  const matched = (
    view.strength.score != null && view.strength.score >= 65 ||
    view.strength.marketLeader ||
    ["Strong", "Elite Leader"].includes(view.strength.label) ||
    (view.strength.rank != null && view.strength.rank <= 3)
  );

  if (!matched) return null;

  const reason = [
    view.strength.label ? `${view.strength.label} strength` : "strong CAN SLIM profile",
    view.relative.vsVNINDEX3m != null ? `RS vs index ${fmtSignedPct(view.relative.vsVNINDEX3m)}` : null,
    view.quality.score != null ? `quality ${view.quality.score}` : null,
  ].filter(Boolean).join(" | ");

  return {
    ...listItemBase(view),
    score: view.leadershipScore,
    reason,
  };
}

function buildNearEntryList(view) {
  const matched = view.buyReady || view.hasActivePlans || (view.constructiveRepair && view.trigger);
  if (!matched) return null;

  const reasonParts = [];
  if (view.buyReady) reasonParts.push("buy-ready Wyckoff bias");
  if (view.hasActivePlans) reasonParts.push("active long plan");
  if (view.trigger) reasonParts.push(`${view.trigger.label.toLowerCase()} ${view.trigger.price != null ? formatPrice(view.trigger.price) : "n/a"}`);
  if (view.triggerDistancePct != null) reasonParts.push(`distance ${fmtSignedPct(view.triggerDistancePct / 100, true)}`);

  return {
    ...listItemBase(view),
    score: buildEntryScore(view),
    reason: reasonParts.join(" | ") || "constructive near-entry setup",
  };
}

function buildRepairWatchList(view) {
  const matched = view.constructiveRepair || (view.wyckoff.bias === "wait" && view.hasWatchTriggers) || (view.strength.score != null && view.strength.score >= 40 && view.signal === "HOLD");
  if (!matched) return null;

  const reasonParts = [];
  if (view.constructiveRepair) reasonParts.push(`${safeText(view.wyckoff.label, "Accumulation")} repair`);
  if (view.hasWatchTriggers) reasonParts.push(`${view.wyckoff.watch.length} watch trigger(s)`);
  if (view.wyckoff.testsSummary) reasonParts.push(view.wyckoff.testsSummary);
  if (view.trigger) reasonParts.push(`trigger ${view.trigger.price != null ? formatPrice(view.trigger.price) : "n/a"}`);

  return {
    ...listItemBase(view),
    score: buildRepairScore(view),
    reason: reasonParts.join(" | ") || "repair watch",
  };
}

function buildBreakdownRiskList(view) {
  if (!view.structuralDamage) return null;
  const reasonParts = [];
  if (view.signal) reasonParts.push(view.signal);
  if (view.wyckoff.label) reasonParts.push(view.wyckoff.label);
  if (view.relative.priceVsSma50Pct != null) reasonParts.push(`price vs SMA50 ${fmtSignedPct(view.relative.priceVsSma50Pct / 100)}`);
  if (view.relative.vsVNINDEX3m != null) reasonParts.push(`RS vs index ${fmtSignedPct(view.relative.vsVNINDEX3m)}`);
  return {
    ...listItemBase(view),
    score: view.riskScore,
    reason: reasonParts.join(" | ") || "breakdown risk",
  };
}

function buildShortCandidateList(view) {
  const matched = (
    view.signal === "STRONG_SELL" ||
    (view.signal === "SELL" && view.structuralDamage) ||
    (view.wyckoff.phase === "Markdown" && view.wyckoff.bias === "avoid")
  );

  if (!matched) return null;

  const reasonParts = [];
  if (view.signal) reasonParts.push(view.signal);
  if (view.wyckoff.label) reasonParts.push(view.wyckoff.label);
  if (view.wyckoff.testsSummary) reasonParts.push(view.wyckoff.testsSummary);
  if (view.relative.vsVNINDEX3m != null) reasonParts.push(`RS vs index ${fmtSignedPct(view.relative.vsVNINDEX3m)}`);

  return {
    ...listItemBase(view),
    score: view.riskScore + (view.confidence || 0),
    reason: reasonParts.join(" | ") || "short candidate",
  };
}

function buildQualityList(view) {
  const qualityScore = view.quality.score != null ? view.quality.score : 0;
  const matched = qualityScore >= 80 && (view.quality.coveragePct == null || view.quality.coveragePct >= 85);
  if (!matched) return null;

  const reasonParts = [];
  if (view.quality.label) reasonParts.push(`${view.quality.label} quality`);
  if (view.quality.coveragePct != null) reasonParts.push(`coverage ${view.quality.coveragePct}%`);
  if (view.strength.label) reasonParts.push(view.strength.label);
  if (view.signal) reasonParts.push(view.signal);

  return {
    ...listItemBase(view),
    score: qualityScore + (view.strength.score || 0) * 0.25,
    reason: reasonParts.join(" | ") || "high-quality name",
  };
}

function buildEntryScore(view) {
  let score = 0;
  if (view.hasActivePlans) score += 30;
  if (view.buyReady) score += 20;
  if (view.triggerDistancePct != null) score += Math.max(0, 20 - Math.abs(view.triggerDistancePct));
  if (view.wyckoff.confidence != null) score += view.wyckoff.confidence * 0.2;
  if (view.strength.score != null) score += view.strength.score * 0.3;
  if (view.signal === "BUY" || view.signal === "STRONG_BUY") score += 10;
  if (view.signal === "SELL" || view.signal === "STRONG_SELL") score -= 15;
  return score;
}

function buildRepairScore(view) {
  let score = 0;
  if (view.constructiveRepair) score += 25;
  if (view.hasWatchTriggers) score += 10;
  if (view.wyckoff.bias === "wait") score += 8;
  if (view.wyckoff.testsSummary) score += 5;
  if (view.strength.score != null) score += view.strength.score * 0.2;
  if (view.quality.score != null) score += view.quality.score * 0.15;
  return score;
}

function fmtSignedPct(value, forceDecimal = false) {
  if (value == null || Number.isNaN(value)) return "n/a";
  const num = forceDecimal ? value : value;
  const rendered = Math.abs(num) >= 1 ? num.toFixed(1) : (num * 100).toFixed(1);
  const sign = num >= 0 ? "+" : "";
  return `${sign}${rendered}%`;
}

function formatPrice(value) {
  const num = toNumber(value, null);
  if (num == null) return "n/a";
  return Number.isInteger(num) ? num.toLocaleString("vi-VN") : num.toFixed(2);
}

function buildPresetItems(presetId, snapshot, options = {}) {
  const stocks = asStockArray(snapshot);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 12;
  const views = stocks.map((stock) => buildView(stock, snapshot));

  const builders = {
    leaders: buildLeadershipList,
    near_entry: buildNearEntryList,
    repair_watch: buildRepairWatchList,
    breakdown_risk: buildBreakdownRiskList,
    short_candidates: buildShortCandidateList,
    quality_names: buildQualityList,
  };

  const builder = builders[presetId];
  if (!builder) return [];

  const items = views
    .map((view) => builder(view))
    .filter(Boolean);

  items.sort((a, b) => {
    if (b.score !== a.score) return (b.score || -Infinity) - (a.score || -Infinity);
    if ((b.strength?.score || -Infinity) !== (a.strength?.score || -Infinity)) return (b.strength?.score || -Infinity) - (a.strength?.score || -Infinity);
    if ((b.confidence || -Infinity) !== (a.confidence || -Infinity)) return (b.confidence || -Infinity) - (a.confidence || -Infinity);
    return a.ticker.localeCompare(b.ticker);
  });

  return items.slice(0, limit);
}

function buildSmartList(snapshot, preset, options = {}) {
  const items = buildPresetItems(preset.id, snapshot, options);
  const market = getMarket(snapshot);
  const tickers = items.map((item) => item.ticker);
  const strengths = items.map((item) => item.strength?.score).filter((value) => value != null);
  const qualities = items.map((item) => item.quality?.score).filter((value) => value != null);

  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    count: items.length,
    tickers,
    items,
    meta: {
      snapshotGenerated: snapshot?.generated || null,
      marketRegime: market.regime,
      marketSession: market.session,
      pulseStatus: market.pulseStatus,
      exposure: market.exposure,
      distributionDays: market.distributionDays,
      followThroughDate: market.followThroughDate,
      averageStrength: strengths.length ? round(mean(strengths), 1) : null,
      averageQuality: qualities.length ? round(mean(qualities), 1) : null,
      topTicker: items[0]?.ticker || null,
      topReason: items[0]?.reason || null,
    },
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildSmartLists(snapshot, options = {}) {
  const presets = SMART_LIST_PRESETS.map((preset) => buildSmartList(snapshot, preset, options));
  return {
    generated: new Date().toISOString(),
    snapshotGenerated: snapshot?.generated || null,
    universeCount: asStockArray(snapshot).length,
    market: getMarket(snapshot),
    presets: SMART_LIST_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
    })),
    lists: presets,
    byId: Object.fromEntries(presets.map((list) => [list.id, list])),
    summary: {
      totalLists: presets.length,
      populatedLists: presets.filter((list) => list.count > 0).length,
      totalMatches: presets.reduce((sum, list) => sum + list.count, 0),
      topLeaders: presets.find((list) => list.id === "leaders")?.tickers || [],
    },
  };
}

function getSmartList(snapshot, listId, options = {}) {
  const preset = SMART_LIST_PRESETS.find((item) => item.id === listId);
  if (!preset) return null;
  return buildSmartList(snapshot, preset, options);
}

function buildSmartListIndex(snapshot, options = {}) {
  return Object.fromEntries(
    buildSmartLists(snapshot, options).lists.map((list) => [list.id, list])
  );
}

module.exports = {
  SMART_LIST_PRESETS,
  buildSmartLists,
  buildSmartList,
  buildSmartListIndex,
  getSmartList,
  buildPresetItems,
  normalizeTicker,
};
