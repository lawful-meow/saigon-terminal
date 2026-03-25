// ─── wyckoff.js ───────────────────────────────────────────────────────────────
// Structural Wyckoff read from daily OHLCV only.
// The goal is not textbook certainty; it is an explainable, actionable heuristic
// with explicit confidence, triggers, and risk levels.
// ───────────────────────────────────────────────────────────────────────────────

const config = require("./config");

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pctChange(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return current / base - 1;
}

function spread(bar) {
  return Math.max(0, (bar?.h || 0) - (bar?.l || 0));
}

function closeLocation(bar) {
  const barSpread = spread(bar);
  if (barSpread <= 0) return 0.5;
  return (bar.c - bar.l) / barSpread;
}

function upperShadowRatio(bar) {
  const barSpread = spread(bar);
  if (barSpread <= 0) return 0;
  return (bar.h - Math.max(bar.o, bar.c)) / barSpread;
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function trailingReturn(bars, lookbackBars) {
  if (!bars.length || bars.length <= lookbackBars) return null;
  const latest = bars[bars.length - 1];
  const base = bars[bars.length - 1 - lookbackBars];
  return pctChange(latest.c, base.c);
}

function buildWindowStats(bars, endExclusive, lookback) {
  const start = Math.max(0, endExclusive - lookback);
  const slice = bars.slice(start, endExclusive);
  if (!slice.length) return null;

  return {
    bars: slice,
    high: Math.max(...slice.map((bar) => bar.h)),
    low: Math.min(...slice.map((bar) => bar.l)),
    avgVol: average(slice.map((bar) => bar.v)) || 0,
    avgSpread: average(slice.map((bar) => spread(bar))) || 0,
    ret: pctChange(slice[slice.length - 1].c, slice[0].c),
  };
}

function eventPayload(name, ctx) {
  return {
    active: true,
    name,
    index: ctx.index,
    date: ctx.bar.date,
    price: ctx.bar.c,
    low: ctx.bar.l,
    high: ctx.bar.h,
    support: roundPrice(ctx.support),
    resistance: roundPrice(ctx.resistance),
    volumeRatio: ctx.avgVol > 0 ? +(ctx.bar.v / ctx.avgVol).toFixed(2) : null,
    closeLocation: +closeLocation(ctx.bar).toFixed(2),
  };
}

function detectRecentEvent(name, bars, settings, tester) {
  let match = null;
  const start = Math.max(12, bars.length - settings.recentEventWindow);

  for (let index = start; index < bars.length; index++) {
    const prior = buildWindowStats(bars, index, settings.structureLookback);
    if (!prior || prior.bars.length < 12) continue;

    const bar = bars[index];
    const ctx = {
      index,
      bar,
      prior,
      support: prior.low,
      resistance: prior.high,
      avgVol: prior.avgVol,
      avgSpread: prior.avgSpread,
      priorRet: prior.ret,
    };

    if (tester(ctx)) {
      match = eventPayload(name, ctx);
    }
  }

  return match || { active: false, name };
}

function confidenceLabel(confidence) {
  if (confidence >= 80) return "high";
  if (confidence >= 60) return "moderate";
  return "low";
}

function rangeLabel(positionPct) {
  if (positionPct <= 0.33) return "lower third";
  if (positionPct >= 0.67) return "upper third";
  return "mid-range";
}

function rr(entry, stop, target) {
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  return +((Math.abs(target - entry)) / risk).toFixed(2);
}

function buildReasoning(context, events, classification) {
  const steps = [];
  const rangeWidthPct = context.rangeWidthPct != null ? `${(context.rangeWidthPct * 100).toFixed(1)}%` : "n/a";
  const pricePos = context.pricePositionPct != null ? `${Math.round(context.pricePositionPct * 100)}%` : "n/a";

  steps.push({
    step: 1,
    title: "Trend Context",
    detail: `40-session backdrop is ${context.trendBias}; price is ${context.priceVsSma50Pct >= 0 ? "+" : ""}${context.priceVsSma50Pct.toFixed(1)}% vs SMA50 with 1M return ${context.ret20 == null ? "n/a" : `${(context.ret20 * 100).toFixed(1)}%`}.`,
  });

  steps.push({
    step: 2,
    title: "Trading Range Map",
    detail: `30-session support/resistance sit near ${context.support.toLocaleString("vi-VN")} / ${context.resistance.toLocaleString("vi-VN")}; range width is ${rangeWidthPct} and the close sits at ${pricePos} of that box (${rangeLabel(context.pricePositionPct)}).`,
  });

  const activeEvents = Object.values(events).filter((event) => event?.active);
  if (activeEvents.length) {
    const eventText = activeEvents
      .slice(0, 3)
      .map((event) => `${event.name} on ${event.date} (${event.volumeRatio == null ? "n/a" : `${event.volumeRatio}x vol`})`)
      .join(", ");
    steps.push({
      step: 3,
      title: "Supply / Demand Event",
      detail: `Recent structural signals: ${eventText}.`,
    });
  } else {
    steps.push({
      step: 3,
      title: "Supply / Demand Event",
      detail: "No decisive spring, upthrust, SOS, or SOW is visible in the recent daily-bar window, so the read leans more on range position and trend state than on a fresh Wyckoff trigger.",
    });
  }

  steps.push({
    step: 4,
    title: "Phase Decision",
    detail: `The structure is classified as ${classification.label} because ${classification.because}.`,
  });

  return steps;
}

function buildCommonLevels(context, metrics) {
  const atr = context.atr;
  const stopBuffer = atr * config.wyckoff.stopBufferAtr;
  const rangeHeight = Math.max(atr, context.resistance - context.support);
  const breakoutTrigger = roundPrice(Math.max(context.resistance * (1 + config.wyckoff.breakoutPct), context.recentHigh));
  const breakdownTrigger = roundPrice(Math.min(context.support * (1 - config.wyckoff.breakoutPct), context.recentLow));
  const pullbackBand = {
    low: roundPrice(Math.max(context.support, context.resistance - atr * 0.4)),
    high: roundPrice(context.resistance + atr * 0.3),
  };
  const stopBelowSupport = roundPrice(context.support - stopBuffer);
  const stopBelowRecentLow = roundPrice(context.recentLow - stopBuffer);

  return {
    atr,
    rangeHeight,
    breakoutTrigger,
    breakdownTrigger,
    pullbackBand,
    stopBelowSupport,
    stopBelowRecentLow,
    target1FromBreakout: roundPrice(context.resistance + Math.max(rangeHeight * 0.5, atr * 1.5)),
    target2FromBreakout: roundPrice(context.resistance + Math.max(rangeHeight, atr * 2.5)),
    trendPullback: roundPrice(Math.max(metrics.sma20 || 0, context.recentLow + atr * 0.3)) || roundPrice(metrics.price - atr * 0.5),
  };
}

function buildEntryPlan(classification, context, events, metrics) {
  const levels = buildCommonLevels(context, metrics);
  const plans = [];
  const watch = [];
  let summary = "No active long entry.";
  let status = "avoid";
  let invalidation = null;

  if (classification.code === "acc_c") {
    const springLow = events.spring.active ? events.spring.low : context.recentLow;
    const springTrigger = roundPrice(Math.max(events.spring.high || 0, context.recentHigh, metrics.price));
    const stop = roundPrice(springLow - levels.atr * config.wyckoff.stopBufferAtr);
    const target1 = roundPrice(context.resistance);
    const target2 = levels.target1FromBreakout;

    status = "buy_pilot";
    summary = "Early buy only after spring confirmation. Size should stay smaller until a full SOS clears resistance.";
    invalidation = `Abort the setup if price loses ${roundPrice(springLow).toLocaleString("vi-VN")} on a daily close.`;

    plans.push({
      label: "Pilot buy on spring confirmation",
      kind: "buy",
      price: springTrigger,
      stop,
      target1,
      target2,
      riskReward1: rr(springTrigger, stop, target1),
      riskReward2: rr(springTrigger, stop, target2),
      why: `The spring undercut support and recovered. Entry waits for price to reclaim ${springTrigger.toLocaleString("vi-VN")} so the false breakdown is actually being rejected by demand.`,
    });

    watch.push({
      label: "Full confirmation / add only above SOS trigger",
      price: levels.breakoutTrigger,
      why: `A move through ${levels.breakoutTrigger.toLocaleString("vi-VN")} would clear the box high and upgrade the read from Phase C to Phase D.`,
    });
  } else if (classification.code === "acc_d") {
    const pullbackEntry = roundPrice(Math.max(context.resistance, metrics.price - levels.atr * 0.5));
    const stop = roundPrice(context.resistance - levels.atr * 0.8);
    const addPrice = roundPrice(Math.max(metrics.price, context.recentHigh));

    status = metrics.price <= context.resistance + levels.atr * 0.8 ? "buy" : "wait_pullback";
    summary = status === "buy"
      ? "Demand already showed a sign of strength. Buying is valid on breakout hold or low-volume backup."
      : "Structure is constructive, but price is extended above the breakout. Wait for a backup toward resistance instead of chasing.";
    invalidation = `Lose the breakout shelf near ${roundPrice(context.resistance).toLocaleString("vi-VN")} and the Phase D thesis weakens materially.`;

    plans.push({
      label: status === "buy" ? "Primary buy on breakout hold" : "Preferred buy on backup / pullback",
      kind: status === "buy" ? "buy" : "wait",
      price: pullbackEntry,
      stop,
      target1: levels.target1FromBreakout,
      target2: levels.target2FromBreakout,
      riskReward1: rr(pullbackEntry, stop, levels.target1FromBreakout),
      riskReward2: rr(pullbackEntry, stop, levels.target2FromBreakout),
      why: `Phase D is valid when the old ceiling turns into support. ${pullbackEntry.toLocaleString("vi-VN")} sits near the breakout shelf rather than at an extended price.`,
    });

    watch.push({
      label: "Add only if trend resumes",
      price: addPrice,
      why: `Only add after price proves it can keep printing higher highs above ${addPrice.toLocaleString("vi-VN")}.`,
    });
  } else if (classification.code === "markup") {
    const extended = context.distanceFromSma20Atr != null && context.distanceFromSma20Atr > config.wyckoff.markupExtensionAtr;
    const stop = roundPrice(Math.min(context.recentLow, (metrics.sma20 || metrics.price) - levels.atr * 0.8));

    status = extended ? "wait_pullback" : "buy_pullback";
    summary = extended
      ? "Trend is healthy, but fresh money should wait for a pullback into support instead of chasing an extended bar."
      : "Trend continuation is intact. Fresh capital can buy a controlled pullback, not a vertical extension.";
    invalidation = `A daily close below ${stop.toLocaleString("vi-VN")} would mean the current markup leg has lost its immediate support.`;

    plans.push({
      label: extended ? "Wait for pullback to trend support" : "Buy pullback in markup",
      kind: extended ? "wait" : "buy",
      price: levels.trendPullback,
      stop,
      target1: roundPrice(context.recentHigh || metrics.price + levels.atr * 1.5),
      target2: roundPrice((context.recentHigh || metrics.price) + Math.max(levels.atr * 2, (context.resistance - context.support) * 0.6)),
      riskReward1: rr(levels.trendPullback, stop, roundPrice(context.recentHigh || metrics.price + levels.atr * 1.5)),
      riskReward2: rr(levels.trendPullback, stop, roundPrice((context.recentHigh || metrics.price) + Math.max(levels.atr * 2, (context.resistance - context.support) * 0.6))),
      why: `Best Wyckoff continuation entries in markup come from backing into support, usually near SMA20 / last point of support, not from buying a stretched candle.`,
    });
  } else {
    const buyTrigger = levels.breakoutTrigger;
    const abortTrigger = classification.phase === "Markdown"
      ? levels.breakdownTrigger
      : roundPrice(context.support);

    status = classification.phase === "Markdown" || classification.phase === "Distribution" ? "avoid" : "wait";
    summary = classification.phase === "Markdown"
      ? "Do not buy into active markdown. Wait for stopping action or a spring first."
      : classification.phase === "Distribution"
        ? "Do not add new longs while supply dominates near the top of the range."
        : "Range is not ready. Keep it on the watchlist and wait for a real trigger.";
    invalidation = `A clean move below ${abortTrigger.toLocaleString("vi-VN")} keeps the structure defensive.`;

    watch.push({
      label: "Only reconsider long if demand wins",
      price: buyTrigger,
      why: `A decisive move through ${buyTrigger.toLocaleString("vi-VN")} is needed before the structure becomes a real buy setup.`,
    });
  }

  return { status, summary, plans, watch, invalidation };
}

function buildActionPlan(classification, entry, context) {
  const map = {
    acc_a: {
      label: "Wait for the base to form",
      summary: "Selling pressure may be tiring, but the base is not mature enough for a proper long yet.",
      steps: [
        `Map support near ${context.support.toLocaleString("vi-VN")} and resistance near ${context.resistance.toLocaleString("vi-VN")}.`,
        "Do not open full-size positions on the first rebound bar.",
        "Wait for either a spring/test or a sign of strength through resistance.",
        "Keep position size at zero or very small until supply is clearly absorbed.",
      ],
      shouldAvoid: [
        "Do not call the first bounce a trend change.",
        "Do not put stops inside a noisy range before the structure is confirmed.",
      ],
    },
    acc_b: {
      label: "Stay on watch, not on full risk",
      summary: "The stock is building a box. That is useful, but it is not yet a valid expansion move.",
      steps: [
        `Track whether price respects the lower half of the range around ${context.support.toLocaleString("vi-VN")}.`,
        "Wait for volume to dry up on pullbacks and expand on up days.",
        "Prepare two triggers: spring confirmation and breakout confirmation.",
        "Keep powder dry until one of those triggers appears.",
      ],
      shouldAvoid: [
        "Do not buy the middle of the range without a trigger.",
        "Do not average down if support fails.",
      ],
    },
    acc_c: {
      label: "Pilot buy only on confirmation",
      summary: entry.summary,
      steps: [
        `Step 1: confirm the spring low holds and price stays above ${roundPrice(context.support).toLocaleString("vi-VN")}.`,
        `Step 2: trigger the pilot only when price reclaims ${entry.plans[0]?.price?.toLocaleString("vi-VN") || "the spring trigger"}.`,
        "Step 3: keep initial size smaller than normal because Phase C is early.",
        `Step 4: only add after an SOS clears ${roundPrice(context.resistance).toLocaleString("vi-VN")}.`,
      ],
      shouldAvoid: [
        "Do not buy before the spring is confirmed by price recovery.",
        "Do not size the position as if Phase D is already complete.",
      ],
    },
    acc_d: {
      label: entry.status === "buy" ? "Buy / add on strength" : "Constructive, but wait for backup",
      summary: entry.summary,
      steps: [
        `Step 1: treat ${roundPrice(context.resistance).toLocaleString("vi-VN")} as the breakout shelf.`,
        entry.status === "buy"
          ? "Step 2: buy the hold above that shelf or a low-volume retest into it."
          : "Step 2: do not chase the breakout bar. Wait for price to back up into support.",
        "Step 3: add only if price resumes with expanding volume.",
        `Step 4: exit the bullish thesis if price loses the breakout shelf on a daily close.`,
      ],
      shouldAvoid: [
        "Do not chase a bar that is already far above the breakout shelf.",
        "Do not leave stops below the middle of the old range; use the breakout shelf instead.",
      ],
    },
    markup: {
      label: entry.status === "buy_pullback" ? "Trend buy on pullback" : "Hold, wait for pullback",
      summary: entry.summary,
      steps: [
        "Step 1: assume the trend is intact while price stays above rising support.",
        `Step 2: use pullbacks toward ${entry.plans[0]?.price?.toLocaleString("vi-VN") || "trend support"} for fresh entries.`,
        "Step 3: add only after demand shows up again on the bounce.",
        "Step 4: if the pullback slices through support on volume, stop treating it as a markup continuation.",
      ],
      shouldAvoid: [
        "Do not chase extended candles far from SMA20.",
        "Do not confuse a trend pullback with a range breakout setup; risk belongs under support.",
      ],
    },
    dist_a: {
      label: "Stop adding and tighten risk",
      summary: "Early distribution often looks strong on the surface. That is exactly when new longs become dangerous.",
      steps: [
        "Stop adding new size into strength.",
        "Move stops tighter under the most recent support shelf.",
        "Watch for failed breakouts and heavy-volume stalls.",
        "Prepare to reduce if supply keeps showing up near highs.",
      ],
      shouldAvoid: [
        "Do not buy a stock simply because it is still near the highs.",
        "Do not ignore churn volume after a mature uptrend.",
      ],
    },
    dist_b: {
      label: "Reduce on strength, no fresh longs",
      summary: "The range is now a supply zone until demand proves otherwise.",
      steps: [
        `Sell or reduce into rallies closer to ${context.resistance.toLocaleString("vi-VN")}.`,
        `If support near ${context.support.toLocaleString("vi-VN")} breaks, expect Phase D / markdown risk.`,
        "Keep position size defensive while the stock is trapped in the upper box.",
        "Treat every failed rally as evidence that large supply is still active.",
      ],
      shouldAvoid: [
        "Do not buy the middle or top of a distribution range.",
        "Do not assume sideways near highs is automatically bullish.",
      ],
    },
    dist_c: {
      label: "Sell failed breakout / upthrust",
      summary: "A Wyckoff upthrust is a trap. The right response is defense, not hope.",
      steps: [
        "Reduce quickly if the breakout fails back into the range.",
        "Do not re-enter long until a full re-accumulation is rebuilt.",
        "Use the failed breakout high as invalidation for any remaining tactical position.",
        "Shift attention to support breaks and weak bounces.",
      ],
      shouldAvoid: [
        "Do not average up after an upthrust failure.",
        "Do not call it bullish while price is back below resistance.",
      ],
    },
    dist_d: {
      label: "Exit or keep only tactical size",
      summary: "Support already broke. Capital preservation matters more than trying to rescue the idea.",
      steps: [
        `Treat ${context.support.toLocaleString("vi-VN")} as overhead supply now, not as support.`,
        "Use weak rebounds to reduce or exit.",
        "Do not open fresh longs until a new accumulation process appears.",
        "Wait for markdown to finish and for stopping action to print.",
      ],
      shouldAvoid: [
        "Do not buy weakness just because price looks cheaper.",
        "Do not ignore lower highs after a support break.",
      ],
    },
    markdown: {
      label: "No long entries in active markdown",
      summary: "Trend and structure are both hostile. The correct action is patience.",
      steps: [
        "Stand aside while price stays below key moving averages and keeps making weak rebounds.",
        "Wait for stopping action, a spring, or a new range before reconsidering any long.",
        `Do not treat ${context.support.toLocaleString("vi-VN")} as stable support if price is already below it.`,
        "Keep the name on a watchlist, not in a fresh long position.",
      ],
      shouldAvoid: [
        "Do not catch a falling knife in Phase E markdown.",
        "Do not set a buy just because RSI looks low without structural repair.",
      ],
    },
  };

  return map[classification.code] || map.markdown;
}

function classify(context, events, metrics) {
  const basing = context.rangeWidthPct <= 0.18 || (context.volumeDry && Math.abs(context.ret20 || 0) <= 0.08);
  const stallingHigh = metrics.nearHigh && (metrics.priceStalling || metrics.volSpike);
  const emergingSos = context.pricePositionPct >= 0.78 &&
    (context.ret20 || 0) >= 0.05 &&
    context.latestVolRatio >= (config.wyckoff.expansionVolumeRatio || 1.25) &&
    metrics.price > (metrics.sma20 || 0);
  const emergingSow = context.pricePositionPct <= 0.25 &&
    (context.ret20 || 0) <= -0.05 &&
    context.latestVolRatio >= (config.wyckoff.expansionVolumeRatio || 1.25) &&
    metrics.price < (metrics.sma20 || Number.MAX_SAFE_INTEGER);

  if (context.trendBias === "downtrend") {
    if (events.sos.active || events.backup.active || emergingSos) {
      return {
        phase: "Accumulation",
        stage: "Phase D",
        label: "Accumulation Phase D - SOS / LPS",
        code: "acc_d",
        because: "price has started to reclaim the top of the base with demand, which is the classic shift from testing to trend emergence",
      };
    }
    if (events.spring.active) {
      return {
        phase: "Accumulation",
        stage: "Phase C",
        label: "Accumulation Phase C - Spring",
        code: "acc_c",
        because: "support was undercut and reclaimed, which is a spring-style shakeout after a decline",
      };
    }
    if (events.stoppingVolume.active) {
      return {
        phase: "Accumulation",
        stage: "Phase A",
        label: "Accumulation Phase A - Stopping Action",
        code: "acc_a",
        because: "heavy stopping-style demand appeared after a decline, but the range is still immature",
      };
    }
    if (basing && context.pricePositionPct >= 0.25) {
      return {
        phase: "Accumulation",
        stage: "Phase B",
        label: "Accumulation Phase B - Building Cause",
        code: "acc_b",
        because: "downtrend pressure is slowing and price is spending time inside a base rather than cascading lower",
      };
    }
    return {
      phase: "Markdown",
      stage: "Phase E",
      label: "Markdown Phase E - Active Downtrend",
      code: "markdown",
      because: "the stock is still below trend support and no convincing stopping or spring event has appeared yet",
    };
  }

  if (context.trendBias === "uptrend") {
    if (events.sow.active || events.lpsy.active || emergingSow) {
      return {
        phase: "Distribution",
        stage: "Phase D",
        label: "Distribution Phase D - SOW / LPSY",
        code: "dist_d",
        because: "support is already failing, which is the late-stage distribution handoff into weakness",
      };
    }
    if (events.upthrust.active) {
      return {
        phase: "Distribution",
        stage: "Phase C",
        label: "Distribution Phase C - Upthrust",
        code: "dist_c",
        because: "price pushed above resistance and failed back inside the range, which is classic upthrust behavior",
      };
    }
    if (events.buyingClimax.active || stallingHigh) {
      return {
        phase: "Distribution",
        stage: "Phase A",
        label: "Distribution Phase A - Buying Climax",
        code: "dist_a",
        because: "mature uptrend behavior is now showing stall / climax characteristics near the top of the range",
      };
    }
    if (context.rangeWidthPct <= 0.18 && context.pricePositionPct >= 0.55 && context.volumeDry) {
      return {
        phase: "Distribution",
        stage: "Phase B",
        label: "Distribution Phase B - Supply Range",
        code: "dist_b",
        because: "price is churning in the upper part of the range without fresh expansion, which usually means supply is being worked",
      };
    }
    return {
      phase: "Markup",
      stage: "Phase E",
      label: "Markup Phase E - Trend Continuation",
      code: "markup",
      because: "price remains above trend support and demand has not failed, so the path of least resistance is still upward",
    };
  }

  if (events.sos.active || events.backup.active) {
    return {
      phase: "Accumulation",
      stage: "Phase D",
      label: "Accumulation Phase D - SOS / LPS",
      code: "acc_d",
      because: "the stock is already pressing through the upper edge of the range with demand",
    };
  }
  if (events.spring.active) {
    return {
      phase: "Accumulation",
      stage: "Phase C",
      label: "Accumulation Phase C - Spring",
      code: "acc_c",
      because: "the market rejected a downside shakeout even though the broader trend is still neutral",
    };
  }
  if (events.sow.active) {
    return {
      phase: "Distribution",
      stage: "Phase D",
      label: "Distribution Phase D - SOW",
      code: "dist_d",
      because: "support already gave way before the structure had a chance to repair",
    };
  }
  if (events.upthrust.active) {
    return {
      phase: "Distribution",
      stage: "Phase C",
      label: "Distribution Phase C - Upthrust",
      code: "dist_c",
      because: "the range attempted an upside escape and failed",
    };
  }
  if (context.pricePositionPct <= 0.5) {
    return {
      phase: "Accumulation",
      stage: "Phase B",
      label: "Accumulation Phase B - Range Building",
      code: "acc_b",
      because: "price is holding in the lower half of the box without a fresh breakdown",
    };
  }
  return {
    phase: "Distribution",
    stage: "Phase B",
    label: "Distribution Phase B - Range Supply",
    code: "dist_b",
    because: "price sits in the upper half of the box without a clean demand expansion",
  };
}

function analyzeWyckoff(bars, metrics) {
  const settings = config.wyckoff || {};
  const latest = bars[bars.length - 1];
  const recentBars = bars.slice(-Math.min(settings.structureLookback || 30, bars.length));
  const contextBars = bars.slice(-Math.min(settings.contextLookback || 40, bars.length));
  const highs = recentBars.map((bar) => bar.h);
  const lows = recentBars.map((bar) => bar.l);
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);
  const rangeHeight = Math.max(1, resistance - support);
  const pricePositionPct = clamp((latest.c - support) / rangeHeight, 0, 1);
  const ret20 = trailingReturn(bars, 20);
  const ret40 = trailingReturn(bars, 40);
  const avgVol20 = average(bars.slice(-20).map((bar) => bar.v)) || metrics.avgVol20 || 0;
  const avgVol5 = average(bars.slice(-5).map((bar) => bar.v)) || 0;
  const atr = metrics.atr14 || latest.c * 0.02;
  const priceVsSma50Pct = Number(metrics.relative?.priceVsSma50Pct || 0);
  const trendBias = ret40 <= -0.08 || (metrics.belowSMA50 && metrics.sma20BelowSMA50 && priceVsSma50Pct <= -5)
    ? "downtrend"
    : ret40 >= 0.08 || (metrics.aboveSMA50 && metrics.sma20AboveSMA50 && priceVsSma50Pct >= 5)
      ? "uptrend"
      : "range";

  const context = {
    support,
    resistance,
    midpoint: support + rangeHeight / 2,
    rangeWidthPct: rangeHeight / latest.c,
    pricePositionPct,
    ret20: ret20 == null ? 0 : ret20,
    ret40: ret40 == null ? 0 : ret40,
    avgVol20,
    avgVol5,
    volumeDry: avgVol20 > 0 ? avgVol5 <= avgVol20 * (settings.dryVolumeRatio || 0.85) : false,
    latestVolRatio: avgVol20 > 0 ? latest.v / avgVol20 : 0,
    recentHigh: Math.max(...bars.slice(-10).map((bar) => bar.h)),
    recentLow: Math.min(...bars.slice(-10).map((bar) => bar.l)),
    atr,
    trendBias,
    priceVsSma50Pct,
    distanceFromSma20Atr: metrics.sma20 ? +((latest.c - metrics.sma20) / atr).toFixed(2) : null,
    contextRet: pctChange(contextBars[contextBars.length - 1]?.c, contextBars[0]?.c) || 0,
  };

  const events = {
    spring: detectRecentEvent("spring", bars, settings, (ctx) =>
      ctx.priorRet != null &&
      ctx.priorRet <= -0.03 &&
      ctx.bar.l < ctx.support * (1 - (settings.fakeoutPct || 0.003)) &&
      ctx.bar.c > ctx.support &&
      closeLocation(ctx.bar) >= 0.55
    ),
    upthrust: detectRecentEvent("upthrust", bars, settings, (ctx) =>
      ctx.priorRet != null &&
      ctx.priorRet >= 0.03 &&
      ctx.bar.h > ctx.resistance * (1 + (settings.fakeoutPct || 0.003)) &&
      ctx.bar.c < ctx.resistance &&
      closeLocation(ctx.bar) <= 0.45
    ),
    sos: detectRecentEvent("SOS", bars, settings, (ctx) =>
      ctx.bar.c > ctx.resistance * (1 + (settings.breakoutPct || 0.005)) &&
      ctx.bar.v >= ctx.avgVol * (settings.expansionVolumeRatio || 1.25) &&
      closeLocation(ctx.bar) >= 0.6
    ),
    sow: detectRecentEvent("SOW", bars, settings, (ctx) =>
      ctx.bar.c < ctx.support * (1 - (settings.breakoutPct || 0.005)) &&
      ctx.bar.v >= ctx.avgVol * (settings.expansionVolumeRatio || 1.25) &&
      closeLocation(ctx.bar) <= 0.4
    ),
    stoppingVolume: detectRecentEvent("stopping_volume", bars, settings, (ctx) =>
      ctx.priorRet != null &&
      ctx.priorRet <= -0.08 &&
      ctx.bar.v >= ctx.avgVol * (settings.climaxVolumeRatio || 1.8) &&
      closeLocation(ctx.bar) >= 0.55 &&
      spread(ctx.bar) >= Math.max(ctx.avgSpread * 1.15, latest.c * 0.01)
    ),
    buyingClimax: detectRecentEvent("buying_climax", bars, settings, (ctx) =>
      ctx.priorRet != null &&
      ctx.priorRet >= 0.08 &&
      ctx.bar.v >= ctx.avgVol * (settings.climaxVolumeRatio || 1.8) &&
      upperShadowRatio(ctx.bar) >= 0.35
    ),
  };

  events.backup = {
    active: !!events.sos.active &&
      latest.c >= events.sos.resistance * 0.99 &&
      latest.l >= events.sos.resistance - atr * 0.8 &&
      avgVol5 <= avgVol20 * 1.05,
    name: "backup",
    date: latest.date,
    price: latest.c,
    support: roundPrice(events.sos.resistance || support),
    resistance: roundPrice(resistance),
    volumeRatio: avgVol20 > 0 ? +(latest.v / avgVol20).toFixed(2) : null,
  };

  events.lpsy = {
    active: !!events.sow.active &&
      latest.c <= events.sow.support * 1.01 &&
      latest.h <= events.sow.support * 1.03 &&
      avgVol5 <= avgVol20 * 1.05,
    name: "LPSY",
    date: latest.date,
    price: latest.c,
    support: roundPrice(events.sow.support || support),
    resistance: roundPrice(resistance),
    volumeRatio: avgVol20 > 0 ? +(latest.v / avgVol20).toFixed(2) : null,
  };

  const classification = classify(context, events, metrics);
  const entry = buildEntryPlan(classification, context, events, metrics);
  const action = buildActionPlan(classification, entry, context);

  let confidence = 42;
  if (classification.phase === "Accumulation" || classification.phase === "Distribution") confidence += 8;
  if (events.spring.active || events.upthrust.active || events.sos.active || events.sow.active) confidence += 18;
  if (events.backup.active || events.lpsy.active || events.stoppingVolume.active || events.buyingClimax.active) confidence += 8;
  if (context.rangeWidthPct <= 0.18) confidence += 6;
  if ((classification.phase === "Accumulation" && context.pricePositionPct <= 0.55) ||
      (classification.phase === "Distribution" && context.pricePositionPct >= 0.45)) confidence += 6;
  if (classification.phase === "Markdown" || classification.phase === "Markup") confidence += 12;
  if (context.trendBias === "range") confidence -= 6;
  if (metrics.meta?.historyBars != null && metrics.meta.historyBars < 45) confidence -= 8;
  confidence = clamp(confidence, 35, 92);

  const reasoning = buildReasoning(context, events, classification);
  const levelMap = {
    support: roundPrice(context.support),
    resistance: roundPrice(context.resistance),
    midpoint: roundPrice(context.midpoint),
    rangeWidthPct: +(context.rangeWidthPct * 100).toFixed(2),
    pricePositionPct: +(context.pricePositionPct * 100).toFixed(1),
    atr: roundPrice(context.atr),
  };

  return {
    phase: classification.phase,
    stage: classification.stage,
    label: classification.label,
    code: classification.code,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    bias: entry.status,
    levels: levelMap,
    events,
    action,
    entry,
    reasoning,
    context: {
      trendBias: context.trendBias,
      volumeDry: context.volumeDry,
      priceVsSma50Pct: +context.priceVsSma50Pct.toFixed(2),
      ret20: context.ret20 == null ? null : +context.ret20.toFixed(4),
      ret40: context.ret40 == null ? null : +context.ret40.toFixed(4),
      distanceFromSma20Atr: context.distanceFromSma20Atr,
      rangeLocation: rangeLabel(context.pricePositionPct),
    },
    notes: [
      "Wyckoff output is inferred from daily OHLCV, not intraday tape.",
      "The entry plan is only active when price behavior matches the listed confirmation condition.",
    ],
  };
}

module.exports = { analyzeWyckoff };
