// ─── analyzer.js ───────────────────────────────────────────────────────────────
// Pure computation. Input: raw market data. Output: derived metrics.
// No I/O, no side effects, no scoring. Just math + context.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");
const { buildSourceFlags } = require("./resolver");
const { analyzeWyckoff } = require("./wyckoff");

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return sma(trs.slice(-period), period);
}

function trend(values, window = 10) {
  if (values.length < window) return "flat";
  const slice = values.slice(-window);
  const mid = Math.floor(slice.length / 2);
  const first = slice.slice(0, mid).reduce((sum, value) => sum + value, 0) / mid;
  const second = slice.slice(mid).reduce((sum, value) => sum + value, 0) / (slice.length - mid);
  const ratio = second / first;
  if (ratio > 1.15) return "rising";
  if (ratio < 0.85) return "declining";
  return "flat";
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return +result.toFixed(0);
}

function normalizePrice(value, mode = "auto") {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (mode === "direct") return n;
  return n > 1000 ? n : n * 1000;
}

function pctChangeFromBase(current, base, digits = 2) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return +(((current / base) - 1) * 100).toFixed(digits);
}

function normalizeBars(rawBars, mode = "auto") {
  return (rawBars || [])
    .map((bar) => {
      const open = normalizePrice(bar.open, mode);
      const high = normalizePrice(bar.high, mode);
      const low = normalizePrice(bar.low, mode);
      const close = normalizePrice(bar.close, mode);

      return {
        date: bar.tradingDate || bar.date,
        o: mode === "direct" ? +open?.toFixed(2) : Math.round(open),
        h: mode === "direct" ? +high?.toFixed(2) : Math.round(high),
        l: mode === "direct" ? +low?.toFixed(2) : Math.round(low),
        c: mode === "direct" ? +close?.toFixed(2) : Math.round(close),
        v: Number(bar.volume) || 0,
        value: Number(bar.value) || 0,
        pctChange: Number.isFinite(Number(bar.pctChange)) ? Number(bar.pctChange) : null,
      };
    })
    .filter((bar) =>
      Number.isFinite(bar.o) &&
      Number.isFinite(bar.h) &&
      Number.isFinite(bar.l) &&
      Number.isFinite(bar.c)
    );
}

function trailingReturn(bars, lookbackBars = 60) {
  if (!bars.length || bars.length < 2) return null;
  const latest = bars[bars.length - 1];
  const baseIndex = Math.max(0, bars.length - lookbackBars);
  const base = bars[baseIndex];
  if (!latest?.c || !base?.c) return null;
  return +(latest.c / base.c - 1).toFixed(4);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pctVsBase(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return +((value / base - 1) * 100).toFixed(2);
}

function normalizePercentMetric(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed) > 1 ? +(parsed / 100).toFixed(4) : +parsed.toFixed(4);
}

function benchmarkAverage(marketBars, lookbackBars = 61) {
  const returns = Object.values(marketBars || {})
    .map((bars) => trailingReturn(bars, lookbackBars))
    .filter((value) => value != null);

  if (!returns.length) return null;
  return +(average(returns)).toFixed(4);
}

function benchmarkRegime(bars) {
  if (!bars?.length) return { score: null, label: "unknown" };
  const closes = bars.map((bar) => bar.c);
  const latest = bars[bars.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ret20 = trailingReturn(bars, 21) || 0;

  if (sma20 && sma50 && latest.c > sma20 && latest.c > sma50 && sma20 > sma50 && ret20 > 0) {
    return { score: 0.85, label: "bullish" };
  }
  if (sma50 && latest.c > sma50 && ret20 >= -0.01) {
    return { score: 0.7, label: "constructive" };
  }
  if (Math.abs(ret20) <= 0.03) {
    return { score: 0.55, label: "sideways" };
  }
  if (sma20 && sma50 && latest.c < sma20 && latest.c < sma50 && sma20 < sma50 && ret20 < 0) {
    return { score: 0.25, label: "bearish" };
  }
  return { score: 0.4, label: "fragile" };
}

function distributionDays(bars) {
  if (!bars?.length) return [];
  const settings = config.marketPulse || {};
  const lookback = settings.distributionLookback || 20;
  const minDrop = settings.distributionDropPct || -0.0025;
  const staleAdvance = settings.staleDistributionAdvancePct || 0.06;
  const latest = bars[bars.length - 1];
  const start = Math.max(1, bars.length - lookback);
  const days = [];

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    if (!prev?.c || !bar?.c) continue;

    const changePct = bar.c / prev.c - 1;
    const higherVolume = (bar.v || 0) > (prev.v || 0);
    const stillActive = latest.c < bar.c * (1 + staleAdvance);

    if (changePct <= minDrop && higherVolume && stillActive) {
      days.push({
        date: bar.date,
        changePct: +changePct.toFixed(4),
        volume: bar.v || 0,
      });
    }
  }

  return days;
}

function recentRallyLowIndex(bars) {
  if (!bars?.length) return null;
  const lookback = config.marketPulse?.rallyLookback || 15;
  const start = Math.max(0, bars.length - lookback);
  let lowIndex = start;

  for (let i = start + 1; i < bars.length; i++) {
    if ((bars[i]?.c || Number.MAX_SAFE_INTEGER) <= (bars[lowIndex]?.c || Number.MAX_SAFE_INTEGER)) {
      lowIndex = i;
    }
  }

  return lowIndex;
}

function detectFollowThroughDay(bars, lowIndex) {
  if (!bars?.length || lowIndex == null || lowIndex < 0 || lowIndex >= bars.length - 1) return null;
  const minPct = config.marketPulse?.followThroughMinPct || 0.012;
  const end = Math.min(bars.length - 1, lowIndex + 10);
  const lowBar = bars[lowIndex];

  for (let i = lowIndex + 4; i <= end; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    if (!prev?.c || !bar?.c || !lowBar?.c) continue;

    const changePct = bar.c / prev.c - 1;
    if (changePct >= minPct && (bar.v || 0) > (prev.v || 0) && bar.c > lowBar.c) {
      return {
        date: bar.date,
        changePct: +changePct.toFixed(4),
        dayCount: i - lowIndex,
      };
    }
  }

  return null;
}

function marketPulseFromBars(symbol, bars) {
  if (!bars?.length) {
    return {
      symbol,
      status: "unknown",
      score: null,
      exposure: "0-20%",
      distributionDays: 0,
      distributionDayDates: [],
      rallyDayCount: null,
      followThrough: null,
      note: "No benchmark data.",
    };
  }

  const closes = bars.map((bar) => bar.c);
  const latest = bars[bars.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const regime = benchmarkRegime(bars);
  const distDays = distributionDays(bars);
  const lowIndex = recentRallyLowIndex(bars);
  const rallyLow = lowIndex != null ? bars[lowIndex] : null;
  const rallyDayCount = lowIndex != null ? Math.max(0, bars.length - 1 - lowIndex) : null;
  const followThrough = detectFollowThroughDay(bars, lowIndex);

  let status = "correction";
  let score = 0.25;
  let exposure = "0-20%";
  let note = "The benchmark is still in correction mode.";

  const aboveSma20 = sma20 != null ? latest.c > sma20 : false;
  const aboveSma50 = sma50 != null ? latest.c > sma50 : false;
  const inHealthyTrend = (regime.label === "bullish" || regime.label === "constructive") && aboveSma20 && aboveSma50;

  if (inHealthyTrend && distDays.length <= 2) {
    status = "confirmed_uptrend";
    score = 0.85;
    exposure = "60-100%";
    note = "Price is above key averages and distribution pressure is light.";
  } else if (followThrough && aboveSma20 && rallyLow?.c != null && latest.c > rallyLow.c) {
    status = distDays.length >= 3 ? "uptrend_under_pressure" : "confirmed_uptrend";
    score = status === "confirmed_uptrend" ? 0.8 : 0.62;
    exposure = status === "confirmed_uptrend" ? "40-80%" : "20-40%";
    note = `${followThrough.date} produced a follow-through style confirmation after the recent low.`;
  } else if (rallyDayCount != null && rallyDayCount >= 1 && rallyLow?.c != null && latest.c > rallyLow.c) {
    status = "rally_attempt";
    score = 0.5;
    exposure = "0-20%";
    note = "A rally attempt is in progress, but no follow-through confirmation has appeared yet.";
  }

  if (distDays.length >= 5 || ((regime.label === "bearish" || regime.label === "fragile") && !followThrough)) {
    status = "correction";
    score = 0.25;
    exposure = "0-20%";
    note = distDays.length >= 5
      ? `Distribution pressure is elevated with ${distDays.length} active distribution days.`
      : "The benchmark remains below healthy trend support without a follow-through confirmation.";
  } else if (status === "confirmed_uptrend" && distDays.length >= 3) {
    status = "uptrend_under_pressure";
    score = 0.62;
    exposure = "20-40%";
    note = `The uptrend is still alive, but ${distDays.length} distribution days keep it under pressure.`;
  }

  return {
    symbol,
    status,
    score,
    exposure,
    distributionDays: distDays.length,
    distributionDayDates: distDays.map((day) => day.date),
    rallyDayCount,
    followThrough,
    note,
  };
}

function marketTrendScore(marketBars) {
  const scores = Object.values(marketBars || {})
    .map((bars) => marketPulseFromBars(null, bars).score)
    .filter((value) => value != null);

  if (!scores.length) return null;
  return +(average(scores)).toFixed(2);
}

function marketTrendLabel(score) {
  if (score == null) return "unknown";
  if (score >= 0.75) return "bullish";
  if (score >= 0.58) return "constructive";
  if (score >= 0.45) return "mixed";
  if (score >= 0.3) return "defensive";
  return "bearish";
}

function benchmarkDetails(marketBars) {
  return Object.fromEntries(
    Object.entries(marketBars || {}).map(([symbol, bars]) => {
      if (!bars.length) return [symbol, null];
      const latest = bars[bars.length - 1];
      const prev = bars.length > 1 ? bars[bars.length - 2] : null;
      const closes = bars.map((bar) => bar.c);
      const regime = benchmarkRegime(bars);
      const pulse = marketPulseFromBars(symbol, bars);

      return [symbol, {
        price: latest.c,
        open: latest.o,
        prevClose: prev?.c || null,
        sessionChangePct: pctChangeFromBase(latest.c, latest.o),
        prevCloseChangePct: pctChangeFromBase(latest.c, prev?.c),
        // Deprecated alias kept for compatibility with existing consumers.
        changePct: pctChangeFromBase(latest.c, latest.o),
        ret1m: trailingReturn(bars, 22),
        ret3m: trailingReturn(bars, 61),
        sma20: sma(closes, 20) ? +sma(closes, 20).toFixed(2) : null,
        sma50: sma(closes, 50) ? +sma(closes, 50).toFixed(2) : null,
        regime: regime.label,
        regimeScore: regime.score,
        trendScore: pulse.score ?? regime.score,
        pulse,
        date: latest.date,
      }];
    })
  );
}

function aggregateMarketPulse(indexes) {
  const rows = Object.entries(indexes || {})
    .filter(([, detail]) => detail?.pulse?.score != null);

  if (!rows.length) {
    return {
      primary: null,
      status: "unknown",
      score: null,
      exposure: "0-20%",
      distributionDays: 0,
      followThrough: null,
      note: "No benchmark pulse available.",
    };
  }

  const [primarySymbol, primary] = rows.find(([symbol]) => symbol === "VNINDEX") || rows[0];
  const avgScore = average(rows.map(([, detail]) => detail.pulse.score));
  const supportiveCount = rows.filter(([, detail]) => detail.pulse.status === "confirmed_uptrend").length;
  const correctionCount = rows.filter(([, detail]) => detail.pulse.status === "correction").length;

  let status = primary.pulse.status;
  if (status === "confirmed_uptrend" && correctionCount > 0) status = "uptrend_under_pressure";
  if (status === "rally_attempt" && supportiveCount === rows.length) status = "confirmed_uptrend";

  return {
    primary: primarySymbol,
    status,
    score: avgScore == null ? null : +avgScore.toFixed(2),
    exposure: primary.pulse.exposure,
    distributionDays: primary.pulse.distributionDays,
    followThrough: primary.pulse.followThrough,
    note: primary.pulse.note,
  };
}

function toMarketClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.sources.marketTimeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

function sessionState(date = new Date()) {
  const clock = toMarketClock(date);
  const weekday = clock.weekday;
  if (weekday === "Sat" || weekday === "Sun") return "closed";

  const hour = Number(clock.hour);
  const minute = Number(clock.minute);
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes < 9 * 60) return "pre_open";
  if (totalMinutes < 11 * 60 + 30) return "open_am";
  if (totalMinutes < 13 * 60) return "lunch_break";
  if (totalMinutes < 14 * 60 + 30) return "open_pm";
  if (totalMinutes < 14 * 60 + 45) return "atc";
  return "closed";
}

function freshnessSec(rawMeta) {
  const fetchedAt = rawMeta?.fetchedAt || rawMeta?.ohlcv?.fetchedAt || null;
  if (!fetchedAt) return null;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs >= 0 ? Math.round(ageMs / 1000) : 0;
}

function computeMetrics(rawOhlcv, rawOverview, rawForeign, rawMarket, rawMeta = {}) {
  const bars = normalizeBars(rawOhlcv, "auto");
  const marketBars = Object.fromEntries(
    Object.entries(rawMarket || {})
      .map(([symbol, series]) => [symbol, normalizeBars(series, "direct")])
      .filter(([, series]) => series.length > 0)
  );

  if (!bars.length) throw new Error("No OHLCV bars");

  const latest = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const closes = bars.map((bar) => bar.c);
  const volumes = bars.map((bar) => bar.v);
  const highs = bars.map((bar) => bar.h);
  const lows = bars.map((bar) => bar.l);

  const high52w = Math.max(...highs);
  const low52w = Math.min(...lows);
  const nearHighPct = latest.c / high52w;
  const priceRange20d = bars.length >= 20
    ? (Math.max(...highs.slice(-20)) - Math.min(...lows.slice(-20))) / latest.c
    : null;

  const sma20Value = sma(closes, 20);
  const sma50Value = sma(closes, 50);
  const sma200Value = sma(closes, Math.min(200, closes.length));

  const avgVol20 = sma(volumes, config.periods.avgVol) || 0;
  const volRatio = avgVol20 > 0 ? +(latest.v / avgVol20).toFixed(2) : 0;
  const volTrend = trend(volumes, 10);

  const rsi14 = rsi(closes, config.periods.rsi);
  const atr14Value = atr(bars, config.periods.atr);

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 != null && ema26 != null ? +(ema12 - ema26).toFixed(0) : null;

  const overview = rawOverview || {};
  const pe = overview.pe || overview.priceToEarning || null;
  const pb = overview.pb || overview.priceToBook || null;
  const eps = overview.epsTTM || overview.eps || null;
  const roe = overview.roe || null;
  const outstandingShares = overview.outstandingShares || null;
  const marketCap = overview.marketCap || overview.mktCap ||
    (Number.isFinite(outstandingShares) ? Math.round(outstandingShares * latest.c) : null);
  const revenueGrowth = normalizePercentMetric(overview.revenueGrowth1Year || overview.revenueGrowth || null);
  const earningsGrowth = normalizePercentMetric(overview.earningGrowth1Year || overview.earningGrowth || overview.earningsGrowth || null);
  const epsGrowthQoQ = normalizePercentMetric(overview.epsGrowthQoQ);
  const epsGrowth1Y = normalizePercentMetric(overview.epsGrowth1Y || earningsGrowth);
  const institutionScore = normalizePercentMetric(
    overview.institutionScore != null ? overview.institutionScore : overview.institutionOwnership
  );

  let foreignNet5d = null;
  let foreignNetPct = null;
  if (rawForeign?.data?.length > 0) {
    foreignNet5d = rawForeign.data
      .slice(0, 5)
      .reduce((sum, day) => sum + ((day.buyVol || 0) - (day.sellVol || 0)), 0);
    foreignNetPct = avgVol20 > 0 ? foreignNet5d / (avgVol20 * 5) : 0;
  }

  const stockRet1d = trailingReturn(bars, 2);
  const stockRet1w = trailingReturn(bars, 6);
  const stockRet1m = trailingReturn(bars, 22);
  const stockRet3m = trailingReturn(bars, 61);
  const benchmark3m = benchmarkAverage(marketBars, 61);
  const marketIndexes = benchmarkDetails(marketBars);
  const marketPulse = aggregateMarketPulse(marketIndexes);
  const vnindex3m = marketIndexes.VNINDEX?.ret3m ?? null;
  const vn303m = marketIndexes.VN30?.ret3m ?? null;
  const rs3m = benchmark3m == null || stockRet3m == null
    ? stockRet3m
    : +((stockRet3m) - benchmark3m).toFixed(4);
  const marketTrend = marketPulse.score ?? marketTrendScore(marketBars);
  const marketRegime = marketPulse.status === "confirmed_uptrend"
    ? "bullish"
    : marketPulse.status === "uptrend_under_pressure"
      ? "constructive"
      : marketPulse.status === "rally_attempt"
        ? "mixed"
        : marketPulse.status === "correction"
          ? "bearish"
          : marketTrendLabel(marketTrend);

  const aboveSMA50 = sma50Value ? latest.c > sma50Value : false;
  const belowSMA50 = sma50Value ? latest.c < sma50Value : false;
  const sma20AboveSMA50 = sma20Value && sma50Value ? sma20Value > sma50Value : false;
  const sma20BelowSMA50 = sma20Value && sma50Value ? sma20Value < sma50Value : false;
  const rangeCompression = priceRange20d != null && priceRange20d < 0.08;
  const nearHigh = nearHighPct > 0.95;
  const volSpike = volRatio > 1.5;
  const priceStalling = prev
    ? Math.abs(latest.c - prev.c) / prev.c < 0.005 && volSpike
    : false;

  const recentLows = lows.slice(-20);
  const recentHighs = highs.slice(-20);
  const support1 = Math.min(...recentLows);
  const resistance1 = Math.max(...recentHighs);
  const atrValue = atr14Value || latest.c * 0.02;

  const entry = [
    Math.round(latest.c),
    Math.round(latest.c - atrValue * 0.5),
    Math.round(support1 + (latest.c - support1) * 0.3),
  ].sort((a, b) => b - a);

  const tp = [
    Math.round(latest.c + atrValue * 1.5),
    Math.round(latest.c + atrValue * 2.5),
    Math.round(resistance1 + atrValue),
  ].sort((a, b) => a - b);

  const sl = Math.round(support1 - atrValue * 0.5);

  const valueFallback = Math.round(latest.c * latest.v);
  const tradedValue = latest.value > 0 ? latest.value : valueFallback;
  const avgValue20 = Math.round(
    average(
      bars
        .slice(-20)
        .map((bar) => (bar.value > 0 ? bar.value : Math.round(bar.c * bar.v)))
        .filter((value) => Number.isFinite(value))
    ) || 0
  );

  const metricMeta = {
    fetchedAt: rawMeta?.fetchedAt || rawMeta?.ohlcv?.fetchedAt || new Date().toISOString(),
    freshnessSec: freshnessSec(rawMeta),
    requestedOhlcvDays: rawMeta?.ohlcv?.requestedDays || null,
    historyFromDate: rawMeta?.ohlcv?.fromDate || null,
    historyToDate: rawMeta?.ohlcv?.toDate || null,
    historyBars: rawMeta?.ohlcv?.historyBars || bars.length,
    totalBars: rawMeta?.ohlcv?.totalBars || bars.length,
    snapshotOverlayUsed: !!rawMeta?.ohlcv?.snapshotOverlayUsed,
    snapshotFailed: !!rawMeta?.ohlcv?.snapshotFailed,
    snapshotError: rawMeta?.ohlcv?.snapshotError || null,
    overviewWarnings: rawMeta?.overview?.warnings || [],
    sourceFlags: buildSourceFlags({
      snapshotOverlayUsed: !!rawMeta?.ohlcv?.snapshotOverlayUsed,
      marketSource: rawMeta?.market?.source || "vps_history",
      fundamentalsSource: rawMeta?.overview?.source || "unavailable",
      ownershipSource: rawMeta?.ownership?.source || rawMeta?.overview?.source || "unavailable",
      foreignSource: rawMeta?.foreign?.source || "unavailable",
    }),
  };

  const sessionChangePct = pctChangeFromBase(latest.c, latest.o);
  const prevCloseChangePct = Number.isFinite(latest.pctChange)
    ? +latest.pctChange.toFixed(2)
    : pctChangeFromBase(latest.c, prev?.c);

  const baseMetrics = {
    price: latest.c,
    open: latest.o,
    high: latest.h,
    low: latest.l,
    prevClose: prev?.c || null,
    sessionChangePct,
    prevCloseChangePct,
    // Deprecated alias kept for compatibility with existing consumers.
    changePct: sessionChangePct,
    priceDate: latest.date,
    high52w,
    low52w,
    nearHighPct: +nearHighPct.toFixed(3),

    volume: latest.v,
    avgVol20: Math.round(avgVol20),
    volRatio,
    volTrend,
    tradedValue,
    avgValue20,

    sma20: sma20Value ? Math.round(sma20Value) : null,
    sma50: sma50Value ? Math.round(sma50Value) : null,
    sma200: sma200Value ? Math.round(sma200Value) : null,

    rsi14,
    atr14: atr14Value ? Math.round(atr14Value) : null,
    macd: macdLine,

    pe: pe ? +parseFloat(pe).toFixed(1) : null,
    pb: pb ? +parseFloat(pb).toFixed(1) : null,
    eps: eps ? Math.round(eps) : null,
    roe: roe
      ? +(typeof roe === "number" ? (roe > 1 ? roe : roe * 100) : parseFloat(roe)).toFixed(1)
      : null,
    marketCap,
    revenueGrowth,
    earningsGrowth,

    epsGrowthQoQ,
    epsGrowth1Y,
    institutionScore,
    volScore: volRatio,
    rs3m,
    foreignNetPct: foreignNetPct == null ? null : +foreignNetPct.toFixed(4),
    marketTrend,

    foreignNet5d,

    stockRs1d: stockRet1d,
    stockRs1w: stockRet1w,
    stockRs1m: stockRet1m,
    stockRs3m: stockRet3m,
    benchmarkRs3m: benchmark3m,

    relative: {
      ret1d: stockRet1d,
      ret1w: stockRet1w,
      ret1m: stockRet1m,
      ret3m: stockRet3m,
      vsVNINDEX3m: stockRet3m != null && vnindex3m != null ? +(stockRet3m - vnindex3m).toFixed(4) : null,
      vsVN303m: stockRet3m != null && vn303m != null ? +(stockRet3m - vn303m).toFixed(4) : null,
      priceVsSma20Pct: sma20Value ? pctVsBase(latest.c, sma20Value) : null,
      priceVsSma50Pct: sma50Value ? pctVsBase(latest.c, sma50Value) : null,
    },

    marketContext: {
      session: sessionState(),
      regime: marketRegime,
      trendScore: marketTrend,
      pulse: marketPulse,
      indexes: marketIndexes,
    },

    meta: metricMeta,

    aboveSMA50,
    belowSMA50,
    sma20AboveSMA50,
    sma20BelowSMA50,
    rangeCompression,
    nearHigh,
    volSpike,
    priceStalling,

    entry,
    tp,
    sl,

    recent20: bars.slice(-20),
  };

  const wyckoff = analyzeWyckoff(bars, baseMetrics);
  const primaryPlan = wyckoff.entry?.plans?.[0] || null;
  const activeBuyPlans = (wyckoff.entry?.plans || [])
    .filter((plan) => Number.isFinite(plan.price) && (plan.kind === "buy" || plan.kind === "wait"));
  const entryLevels = activeBuyPlans.length
    ? activeBuyPlans.map((plan) => plan.price)
    : [];
  const tpLevels = primaryPlan && Number.isFinite(primaryPlan.target1) && Number.isFinite(primaryPlan.target2)
    ? [primaryPlan.target1, primaryPlan.target2].sort((a, b) => a - b)
    : [];
  const stopLevel = primaryPlan && Number.isFinite(primaryPlan.stop)
    ? primaryPlan.stop
    : null;

  return {
    ...baseMetrics,
    wyckoff,
    entry: entryLevels,
    tp: tpLevels,
    sl: stopLevel,
  };
}

module.exports = { computeMetrics };
