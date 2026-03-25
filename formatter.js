// ─── formatter.js ──────────────────────────────────────────────────────────────
// Formats scan results for API responses and prompt export.
// The terminal consumes one rich snapshot so UI and prompt stay coherent.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");

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

const SIGNAL_LABELS = {
  STRONG_BUY: "Strong Bullish Bias",
  BUY: "Bullish Bias",
  HOLD: "Neutral / Mixed",
  SELL: "Bearish Bias",
  STRONG_SELL: "Strong Bearish Bias",
};

const FACTOR_META = {
  C: { label: "Current earnings" },
  A: { label: "Annual growth" },
  N: { label: "New highs" },
  S: { label: "Supply / demand" },
  L: { label: "Leader / laggard" },
  I: { label: "Institutional support" },
  M: { label: "Market direction" },
};

const METRIC_META = {
  epsGrowthQoQ: { label: "Quarterly EPS growth", kind: "pct" },
  epsGrowth1Y: { label: "Annual EPS growth", kind: "pct" },
  nearHighPct: { label: "Price vs 52W high", kind: "pct_of_high" },
  volScore: { label: "Volume vs avg20", kind: "multiple" },
  rs3m: { label: "3M relative strength", kind: "pct" },
  institutionScore: { label: "Institutional ownership proxy", kind: "pct" },
  marketTrend: { label: "Market trend score", kind: "score" },
};

function signalLabel(signal) {
  return SIGNAL_LABELS[signal] || String(signal || "UNKNOWN").replace(/_/g, " ");
}

function confidenceLabel(confidence) {
  if (confidence >= 8) return "high conviction";
  if (confidence >= 5) return "moderate conviction";
  return "low conviction";
}

function summarizeCoverage(coveragePct) {
  if (coveragePct >= 85) return "strong";
  if (coveragePct >= 60) return "usable";
  return "thin";
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
  if ((metrics.meta.overviewWarnings || []).length) {
    score -= Math.min(6, metrics.meta.overviewWarnings.length * 2);
  }
  return Math.max(0, Math.min(100, score));
}

function qualityLabel(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function buildWarnings(metrics, scores) {
  const warnings = [];
  const missingFactors = Object.entries(scores.factorBreakdown)
    .filter(([, factor]) => factor.status === "unknown")
    .map(([factor]) => factor);

  if (missingFactors.length) warnings.push(`Missing CAN SLIM factors: ${missingFactors.join("/")}`);
  if (String(metrics.meta.sourceFlags.fundamentals).includes("unavailable")) warnings.push("Fundamentals unavailable");
  if (String(metrics.meta.sourceFlags.ownership).includes("unavailable")) warnings.push("Ownership enrichment unavailable");
  if (metrics.meta.sourceFlags.foreign === "unavailable") warnings.push("Foreign flow unavailable");
  if (!metrics.meta.snapshotOverlayUsed) warnings.push("Price is history-only fallback");
  if (metrics.meta.snapshotFailed && metrics.meta.snapshotError) warnings.push(`Snapshot fallback: ${metrics.meta.snapshotError}`);
  if (metrics.meta.freshnessSec != null && metrics.meta.freshnessSec > 180) warnings.push("Snapshot is stale");
  if (metrics.wyckoff?.confidence != null && metrics.wyckoff.confidence < 55) warnings.push("Wyckoff read is low-confidence");
  warnings.push(...(metrics.meta.overviewWarnings || []));
  return warnings;
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

function metricFormat(metric, value, { threshold = false } = {}) {
  if (value == null) return "unknown";
  const meta = METRIC_META[metric] || { kind: "raw" };

  switch (meta.kind) {
    case "pct":
      return threshold ? fmtPctPlain(value, 1) : fmtPct(value, 100, 1);
    case "pct_of_high":
      return threshold ? fmtPctPlain(value, 1) : `${fmtPctPlain(value, 1)} of 52W high`;
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

function bandLabel(metric, lower, upper) {
  if (lower == null && upper == null) return "Unknown";
  if (lower == null) return `< ${metricFormat(metric, upper, { threshold: true })}`;
  if (upper == null) return `>= ${metricFormat(metric, lower, { threshold: true })}`;
  return `${metricFormat(metric, lower, { threshold: true })} to ${metricFormat(metric, upper, { threshold: true })}`;
}

function factorReason(factor, detail) {
  const factorLabel = FACTOR_META[factor]?.label || factor;
  const metricLabel = METRIC_META[detail.metric]?.label || detail.metric;

  if (detail.rawValue == null) {
    return `No ${metricLabel.toLowerCase()} value is available, so ${factorLabel.toLowerCase()} stays unknown and is excluded from observed CAN SLIM.`;
  }

  const band = thresholdBand(detail.score, detail.thresholds);
  const value = metricFormat(detail.metric, detail.rawValue);
  if (band.lower == null) {
    return `${metricLabel} is ${value}, below ${metricFormat(detail.metric, band.upper, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
  }
  if (band.upper == null) {
    return `${metricLabel} is ${value}, at or above ${metricFormat(detail.metric, band.lower, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
  }
  return `${metricLabel} is ${value}, between ${metricFormat(detail.metric, band.lower, { threshold: true })} and ${metricFormat(detail.metric, band.upper, { threshold: true })}, so ${factor} scores ${detail.score}/10.`;
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
        factorLabel: FACTOR_META[factor]?.label || factor,
        metricLabel: METRIC_META[detail.metric]?.label || detail.metric,
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
  const warnings = buildWarnings(metrics, scores);
  const drivers = driverText(metrics, scores, warnings);
  const qScore = qualityScore(metrics, scores);

  const snapshot = {
    ticker,
    name: stockInfo.name,
    sector: stockInfo.sector,
    scanTime: new Date().toISOString(),

    price: metrics.price,
    open: metrics.open,
    high: metrics.high,
    low: metrics.low,
    changePct: metrics.changePct,
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
      historyBars: metrics.meta.historyBars,
      freshnessSec: metrics.meta.freshnessSec,
      snapshotOverlayUsed: metrics.meta.snapshotOverlayUsed,
      missingFactors: Object.entries(scores.factorBreakdown)
        .filter(([, detail]) => detail.status === "unknown")
        .map(([factor]) => factor),
      missingFields: missingFields(metrics),
      sourceFlags: metrics.meta.sourceFlags,
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

    delta: prevScan ? describeDelta(metrics, scores, prevScan) : "FIRST_SCAN",
  };

  snapshot.historyMini = historyMini(history, snapshot);
  return snapshot;
}

function breadthSummary(results) {
  const advancers = results.filter((stock) => (stock.changePct || 0) > 0).length;
  const decliners = results.filter((stock) => (stock.changePct || 0) < 0).length;
  const unchanged = results.length - advancers - decliners;
  return { advancers, decliners, unchanged };
}

function sectorSummary(results) {
  const map = new Map();
  for (const stock of results) {
    if (!map.has(stock.sector)) {
      map.set(stock.sector, { sector: stock.sector, count: 0, turnover: 0, changeValues: [], scoreValues: [] });
    }
    const row = map.get(stock.sector);
    row.count += 1;
    row.turnover += stock.tradedValue || 0;
    if (stock.changePct != null) row.changeValues.push(stock.changePct);
    if (stock.observedCanSlimMax > 0) row.scoreValues.push(stock.observedCanSlimTotal / stock.observedCanSlimMax);
  }

  const sectors = Array.from(map.values()).map((row) => ({
    sector: row.sector,
    count: row.count,
    turnover: row.turnover,
    avgChangePct: row.changeValues.length ? +(average(row.changeValues)).toFixed(2) : null,
    avgObservedScorePct: row.scoreValues.length ? +(average(row.scoreValues) * 100).toFixed(1) : null,
  })).sort((a, b) => (b.avgChangePct || -999) - (a.avgChangePct || -999));

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

function buildMarketSummary(displayResults, summaryResults = displayResults) {
  const first = summaryResults[0] || displayResults[0] || null;
  const indexes = first?.market?.indexes || {};
  const pulse = first?.market?.pulse || null;
  const turnover = summaryResults.reduce((sum, stock) => sum + (stock.tradedValue || 0), 0);
  const breadth = breadthSummary(summaryResults);
  const sectors = sectorSummary(summaryResults);

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

  return {
    generated: new Date().toISOString(),
    engine: "Saigon Terminal v2.0",
    dataSource: "VPS + KBS",
    note: "Board data is VPS-first. KBS enriches fundamentals and ownership when available. CAN SLIM is the ticker-strength layer, while Wyckoff handles timing and entry logic. Market direction now includes an IBD-style pulse proxy and Wyckoff output includes a test checklist.",
    count: results.length,
    universeCount: meta.universeCount ?? results.length,
    requestedCount: meta.requestedCount ?? results.length,
    scannedCount: meta.scannedCount ?? results.length,
    errorCount: meta.errorCount ?? 0,
    scanMode: meta.scanMode || "watchlist",
    topN: meta.topN || null,
    throttleMs: meta.delayMs || 0,
    market: buildMarketSummary(results, summaryStocks),
    providers: {
      active: ["vps", ...activeProviders],
      roadmap: config.sources.roadmap,
    },
    stocks: results,
  };
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
  const stockSummaries = snapshot.stocks
    .map((stock) => [
      `▸ ${stock.ticker} (${stock.name}, ${stock.sector})`,
      `  Price: ${stock.price.toLocaleString("vi-VN")} (${stock.changePct >= 0 ? "+" : ""}${stock.changePct}%) | Value: ${fmtK(stock.tradedValue)} | Vol: ${fmtK(stock.volume)} (${stock.volRatio}x avg)`,
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

module.exports = { tickerSnapshot, fullSnapshot, claudePrompt, signalLabel, confidenceLabel };
