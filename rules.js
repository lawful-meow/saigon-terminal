// ─── rules.js ──────────────────────────────────────────────────────────────────
// Scoring engine. Takes computed metrics + config thresholds → scores.
// Pure functions. To change scoring: edit config.js thresholds, not this file.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");

function thresholdScore(value, thresholds) {
  if (value == null) return 5;
  for (let i = 0; i < thresholds.length; i++) {
    if (value < thresholds[i]) return 2 + i * 2;
  }
  return 10;
}

function scoreCanSlim(metrics) {
  const legacyScores = {};
  const observedScores = {};
  const factorBreakdown = {};

  let legacyTotal = 0;
  let observedTotal = 0;
  let observedMax = 0;

  for (const [factor, rule] of Object.entries(config.canslim)) {
    const rawValue = metrics[rule.metric];
    const legacyScore = thresholdScore(rawValue, rule.thresholds);
    const observedScore = rawValue == null ? null : thresholdScore(rawValue, rule.thresholds);
    const status = rawValue == null ? "unknown" : "observed";

    legacyScores[factor] = legacyScore;
    observedScores[factor] = observedScore;
    legacyTotal += legacyScore;

    if (observedScore != null) {
      observedTotal += observedScore;
      observedMax += 10;
    }

    factorBreakdown[factor] = {
      metric: rule.metric,
      rawValue,
      thresholds: rule.thresholds.slice(),
      score: observedScore,
      status,
      legacyScore,
    };
  }

  const factorCount = Object.keys(config.canslim).length || 1;
  const coveragePct = +((observedMax / (factorCount * 10)) * 100).toFixed(1);

  return {
    scores: legacyScores,
    observedScores,
    total: legacyTotal,
    observedTotal,
    observedMax,
    coveragePct,
    factorBreakdown,
  };
}

function classifyVolume(metrics) {
  const ratio = metrics.volRatio;
  const rules = config.volumeRules;

  if (ratio >= rules.CLIMAX.min) return "CLIMAX";
  if (ratio >= rules.ABOVE_AVG.min) return "ABOVE_AVG";
  if (ratio >= rules.NORMAL.min) return "NORMAL";
  return "DRY_UP";
}

function classifyWyckoff(metrics) {
  return metrics.wyckoff?.phase || "Unknown";
}

function normalizedCanSlimTotal(canslim) {
  if (!canslim || canslim.observedMax <= 0) return 35;
  return +((canslim.observedTotal / canslim.observedMax) * 70).toFixed(1);
}

function buildStrengthProfile(canslim, metrics) {
  const strengthConfig = config.strength || {};
  const relVsIndex = metrics.relative?.vsVNINDEX3m ?? metrics.rs3m ?? null;
  const priceVsSma50 = metrics.relative?.priceVsSma50Pct ?? null;
  const coveragePct = canslim?.coveragePct ?? 0;
  const csRatio = canslim?.observedMax > 0 ? canslim.observedTotal / canslim.observedMax : 0.5;
  let score = csRatio * 70;

  if (relVsIndex != null) {
    if (relVsIndex >= 0.15) score += 15;
    else if (relVsIndex >= (strengthConfig.leaderRsThreshold ?? 0.05)) score += 10;
    else if (relVsIndex >= 0) score += 5;
    else if (relVsIndex <= -0.10) score -= 10;
    else if (relVsIndex <= (strengthConfig.weakRsThreshold ?? -0.05)) score -= 6;
  }

  if (metrics.aboveSMA50 && metrics.sma20AboveSMA50) score += 10;
  else if (priceVsSma50 != null && priceVsSma50 >= -3) score += 3;
  else if (priceVsSma50 != null && priceVsSma50 <= -12) score -= 10;
  else if (priceVsSma50 != null && priceVsSma50 < 0) score -= 4;

  if (coveragePct < 40) score -= 8;
  else if (coveragePct < 70) score -= 4;

  score = Math.max(0, Math.min(100, score));

  let label = "Weak";
  if (score >= (strengthConfig.eliteScore ?? 80)) label = "Elite Leader";
  else if (score >= (strengthConfig.strongScore ?? 65)) label = "Strong";
  else if (score >= (strengthConfig.watchScore ?? 50)) label = "Watch";

  return {
    score: +score.toFixed(1),
    label,
    canSlimRatio: +(csRatio * 100).toFixed(1),
    marketLeader: relVsIndex != null && relVsIndex >= (strengthConfig.leaderRsThreshold ?? 0.05),
  };
}

function computeSignal(canslim, metrics) {
  const strengthProfile = buildStrengthProfile(canslim, metrics);
  const strengthScore = normalizedCanSlimTotal(canslim);
  const wyckoff = metrics.wyckoff || {};
  const wyckoffBias = wyckoff.bias || "wait";
  const wyckoffCode = wyckoff.code || null;
  const wyckoffConfidence = wyckoff.confidence == null ? 55 : wyckoff.confidence;
  const relVsIndex = metrics.relative?.vsVNINDEX3m ?? metrics.rs3m ?? null;
  const priceVsSma50 = metrics.relative?.priceVsSma50Pct ?? null;
  const marketRegime = metrics.marketContext?.regime || "unknown";
  const marketPulse = metrics.marketContext?.pulse?.status || "unknown";

  const strongTicker = strengthProfile.score >= (config.strength?.strongScore ?? 65);
  const provenLeader = relVsIndex != null && relVsIndex >= (config.strength?.leaderRsThreshold ?? 0.05);
  const severeWeakness = (relVsIndex != null && relVsIndex <= -0.08) ||
    (priceVsSma50 != null && priceVsSma50 <= -12);
  const trendSupportive = metrics.aboveSMA50 && metrics.sma20AboveSMA50;
  const trendDamaged = metrics.belowSMA50 && metrics.sma20BelowSMA50;
  const repairing = wyckoffCode === "acc_b" || wyckoffCode === "acc_c" || wyckoffCode === "acc_d";

  let rawScore = 50;
  if (wyckoffBias === "buy" || wyckoffBias === "buy_pullback") rawScore += 22;
  else if (wyckoffBias === "buy_pilot") rawScore += 14;
  else if (wyckoffBias === "wait_pullback") rawScore += 6;
  else if (wyckoffBias === "avoid") rawScore -= 22;

  if (strongTicker) rawScore += 8;
  else if (strengthScore < 28) rawScore -= 8;

  if (provenLeader) rawScore += 6;
  else if (severeWeakness) rawScore -= 8;

  if (trendSupportive) rawScore += 5;
  else if (trendDamaged) rawScore -= 5;

  if (marketPulse === "confirmed_uptrend") rawScore += 5;
  else if (marketPulse === "uptrend_under_pressure") rawScore += 1;
  else if (marketPulse === "rally_attempt") rawScore -= 1;
  else if (marketPulse === "correction") rawScore -= 5;
  else if (marketRegime === "bullish" || marketRegime === "constructive") rawScore += 2;
  else if (marketRegime === "bearish") rawScore -= 3;

  if (repairing && wyckoffBias === "wait" && relVsIndex != null && relVsIndex >= -0.01) rawScore += 4;

  if (canslim.coveragePct < 40) rawScore -= 4;
  else if (canslim.coveragePct < 70) rawScore -= 2;

  let signal = "HOLD";
  if (wyckoffBias === "buy" || wyckoffBias === "buy_pullback" || wyckoffBias === "buy_pilot") {
    signal = "BUY";
    if ((wyckoffBias === "buy" || wyckoffBias === "buy_pullback") &&
      (strongTicker || provenLeader) &&
      trendSupportive &&
      marketPulse !== "correction" &&
      marketRegime !== "bearish") {
      signal = "STRONG_BUY";
    }
  } else if (wyckoffBias === "avoid") {
    signal = severeWeakness || marketPulse === "correction" || marketRegime === "bearish" ? "STRONG_SELL" : "SELL";
  } else if (wyckoffBias === "wait" || wyckoffBias === "wait_pullback") {
    signal = "HOLD";
  }

  let conviction = wyckoffConfidence / 10;
  if (strongTicker) conviction += 1.2;
  else if (strengthScore < 28) conviction -= 1.0;

  if (provenLeader) conviction += 0.8;
  else if (severeWeakness) conviction -= 0.8;

  if (trendSupportive) conviction += 0.8;
  else if (trendDamaged) conviction -= 0.8;

  if (marketPulse === "confirmed_uptrend") {
    conviction += signal.includes("BUY") ? 1.0 : 0.5;
  } else if (marketPulse === "uptrend_under_pressure") {
    conviction += signal.includes("BUY") ? 0.2 : 0;
  } else if (marketPulse === "rally_attempt") {
    conviction -= signal.includes("BUY") ? 0.5 : 0;
  } else if (marketPulse === "correction") {
    conviction += signal.includes("SELL") ? 0.8 : -1.0;
  } else if (marketRegime === "bullish" || marketRegime === "constructive") {
    conviction += signal.includes("BUY") ? 0.8 : 0.4;
  } else if (marketRegime === "defensive") {
    conviction += signal.includes("SELL") ? 0.4 : -0.4;
  } else if (marketRegime === "bearish") {
    conviction += signal.includes("SELL") ? 0.8 : -0.8;
  }

  if (canslim.coveragePct < 40) conviction -= 1.0;
  else if (canslim.coveragePct < 70) conviction -= 0.5;

  if (wyckoffBias === "wait" || wyckoffBias === "wait_pullback") {
    conviction = Math.min(conviction, 6.5);
  }

  const confidence = Math.max(1, Math.min(10, Math.round(conviction)));

  return {
    signal,
    confidence,
    rawScore: +rawScore.toFixed(1),
    normalizedCanSlim: strengthScore,
    strength: strengthProfile,
  };
}

function applyRules(metrics) {
  const canslim = scoreCanSlim(metrics);
  const volumeSignal = classifyVolume(metrics);
  const wyckoffPhase = classifyWyckoff(metrics);
  const signalState = computeSignal(canslim, metrics);

  return {
    canslim: canslim.scores,
    observedCanSlim: canslim.observedScores,
    canslimTotal: canslim.total,
    observedCanSlimTotal: canslim.observedTotal,
    observedCanSlimMax: canslim.observedMax,
    coveragePct: canslim.coveragePct,
    factorBreakdown: canslim.factorBreakdown,
    normalizedCanSlim: signalState.normalizedCanSlim,
    strength: signalState.strength,
    volumeSignal,
    wyckoffPhase,
    wyckoffStage: metrics.wyckoff?.stage || null,
    wyckoffBias: metrics.wyckoff?.bias || null,
    wyckoffConfidence: metrics.wyckoff?.confidence || null,
    signal: signalState.signal,
    confidence: signalState.confidence,
    rawScore: signalState.rawScore,
  };
}

module.exports = {
  applyRules,
  scoreCanSlim,
  classifyVolume,
  classifyWyckoff,
  computeSignal,
  thresholdScore,
};
