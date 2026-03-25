// ─── config.js ─────────────────────────────────────────────────────────────────
// Single source of truth: stocks, thresholds, settings.
// Extend by adding keys — existing code won't break.
// ────────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Watchlist ──
  stocks: [
    { ticker: "FPT", name: "FPT Corp", sector: "TECH" },
    { ticker: "TCB", name: "Techcombank", sector: "BANK" },
    { ticker: "HDB", name: "HDBank", sector: "BANK" },
    { ticker: "MWG", name: "Thế Giới Di Động", sector: "RETAIL" },
    { ticker: "CTG", name: "VietinBank", sector: "BANK" },
  ],

  // ── Data Source ──
  sources: {
    primary: "vps",
    vpsSnapshot: "https://bgapidatafeed.vps.com.vn",
    vpsHistory: "https://histdatafeed.vps.com.vn",
    kbsProfile: "https://kbbuddywts.kbsec.com.vn/iis-server/investment/stockinfo",
    kbsFinance: "https://kbbuddywts.kbsec.com.vn/sas/kbsv-stock-data-store/stock/finance-info",
    kbsCacheTtlMs: 6 * 60 * 60 * 1000,
    kbsFailureTtlMs: 2 * 60 * 1000,
    kbsTimeout: 6000,
    fireantBase: "https://api.fireant.vn",
    fireantCacheTtlMs: 6 * 60 * 60 * 1000,
    marketBenchmarks: ["VNINDEX", "VN30"],
    marketTimeZone: "Asia/Ho_Chi_Minh",
    ohlcvDays: 90,
    timeout: 15000,
    roadmap: {
      kbs: { status: "active", role: "fundamentals_ownership_enrichment" },
      fireant: { status: "planned", role: "fundamentals_enrichment" },
      ssi: { status: "planned", role: "execution_metadata" },
      fiingroup: { status: "vendor_review", role: "enterprise_datafeed" },
      vietstock: { status: "vendor_review", role: "enterprise_datafeed" },
      vnstock: { status: "reference_only", role: "research_prototyping" },
    },
  },

  // ── Technical periods ──
  periods: {
    sma: [20, 50, 200],
    rsi: 14,
    avgVol: 20,
    atr: 14,
  },

  // ── Volume classification thresholds (vol / avg_vol_20 ratio) ──
  volumeRules: {
    CLIMAX:    { min: 2.0 },
    ABOVE_AVG: { min: 1.3 },
    NORMAL:    { min: 0.5 },
    DRY_UP:    { min: 0 },    // fallback
  },

  // ── CAN SLIM scoring (1-10 per factor) ──
  // Each factor: metric name → [threshold_for_3, _5, _7, _9]
  // Score: <t[0]=2, <t[1]=4, <t[2]=6, <t[3]=8, else=10
  canslim: {
    C: { metric: "epsGrowthQoQ",   thresholds: [0, 0.10, 0.20, 0.40] },
    A: { metric: "epsGrowth1Y",    thresholds: [0, 0.08, 0.15, 0.25] },
    N: { metric: "nearHighPct",    thresholds: [0.70, 0.80, 0.90, 0.95] },
    S: { metric: "volScore",       thresholds: [0.4, 0.7, 1.0, 1.5] },
    L: { metric: "rs3m",           thresholds: [-0.05, 0, 0.05, 0.15] },
    I: { metric: "institutionScore", thresholds: [0.05, 0.10, 0.20, 0.35] },
    M: { metric: "marketTrend",    thresholds: [0.3, 0.5, 0.6, 0.8] },
  },

  // ── CAN SLIM strength ranking ──
  strength: {
    eliteScore: 80,
    strongScore: 65,
    watchScore: 40,
    leaderRsThreshold: 0.05,
    weakRsThreshold: -0.05,
  },

  // ── IBD-style market timing proxy ──
  marketPulse: {
    distributionLookback: 20,
    rallyLookback: 15,
    distributionDropPct: -0.0025,
    followThroughMinPct: 0.012,
    staleDistributionAdvancePct: 0.06,
  },

  // ── Wyckoff structure heuristics ──
  // Daily-bar approximation only. Used to map phase, action, and entry logic.
  wyckoff: {
    structureLookback: 30,
    contextLookback: 40,
    recentEventWindow: 8,
    breakoutPct: 0.005,
    fakeoutPct: 0.003,
    dryVolumeRatio: 0.85,
    expansionVolumeRatio: 1.25,
    climaxVolumeRatio: 1.8,
    markupExtensionAtr: 2.2,
    stopBufferAtr: 0.6,
    testWindow: 12,
    minTestRiskReward: 3,
  },

  // ── Persistence ──
  store: {
    path: "./data/scans.json",
    maxScansPerTicker: 50,
  },

  // ── Server ──
  server: {
    port: 3000,
  },
};
