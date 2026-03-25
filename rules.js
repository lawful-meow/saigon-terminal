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

function computeSignal(canslim, metrics) {
  let score = 0;

  score += normalizedCanSlimTotal(canslim) / 2;

  const rsi = metrics.rsi14 || 50;
  if (rsi >= 40 && rsi <= 60) score += 10;
  else if (rsi >= 30 && rsi <= 70) score += 7;
  else if (rsi < 30) score += 12;
  else score += 3;

  if (metrics.aboveSMA50 && metrics.sma20AboveSMA50) score += 15;
  else if (metrics.aboveSMA50) score += 10;
  else if (metrics.belowSMA50 && metrics.sma20BelowSMA50) score += 2;
  else score += 6;

  const volSig = classifyVolume(metrics);
  if (volSig === "ABOVE_AVG" && metrics.aboveSMA50) score += 10;
  else if (volSig === "NORMAL") score += 6;
  else if (volSig === "CLIMAX") score += 4;
  else score += 2;

  const wyckoffBias = metrics.wyckoff?.bias || "wait";
  if (wyckoffBias === "buy" || wyckoffBias === "buy_pullback") score += 8;
  else if (wyckoffBias === "buy_pilot") score += 5;
  else if (wyckoffBias === "wait_pullback") score += 2;
  else if (wyckoffBias === "avoid") score -= 7;

  if (canslim.coveragePct < 40) score -= 4;
  else if (canslim.coveragePct < 70) score -= 2;

  const pct = score / 75;
  let signal;
  let confidence;

  if (pct >= 0.85) {
    signal = "STRONG_BUY";
    confidence = Math.min(10, Math.round(pct * 10));
  } else if (pct >= 0.70) {
    signal = "BUY";
    confidence = Math.round(pct * 10);
  } else if (pct >= 0.45) {
    signal = "HOLD";
    confidence = Math.round(pct * 10);
  } else if (pct >= 0.30) {
    signal = "SELL";
    confidence = Math.round(pct * 10);
  } else {
    signal = "STRONG_SELL";
    confidence = Math.round(pct * 10);
  }

  return {
    signal,
    confidence: Math.max(1, Math.min(10, confidence)),
    rawScore: +score.toFixed(1),
    normalizedCanSlim: normalizedCanSlimTotal(canslim),
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
