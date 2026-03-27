// ─── formatter.js ──────────────────────────────────────────────────────────────
// Formats scan results for API responses and prompt export.
// The terminal consumes one rich snapshot so UI and prompt stay coherent.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");
const { buildAlertCenter } = require("./alerts");
const { buildSmartLists } = require("./smartlists");
const { normalizeLanguage, t } = require("./i18n");

function fmtK(n) {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function fmtPct(n, scale = 100, digits = 1) {
  if (n == null) return "—";
  const value = typeof n === "number" ? n * scale : n;
  return `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;
}

function fmtSignedPct(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const FACTOR_KEYS = ["C", "A", "N", "S", "L", "I", "M"];
const METRIC_META = {
  epsGrowthQoQ: { key: "metric.epsGrowthQoQ", kind: "pct" },
  epsGrowth1Y: { key: "metric.epsGrowth1Y", kind: "pct" },
  nearHighPct: { key: "metric.nearHighPct", kind: "pct_of_high" },
  volScore: { key: "metric.volScore", kind: "multiple" },
  rs3m: { key: "metric.rs3m", kind: "pct" },
  institutionScore: { key: "metric.institutionScore", kind: "pct" },
  marketTrend: { key: "metric.marketTrend", kind: "score" },
};

function signalLabel(signal, language = "en") {
  return t(language, `signal.${signal}`) || String(signal || "UNKNOWN").replace(/_/g, " ");
}

function confidenceLabel(confidence, language = "en") {
  if (confidence >= 8) return t(language, "confidence.high");
  if (confidence >= 5) return t(language, "confidence.medium");
  return t(language, "confidence.low");
}

function summarizeCoverage(coveragePct, language = "en") {
  if (coveragePct >= 85) return t(language, "coverage.strong");
  if (coveragePct >= 60) return t(language, "coverage.usable");
  return t(language, "coverage.thin");
}

function factorLabel(factor, language = "en") {
  return t(language, `factor.${factor}`);
}

function metricLabel(metric, language = "en") {
  const meta = METRIC_META[metric];
  if (!meta?.key) return String(metric || "");
  return t(language, meta.key);
}

function qualityScore(metrics, scores) {
  let score = 100;
  if (scores.coveragePct < 100) score -= Math.round((100 - scores.coveragePct) * 0.7);
  if (scores.coveragePct < 60) score -= 10;
  else if (scores.coveragePct < 80) score -= 4;
  if (!metrics.meta.snapshotOverlayUsed) score -= 10;
  if (metrics.meta.freshnessSec != null && metrics.meta.freshnessSec > 180) score -= 10;
  if (metrics.meta.snapshotFailed) score -= 6;
  if (String(metrics.meta.sourceFlags.fundamentals).includes("unavailable")) score -= 6;
  if (String(metrics.meta.sourceFlags.ownership).includes("unavailable")) score -= 6;
  if (metrics.meta.sourceFlags.foreign === "unavailable") score -= 4;
  if (metrics.wyckoff?.confidence != null && metrics.wyckoff.confidence < 70) {
    score -= Math.max(2, Math.round((70 - metrics.wyckoff.confidence) / 6));
  }
  const overviewWarnings = actionableOverviewWarnings(metrics);
  if (overviewWarnings.length) {
    score -= Math.min(6, overviewWarnings.length * 2);
  }
  return Math.max(0, Math.min(100, score));
}

function qualityLabel(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function actionableOverviewWarnings(metrics) {
  return (metrics.meta.overviewWarnings || []).filter((warning) => !/quarantined/i.test(String(warning || "")));
}

function buildWarnings(metrics, scores, language = "en") {
  const warnings = [];
  const warningKeys = [];
  const pushWarning = (key, vars = {}) => {
    warningKeys.push({ key, vars });
    warnings.push(t(language, key, vars));
  };

  const missingFactors = Object.entries(scores.factorBreakdown)
    .filter(([, factor]) => factor.status === "unknown")
    .map(([factor]) => factor);

  if (missingFactors.length) pushWarning("warning.missing_factors", { factors: missingFactors.join("/") });
  if (String(metrics.meta.sourceFlags.fundamentals).includes("unavailable")) pushWarning("warning.fundamentals_unavailable");
  if (String(metrics.meta.sourceFlags.ownership).includes("unavailable")) pushWarning("warning.ownership_unavailable");
  if (metrics.meta.sourceFlags.foreign === "unavailable") pushWarning("warning.foreign_unavailable");
  if (!metrics.meta.snapshotOverlayUsed) pushWarning("warning.price_history_only");
  if (metrics.meta.snapshotFailed && metrics.meta.snapshotError) pushWarning("warning.snapshot_fallback", { error: metrics.meta.snapshotError });
  if (metrics.meta.freshnessSec != null && metrics.meta.freshnessSec > 180) pushWarning("warning.snapshot_stale");
  if (metrics.wyckoff?.confidence != null && metrics.wyckoff.confidence < 55) pushWarning("warning.wyckoff_low_confidence");
  warnings.push(...actionableOverviewWarnings(metrics));
  return { warnings, warningKeys };
}

function missingFields(metrics) {
  return [
    "pe",
    "pb",
    "eps",
    "roe",
    "marketCap",
    "foreignNet5d",
    "epsGrowthQoQ",
    "epsGrowth1Y",
  ].filter((field) => metrics[field] == null);
}

function fmtPctPlain(n, digits = 1) {
  if (n == null) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
}

function metricFormat(metric, value, { threshold = false, language = "en" } = {}) {
  if (value == null) return t(language, "metric.unknown");
  const meta = METRIC_META[metric] || { kind: "raw" };

  switch (meta.kind) {
    case "pct":
      return threshold ? fmtPctPlain(value, 1) : fmtPct(value, 100, 1);
    case "pct_of_high":
      return threshold ? fmtPctPlain(value, 1) : t(language, "metric.of_52w_high", { value: fmtPctPlain(value, 1) });
    case "multiple":
      return `${Number(value).toFixed(2)}x`;
    case "score":
      return Number(value).toFixed(2);
    default:
      return String(value);
  }
}

function thresholdBand(score, thresholds) {
  if (score == null) return { lower: null, upper: null };
  if (score === 2) return { lower: null, upper: thresholds[0] };
  if (score === 10) return { lower: thresholds[thresholds.length - 1], upper: null };
  const upperIndex = Math.round((score - 2) / 2);
  return {
    lower: thresholds[upperIndex - 1],
    upper: thresholds[upperIndex],
  };
}

function bandLabel(metric, lower, upper, language = "en") {
  if (lower == null && upper == null) return t(language, "band.unknown");
  if (lower == null) return t(language, "band.lt", { value: metricFormat(metric, upper, { threshold: true, language }) });
  if (upper == null) return t(language, "band.gte", { value: metricFormat(metric, lower, { threshold: true, language }) });
  return t(language, "band.range", {
    lower: metricFormat(metric, lower, { threshold: true, language }),
    upper: metricFormat(metric, upper, { threshold: true, language }),
  });
}

function breakoutVolumeSupport(volRatio) {
  if (!Number.isFinite(volRatio)) return "unknown";
  if (volRatio >= 1.3) return "above_avg";
  if (volRatio >= 1) return "building";
  if (volRatio >= 0.7) return "neutral";
  return "dry";
}

function breakoutReason(parts) {
  return parts.filter(Boolean).join("; ");
}

function breakoutVolumeSupportLabel(value, language = "en") {
  return t(language, `breakout.volume.${value || "unknown"}`);
}

function buildBreakout(metrics, language = "en") {
  const entry = metrics.wyckoff?.entry || {};
  const primaryPlan = (entry.plans || []).find((plan) =>
    Number.isFinite(plan.price) && (plan.kind === "buy" || plan.kind === "wait")
  ) || null;
  const watchTrigger = (entry.watch || []).find((item) => Number.isFinite(item.price)) || null;
  const triggerPrice = primaryPlan?.price ?? watchTrigger?.price ?? null;
  const distancePct = Number.isFinite(triggerPrice)
    ? +((metrics.price / triggerPrice - 1) * 100).toFixed(2)
    : null;
  const invalidation = primaryPlan?.stop ?? entry.invalidation ?? null;
  const volSupport = breakoutVolumeSupport(metrics.volRatio);
  const relVsIndex = metrics.relative?.vsVNINDEX3m ?? null;
  const priceVsSma20 = metrics.relative?.priceVsSma20Pct ?? null;
  const priceVsSma50 = metrics.relative?.priceVsSma50Pct ?? null;
  const weakContext = metrics.wyckoff?.bias === "avoid" ||
    triggerPrice == null ||
    (relVsIndex != null && relVsIndex < -0.05 && !metrics.nearHigh);

  let state = "not_ready";
  if (!weakContext) {
    if (distancePct > 3) state = "extended";
    else if (distancePct >= 0) state = "triggered";
    else if (distancePct >= -2) state = "near_trigger";
    else state = "arming";
  }

  let score = 35;
  if (state === "arming") score += 12;
  else if (state === "near_trigger") score += 25;
  else if (state === "triggered") score += 30;
  else if (state === "extended") score += 20;
  else score -= 15;

  if (relVsIndex != null) {
    if (relVsIndex >= 0.05) score += 15;
    else if (relVsIndex >= 0) score += 8;
    else if (relVsIndex < -0.05) score -= 10;
  }

  if (metrics.nearHigh) score += 10;
  else if (metrics.nearHighPct >= 0.85) score += 5;

  if (metrics.rangeCompression) score += 10;
  if (priceVsSma20 != null && priceVsSma20 >= 0) score += 6;
  if (priceVsSma50 != null && priceVsSma50 >= 0) score += 8;
  else if (priceVsSma50 != null && priceVsSma50 < -5) score -= 8;

  if (metrics.volRatio >= 1.3) score += 10;
  else if (metrics.volRatio >= 1) score += 6;
  else if (metrics.volRatio < 0.7) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    state,
    score,
    triggerPrice,
    distancePct,
    invalidation,
    volumeSupport: volSupport,
    reason: breakoutReason([
      primaryPlan ? primaryPlan.label : watchTrigger?.label || t(language, "breakout.no_active_trigger"),
      relVsIndex == null ? null : t(language, "breakout.rs_vs_vnindex", { value: fmtPct(relVsIndex, 100, 1) }),
      metrics.nearHigh ? t(language, "breakout.near_52w_highs") : null,
      metrics.rangeCompression ? t(language, "breakout.range_compressed") : null,
      t(language, "breakout.volume", { state: breakoutVolumeSupportLabel(volSupport, language) }),
    ]),
  };
}

function roundLot(shares, lotSize) {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  return Math.floor(shares / lotSize) * lotSize;
}

function buildExecutionRisk(metrics) {
  const riskConfig = config.risk || {};
  const lotSize = riskConfig.lotSize || 100;
  const accountSize = riskConfig.accountSizeVnd || 1_000_000_000;
  const fullRiskBudget = accountSize * (riskConfig.fullRiskPct || 0.005);
  const pilotRiskBudget = accountSize * (riskConfig.pilotRiskPct || 0.0025);
  const maxPositionBudget = accountSize * (riskConfig.maxPositionPct || 0.10);
  const minAvgValue20 = riskConfig.minAvgValue20Vnd || 50_000_000_000;
  const activePlan = (metrics.wyckoff?.entry?.plans || []).find((plan) =>
    plan.kind === "buy" && Number.isFinite(plan.price) && Number.isFinite(plan.stop)
  ) || null;
  const entryPrice = activePlan?.price ?? null;
  const stopPrice = activePlan?.stop ?? null;
  const perShareRisk = Number.isFinite(entryPrice) && Number.isFinite(stopPrice)
    ? Math.abs(entryPrice - stopPrice)
    : null;
  const stopDistancePct = Number.isFinite(perShareRisk) && Number.isFinite(entryPrice) && entryPrice > 0
    ? +((perShareRisk / entryPrice) * 100).toFixed(2)
    : null;
  const stopDistanceAtr = Number.isFinite(perShareRisk) && Number.isFinite(metrics.atr14) && metrics.atr14 > 0
    ? +(perShareRisk / metrics.atr14).toFixed(2)
    : null;
  const fullShares = Number.isFinite(perShareRisk) && perShareRisk > 0
    ? roundLot(Math.min(fullRiskBudget / perShareRisk, maxPositionBudget / entryPrice), lotSize)
    : 0;
  const pilotShares = Number.isFinite(perShareRisk) && perShareRisk > 0
    ? roundLot(Math.min(pilotRiskBudget / perShareRisk, maxPositionBudget / entryPrice), lotSize)
    : 0;
  const tradedValue = metrics.tradedValue || 0;
  const avgValue20 = metrics.avgValue20 || 0;
  const weakTurnover = tradedValue > 0 && avgValue20 > 0 && tradedValue < avgValue20 * 0.75;

  let status = "ready";
  let liquidityLabel = "tradeable";
  let reason = "Sizing available from active buy plan.";

  if (!activePlan || !Number.isFinite(perShareRisk) || perShareRisk <= 0) {
    status = "unavailable";
    liquidityLabel = "trap_risk";
    reason = "No valid active buy plan with entry and stop exists yet.";
  } else if (avgValue20 < minAvgValue20 || stopDistancePct > 12) {
    liquidityLabel = "trap_risk";
    reason = avgValue20 < minAvgValue20
      ? "Average value traded is below the minimum liquidity threshold."
      : "Stop distance is too wide for a controlled execution plan.";
  } else if (stopDistancePct >= 8 || avgValue20 < minAvgValue20 * 1.5 || weakTurnover) {
    liquidityLabel = "caution";
    reason = stopDistancePct >= 8
      ? "Stop distance is wide enough to require caution."
      : (avgValue20 < minAvgValue20 * 1.5
        ? "Liquidity clears the floor but still sits near the minimum threshold."
        : "Current turnover is lagging the recent average.");
  }

  return {
    status,
    liquidityLabel,
    avgValue20,
    tradedValue,
    stopDistancePct,
    stopDistanceAtr,
    riskReward1: activePlan?.riskReward1 ?? null,
    riskReward2: activePlan?.riskReward2 ?? null,
    pilotShares,
    fullShares,
    pilotNotional: pilotShares > 0 && entryPrice ? Math.round(pilotShares * entryPrice) : 0,
    fullNotional: fullShares > 0 && entryPrice ? Math.round(fullShares * entryPrice) : 0,
    reason,
  };
}

function factorReason(factor, detail) {
  const factorName = factorLabel(factor);
  const metricName = metricLabel(detail.metric);

  if (detail.rawValue == null) {
    return `No ${metricName.toLowerCase()} value is available, so ${factorName.toLowerCase()} stays unknown and is excluded from observed CAN SLIM.`;
  }

  const band = thresholdBand(detail.score, detail.thresholds);
  const value = metricFormat(detail.metric, detail.rawValue);
  if (band.lower == null) {
    return `${metricName} is ${value}, below ${metricFormat(detail.metric, band.upper, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
  }
  if (band.upper == null) {
    return `${metricName} is ${value}, at or above ${metricFormat(detail.metric, band.lower, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
  }
  return `${metricName} is ${value}, between ${metricFormat(detail.metric, band.lower, { threshold: true })} and ${metricFormat(detail.metric, band.upper, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
}

function buildBands(metric, thresholds, activeScore) {
  return [
    { score: 2, label: `< ${metricFormat(metric, thresholds[0], { threshold: true })}`, active: activeScore === 2 },
    { score: 4, label: `${metricFormat(metric, thresholds[0], { threshold: true })} to ${metricFormat(metric, thresholds[1], { threshold: true })}`, active: activeScore === 4 },
    { score: 6, label: `${metricFormat(metric, thresholds[1], { threshold: true })} to ${metricFormat(metric, thresholds[2], { threshold: true })}`, active: activeScore === 6 },
    { score: 8, label: `${metricFormat(metric, thresholds[2], { threshold: true })} to ${metricFormat(metric, thresholds[3], { threshold: true })}`, active: activeScore === 8 },
    { score: 10, label: `>= ${metricFormat(metric, thresholds[3], { threshold: true })}`, active: activeScore === 10 },
  ];
}

function factorBreakdown(scores) {
  return Object.fromEntries(
    Object.entries(scores.factorBreakdown).map(([factor, detail]) => {
      const band = thresholdBand(detail.score, detail.thresholds);
      return [factor, {
        ...detail,
        factorLabel: factorLabel(factor),
        metricLabel: metricLabel(detail.metric),
        displayValue: metricFormat(detail.metric, detail.rawValue),
        bandLabel: detail.score == null ? "Unknown" : bandLabel(detail.metric, band.lower, band.upper),
        bands: buildBands(detail.metric, detail.thresholds, detail.score),
        reason: factorReason(factor, detail),
      }];
    })
  );
}

function driverText(metrics, scores, warnings) {
  const positives = [];
  const negatives = [];

  if (metrics.relative.vsVNINDEX3m != null && metrics.relative.vsVNINDEX3m > 0) {
    positives.push(`RS vs VNINDEX 3M ${fmtPct(metrics.relative.vsVNINDEX3m, 100, 1)}`);
  } else if (metrics.relative.vsVNINDEX3m != null) {
    negatives.push(`RS vs VNINDEX 3M ${fmtPct(metrics.relative.vsVNINDEX3m, 100, 1)}`);
  }

  if (metrics.relative.priceVsSma50Pct != null && metrics.relative.priceVsSma50Pct > 0) {
    positives.push(`Price ${fmtPct(metrics.relative.priceVsSma50Pct / 100, 100, 1)} above SMA50`);
  } else if (metrics.relative.priceVsSma50Pct != null) {
    negatives.push(`Price ${fmtPct(metrics.relative.priceVsSma50Pct / 100, 100, 1)} vs SMA50`);
  }

  if (metrics.volRatio >= 1.3) positives.push(`Volume ${metrics.volRatio}x avg20`);
  else if (metrics.volRatio < 0.7) negatives.push(`Volume only ${metrics.volRatio}x avg20`);

  if (metrics.rsi14 != null && metrics.rsi14 >= 40 && metrics.rsi14 <= 65) positives.push(`RSI ${metrics.rsi14} in healthy range`);
  else if (metrics.rsi14 != null && metrics.rsi14 > 75) negatives.push(`RSI ${metrics.rsi14} stretched`);

  if (metrics.marketContext.regime === "bullish" || metrics.marketContext.regime === "constructive") {
    positives.push(`Market regime ${metrics.marketContext.regime}`);
  } else if (metrics.marketContext.regime !== "unknown") {
    negatives.push(`Market regime ${metrics.marketContext.regime}`);
  }

  if (scores.strength?.label === "Elite Leader" || scores.strength?.label === "Strong") {
    positives.push(`CAN SLIM strength ${scores.strength.label} (${scores.strength.score}/100)`);
  } else if (scores.strength?.label === "Weak") {
    negatives.push(`CAN SLIM strength ${scores.strength.label} (${scores.strength.score}/100)`);
  }

  if (metrics.wyckoff?.bias === "buy" || metrics.wyckoff?.bias === "buy_pullback" || metrics.wyckoff?.bias === "buy_pilot") {
    positives.push(`Wyckoff ${metrics.wyckoff.label}`);
  } else if (metrics.wyckoff?.phase === "Distribution" || metrics.wyckoff?.phase === "Markdown") {
    negatives.push(`Wyckoff ${metrics.wyckoff.label}`);
  }

  if (scores.coveragePct < 60) negatives.push(`Coverage only ${scores.coveragePct}%`);
  warnings.forEach((warning) => negatives.push(warning));

  return {
    positives: positives.slice(0, 4),
    negatives: negatives.slice(0, 5),
  };
}

function historyMini(history = [], currentSnapshot) {
  const existing = history.slice(-4).map((scan) => ({
    timestamp: scan.scanTime || scan.timestamp,
    price: scan.price,
    signal: scan.signal,
    confidence: scan.confidence,
    observedPct: scan.coveragePct != null && scan.observedCanSlimMax
      ? +(scan.observedCanSlimTotal / scan.observedCanSlimMax).toFixed(2)
      : (scan.canslimTotal != null ? +(scan.canslimTotal / 70).toFixed(2) : null),
  }));

  existing.push({
    timestamp: currentSnapshot.scanTime,
    price: currentSnapshot.price,
    signal: currentSnapshot.signal,
    confidence: currentSnapshot.confidence,
    observedPct: currentSnapshot.observedCanSlimMax
      ? +(currentSnapshot.observedCanSlimTotal / currentSnapshot.observedCanSlimMax).toFixed(2)
      : null,
  });

  return existing.slice(-5);
}

function describeDelta(metrics, scores, prev) {
  const parts = [];
  if (prev.price && metrics.price !== prev.price) {
    const delta = ((metrics.price / prev.price - 1) * 100).toFixed(1);
    parts.push(`price ${delta >= 0 ? "+" : ""}${delta}%`);
  }
  if (prev.signal && scores.signal !== prev.signal) {
    parts.push(`signal ${prev.signal}→${scores.signal}`);
  }
  if (prev.wyckoffPhase && scores.wyckoffPhase !== prev.wyckoffPhase) {
    parts.push(`wyckoff ${prev.wyckoffPhase}→${scores.wyckoffPhase}`);
  }
  if (prev.observedCanSlimTotal != null && scores.observedCanSlimTotal !== prev.observedCanSlimTotal) {
    parts.push(`observed CS ${prev.observedCanSlimTotal}→${scores.observedCanSlimTotal}`);
  } else if (prev.canslimTotal != null && scores.canslimTotal !== prev.canslimTotal) {
    parts.push(`CS ${prev.canslimTotal}→${scores.canslimTotal}`);
  }
  return parts.length ? parts.join(", ") : "no change";
}

function tickerSnapshot(ticker, stockInfo, metrics, scores, prevScan, history = []) {
  const warningState = buildWarnings(metrics, scores);
  const warnings = warningState.warnings;
  const drivers = driverText(metrics, scores, warnings);
  const qScore = qualityScore(metrics, scores);
  const breakout = buildBreakout(metrics);
  const executionRisk = buildExecutionRisk(metrics);

  const snapshot = {
    ticker,
    name: stockInfo.name,
    sector: stockInfo.sector,
    scanTime: new Date().toISOString(),
    scanRunId: null,

    price: metrics.price,
    open: metrics.open,
    high: metrics.high,
    low: metrics.low,
    sessionChangePct: metrics.sessionChangePct,
    prevCloseChangePct: metrics.prevCloseChangePct,
    // Deprecated alias kept short-term for compatibility.
    changePct: metrics.sessionChangePct,
    priceDate: metrics.priceDate,

    volume: metrics.volume,
    avgVol20: metrics.avgVol20,
    volRatio: metrics.volRatio,
    tradedValue: metrics.tradedValue,
    avgValue20: metrics.avgValue20,

    sma20: metrics.sma20,
    sma50: metrics.sma50,
    sma200: metrics.sma200,
    rsi14: metrics.rsi14,
    macd: metrics.macd,
    atr14: metrics.atr14,

    pe: metrics.pe,
    pb: metrics.pb,
    eps: metrics.eps,
    roe: metrics.roe,
    marketCap: metrics.marketCap,

    foreignNet5d: metrics.foreignNet5d,

    canslim: scores.canslim,
    observedCanSlim: scores.observedCanSlim,
    canslimTotal: scores.canslimTotal,
    observedCanSlimTotal: scores.observedCanSlimTotal,
    observedCanSlimMax: scores.observedCanSlimMax,
    coveragePct: scores.coveragePct,
    strength: scores.strength,
    volumeSignal: scores.volumeSignal,
    wyckoffPhase: scores.wyckoffPhase,
    wyckoffStage: scores.wyckoffStage,
    wyckoffBias: scores.wyckoffBias,
    wyckoff: metrics.wyckoff,

    relative: metrics.relative,
    market: metrics.marketContext,

    quality: {
      score: qScore,
      label: qualityLabel(qScore),
      coveragePct: scores.coveragePct,
      coverageLabel: summarizeCoverage(scores.coveragePct),
      requestedOhlcvDays: metrics.meta.requestedOhlcvDays,
      historyFromDate: metrics.meta.historyFromDate,
      historyToDate: metrics.meta.historyToDate,
      wyckoffRecommendedLookbackDays: metrics.wyckoff?.dataProfile?.recommendedLookbackDays || null,
      historyBars: metrics.meta.historyBars,
      freshnessSec: metrics.meta.freshnessSec,
      snapshotOverlayUsed: metrics.meta.snapshotOverlayUsed,
      missingFactors: Object.entries(scores.factorBreakdown)
        .filter(([, detail]) => detail.status === "unknown")
        .map(([factor]) => factor),
      missingFields: missingFields(metrics),
      sourceFlags: metrics.meta.sourceFlags,
      sourceHealth: metrics.meta.sourceHealth || [],
      warnings,
    },

    explain: {
      ruleRead: signalLabel(scores.signal),
      ruleStrength: {
        score: scores.confidence,
        label: confidenceLabel(scores.confidence),
        rawScore: scores.rawScore,
      },
      driversPositive: drivers.positives,
      driversNegative: drivers.negatives,
      factorBreakdown: factorBreakdown(scores),
      normalizedCanSlim: scores.normalizedCanSlim,
      wyckoffAction: metrics.wyckoff.action,
      wyckoffEntry: metrics.wyckoff.entry,
      wyckoffReasoning: metrics.wyckoff.reasoning,
    },

    entry: metrics.entry,
    tp: metrics.tp,
    sl: metrics.sl,

    signal: scores.signal,
    confidence: scores.confidence,
    rawScore: scores.rawScore,
    breakout,
    executionRisk,

    delta: prevScan ? describeDelta(metrics, scores, prevScan) : "FIRST_SCAN",
  };

  snapshot.historyMini = historyMini(history, snapshot);
  return snapshot;
}

function breadthSummary(results) {
  const advancers = results.filter((stock) => (stock.sessionChangePct || 0) > 0).length;
  const decliners = results.filter((stock) => (stock.sessionChangePct || 0) < 0).length;
  const unchanged = results.length - advancers - decliners;
  return { advancers, decliners, unchanged };
}

function normalizeScore(values, value) {
  if (value == null) return 0;
  const valid = values.filter((item) => item != null);
  if (!valid.length) return 0;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

function aggregateSectorRows(results) {
  const map = new Map();
  for (const stock of results) {
    if (!map.has(stock.sector)) {
      map.set(stock.sector, {
        sector: stock.sector,
        count: 0,
        turnover: 0,
        changeValues: [],
        scoreValues: [],
        rsValues: [],
        ret1wValues: [],
        ret1mValues: [],
        ret3mValues: [],
        strengthValues: [],
        advancers: 0,
        decliners: 0,
      });
    }
    const row = map.get(stock.sector);
    row.count += 1;
    row.turnover += stock.tradedValue || 0;
    if (stock.sessionChangePct != null) row.changeValues.push(stock.sessionChangePct);
    if (stock.observedCanSlimMax > 0) row.scoreValues.push(stock.observedCanSlimTotal / stock.observedCanSlimMax);
    if (stock.relative?.vsVNINDEX3m != null) row.rsValues.push(stock.relative.vsVNINDEX3m);
    if (stock.relative?.ret1w != null) row.ret1wValues.push(stock.relative.ret1w);
    if (stock.relative?.ret1m != null) row.ret1mValues.push(stock.relative.ret1m);
    if (stock.relative?.ret3m != null) row.ret3mValues.push(stock.relative.ret3m);
    if (stock.strength?.score != null) row.strengthValues.push(stock.strength.score);
    if ((stock.changePct || 0) > 0) row.advancers += 1;
    else if ((stock.changePct || 0) < 0) row.decliners += 1;
  }

  return Array.from(map.values()).map((row) => ({
    sector: row.sector,
    count: row.count,
    turnover: row.turnover,
    advancers: row.advancers,
    decliners: row.decliners,
    avgChangePct: row.changeValues.length ? +(average(row.changeValues)).toFixed(2) : null,
    avgObservedScorePct: row.scoreValues.length ? +(average(row.scoreValues) * 100).toFixed(1) : null,
    avgRsVsVNINDEX3m: row.rsValues.length ? +(average(row.rsValues)).toFixed(4) : null,
    avgRet1w: row.ret1wValues.length ? +(average(row.ret1wValues)).toFixed(4) : null,
    avgRet1m: row.ret1mValues.length ? +(average(row.ret1mValues)).toFixed(4) : null,
    avgRet3m: row.ret3mValues.length ? +(average(row.ret3mValues)).toFixed(4) : null,
    avgStrengthScore: row.strengthValues.length ? +(average(row.strengthValues)).toFixed(1) : null,
  }));
}

function rankSectorRows(rows) {
  const rsValues = rows.map((row) => row.avgRsVsVNINDEX3m);
  const strengthValues = rows.map((row) => row.avgStrengthScore);
  const ret1mValues = rows.map((row) => row.avgRet1m);

  return rows
    .map((row) => {
      const breadthRatio = row.count ? row.advancers / row.count : 0;
      const rotationScore = (
        normalizeScore(rsValues, row.avgRsVsVNINDEX3m) * 0.4 +
        normalizeScore(strengthValues, row.avgStrengthScore) * 0.3 +
        (breadthRatio * 100) * 0.2 +
        normalizeScore(ret1mValues, row.avgRet1m) * 0.1
      );

      return {
        ...row,
        rotationScore: +rotationScore.toFixed(1),
      };
    })
    .sort((a, b) => {
      if ((b.rotationScore || -1) !== (a.rotationScore || -1)) return (b.rotationScore || -1) - (a.rotationScore || -1);
      if ((b.avgRsVsVNINDEX3m || -999) !== (a.avgRsVsVNINDEX3m || -999)) return (b.avgRsVsVNINDEX3m || -999) - (a.avgRsVsVNINDEX3m || -999);
      if ((b.avgChangePct || -999) !== (a.avgChangePct || -999)) return (b.avgChangePct || -999) - (a.avgChangePct || -999);
      return String(a.sector || "").localeCompare(String(b.sector || ""));
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function sectorSummary(results, previousResults = null, options = {}) {
  const driftEligible = options.scanMode === "watchlist" && Array.isArray(previousResults) && previousResults.length > 0;
  const currentRows = rankSectorRows(aggregateSectorRows(results));
  const previousRows = driftEligible ? rankSectorRows(aggregateSectorRows(previousResults)) : [];
  const previousRanks = new Map(previousRows.map((row) => [row.sector, row.rank]));
  const sectors = currentRows.map((row) => {
    const prevRank = driftEligible ? (previousRanks.get(row.sector) ?? null) : null;
    return {
      ...row,
      prevRank,
      rankDelta: prevRank == null ? null : prevRank - row.rank,
    };
  });

  return {
    leaders: sectors.slice(0, 3),
    laggards: sectors.slice(-3).reverse(),
    all: sectors,
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMarketSummary(displayResults, summaryResults = displayResults, options = {}) {
  const first = summaryResults[0] || displayResults[0] || null;
  const indexes = first?.market?.indexes || {};
  const pulse = first?.market?.pulse || null;
  const turnover = summaryResults.reduce((sum, stock) => sum + (stock.tradedValue || 0), 0);
  const breadth = breadthSummary(summaryResults);
  const sectors = sectorSummary(summaryResults, options.previousSummaryStocks, {
    scanMode: options.scanMode,
  });

  return {
    asOf: first?.scanTime || new Date().toISOString(),
    session: first?.market?.session || "unknown",
    regime: first?.market?.regime || "unknown",
    pulse,
    indexes,
    breadth,
    turnover,
    sectors,
  };
}

function fullSnapshot(results, meta = {}) {
  const activeProviders = Object.entries(config.sources.roadmap || {})
    .filter(([, detail]) => detail?.status === "active")
    .map(([provider]) => provider);
  const summaryStocks = meta.summaryStocks || results;

  const snapshot = {
    generated: new Date().toISOString(),
    engine: "Saigon Terminal v2.0",
    dataSource: "VPS with optional KBS enrichment",
    note: "Board data is VPS-first. KBS enriches finance fields when reachable, while profile ownership is quarantined until a verified endpoint exists. CAN SLIM is the ticker-strength layer, while Wyckoff handles timing and entry logic. Market direction includes an IBD-style pulse proxy and Wyckoff output includes a test checklist.",
    count: results.length,
    universeCount: meta.universeCount ?? results.length,
    requestedCount: meta.requestedCount ?? results.length,
    scannedCount: meta.scannedCount ?? results.length,
    errorCount: meta.errorCount ?? 0,
    scanMode: meta.scanMode || "watchlist",
    topN: meta.topN || null,
    throttleMs: meta.delayMs || 0,
    market: buildMarketSummary(results, summaryStocks, {
      scanMode: meta.scanMode || "watchlist",
      previousSummaryStocks: meta.previousSummaryStocks || null,
    }),
    providers: {
      active: ["vps", ...activeProviders],
      roadmap: config.sources.roadmap,
    },
    stocks: results,
  };

  snapshot.alerts = buildAlertCenter(snapshot, { limit: 18 });
  snapshot.smartLists = buildSmartLists(snapshot, { limit: 12 });
  return snapshot;
}

function factorPromptLine(stock) {
  return Object.entries(stock.explain.factorBreakdown)
    .map(([factor, detail]) => `${factor}:${detail.score == null ? "?" : detail.score}`)
    .join(" ");
}

function promptLevelsLine(stock) {
  if (!stock.entry.length || !stock.tp.length || stock.sl == null) {
    const watchItems = stock.wyckoff?.entry?.watch || [];
    if (watchItems.length) {
      return `  No active long entry yet. Watch: ${watchItems.map((item) => `${item.label} ${item.price?.toLocaleString("vi-VN") || "n/a"}`).join(" | ")}`;
    }
    return "  No active long entry yet. Wait for a Wyckoff repair or confirmation trigger.";
  }

  return `  Planned levels: Entry ${stock.entry.map((value) => value.toLocaleString("vi-VN")).join("/")} | TP ${stock.tp.map((value) => value.toLocaleString("vi-VN")).join("/")} | SL ${stock.sl.toLocaleString("vi-VN")}`;
}

function claudePrompt(snapshot) {
  const topAlerts = (snapshot.alerts?.items || []).slice(0, 3);
  const smartListSummary = (snapshot.smartLists?.lists || [])
    .filter((list) => list.count > 0)
    .slice(0, 4)
    .map((list) => `${list.label} ${list.count}`)
    .join(" | ");
  const stockSummaries = snapshot.stocks
    .map((stock) => [
      `▸ ${stock.ticker} (${stock.name}, ${stock.sector})`,
      `  Price: ${stock.price.toLocaleString("vi-VN")} (Session ${fmtSignedPct(stock.sessionChangePct)} | Vs prev close ${fmtSignedPct(stock.prevCloseChangePct)}) | Value: ${fmtK(stock.tradedValue)} | Vol: ${fmtK(stock.volume)} (${stock.volRatio}x avg)`,
      `  Strength: ${stock.strength?.label || "n/a"}${stock.strength?.score == null ? "" : ` ${stock.strength.score}/100`}${stock.strength?.rank ? ` | Rank #${stock.strength.rank}` : ""}`,
      `  Relative: 1W ${fmtPct(stock.relative.ret1w)} | 1M ${fmtPct(stock.relative.ret1m)} | 3M ${fmtPct(stock.relative.ret3m)} | vs VNINDEX ${fmtPct(stock.relative.vsVNINDEX3m)} | vs VN30 ${fmtPct(stock.relative.vsVN303m)}`,
      `  Technical: SMA20 ${fmtK(stock.sma20)} | SMA50 ${fmtK(stock.sma50)} | RSI ${stock.rsi14 ?? "—"} | MACD ${fmtK(stock.macd)}`,
      `  Market pulse: ${snapshot.market.pulse?.status || "unknown"} | Exposure ${snapshot.market.pulse?.exposure || "n/a"} | Dist days ${snapshot.market.pulse?.distributionDays ?? "n/a"}${snapshot.market.pulse?.followThrough?.date ? ` | FTD ${snapshot.market.pulse.followThrough.date}` : ""}`,
      `  Wyckoff: ${stock.wyckoff?.label || stock.wyckoffPhase} | Bias ${stock.wyckoff?.bias || "n/a"} | Confidence ${stock.wyckoff?.confidence || "n/a"} | Action ${stock.wyckoff?.action?.label || "n/a"}`,
      `  Wyckoff tests: ${stock.wyckoff?.tests?.summary || "n/a"}`,
      `  Wyckoff plan: ${stock.wyckoff?.entry?.summary || "No active plan"}${stock.wyckoff?.entry?.plans?.[0]?.price ? ` | Primary entry ${stock.wyckoff.entry.plans[0].price.toLocaleString("vi-VN")}` : ""}${stock.wyckoff?.entry?.plans?.[0]?.stop ? ` | Stop ${stock.wyckoff.entry.plans[0].stop.toLocaleString("vi-VN")}` : ""}`,
      `  Observed CAN SLIM: ${stock.observedCanSlimTotal}/${stock.observedCanSlimMax || 0} | Coverage ${stock.coveragePct}% [${factorPromptLine(stock)}]`,
      `  Rule Read: ${stock.explain.ruleRead} | Rule Strength: ${stock.confidence}/10 (${confidenceLabel(stock.confidence)})`,
      `  Positives: ${stock.explain.driversPositive.join("; ") || "—"}`,
      `  Negatives: ${stock.explain.driversNegative.join("; ") || "—"}`,
      `  Warnings: ${stock.quality.warnings.join("; ") || "—"}`,
      promptLevelsLine(stock),
      `  Delta: ${stock.delta}`,
    ].join("\n"))
    .join("\n\n");

  return `I have ${snapshot.count} Vietnam stocks monitored by my local Saigon Terminal snapshot (${snapshot.generated}).

Data policy:
- Realtime market/price context is VPS-based.
- Missing CAN SLIM factors are shown as unknown, not neutral.
- CAN SLIM is used to rank ticker strength; Wyckoff is used to time entries, exits, and watch states.
- Confidence is a rule-strength score from 1-10, not certainty.
- Fundamentals/ownership are enriched by KBS when reachable.

Market header:
- Session: ${snapshot.market.session}
- Regime: ${snapshot.market.regime}
- Pulse: ${snapshot.market.pulse?.status || "unknown"} | Exposure ${snapshot.market.pulse?.exposure || "n/a"} | Dist days ${snapshot.market.pulse?.distributionDays ?? "n/a"}${snapshot.market.pulse?.followThrough?.date ? ` | Follow-through ${snapshot.market.pulse.followThrough.date}` : ""}
- Breadth: ${snapshot.market.breadth.advancers} up / ${snapshot.market.breadth.decliners} down / ${snapshot.market.breadth.unchanged} flat
- Turnover (scan universe): ${fmtK(snapshot.market.turnover)}
${topAlerts.length ? `- Alert center: ${topAlerts.map((alert) => `${alert.title} [${alert.level}]`).join(" | ")}` : "- Alert center: none"}
${smartListSummary ? `- Smart lists: ${smartListSummary}` : "- Smart lists: none"}

Please:
1. Validate whether the rule reads make sense.
2. Identify the strongest and weakest setups in this universe.
3. Flag any names where missing data materially reduces confidence.
4. Give cross-stock / sector rotation observations.
5. Suggest where my heuristics or factor weights look wrong.

${stockSummaries}

Return JSON array:
[{"ticker":"XXX","rule_read_review":"agree_or_disagree","best_driver":"one line","main_risk":"one line","data_gap":"one line or null","signal_override":null_or_"NEW_SIGNAL","confidence_override":null_or_N,"cross_notes":"optional"}]`;
}

module.exports = {
  tickerSnapshot,
  fullSnapshot,
  claudePrompt,
  signalLabel,
  confidenceLabel,
  buildBreakout,
  buildExecutionRisk,
};
