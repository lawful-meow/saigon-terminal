const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-scan-recovery-"));
process.env.SAIGON_STORE_PATH = path.join(tempRoot, "scans.json");
process.env.SAIGON_WATCHLIST_PATH = path.join(tempRoot, "watchlist.json");
process.env.SAIGON_DOCS_DIR = path.join(tempRoot, "docs");
process.env.SAIGON_WORKSPACE_PATH = path.join(tempRoot, "workspace.json");

const { buildScanSnapshot } = require("../engine");
const scanService = require("../services/scan-service");

function makeStock(overrides = {}) {
  const changePct = overrides.changePct ?? 0;
  return {
    ticker: overrides.ticker || "AAA",
    name: overrides.name || overrides.ticker || "AAA",
    sector: overrides.sector || "TECH",
    tradedValue: overrides.tradedValue ?? 100,
    sessionChangePct: changePct,
    prevCloseChangePct: changePct,
    changePct,
    observedCanSlimTotal: overrides.observedCanSlimTotal ?? 42,
    observedCanSlimMax: overrides.observedCanSlimMax ?? 70,
    strength: overrides.strength || {
      score: 72,
      label: "strong",
      rank: 1,
      percentile: 92,
    },
    breakout: overrides.breakout || {
      state: "near_trigger",
    },
    quality: overrides.quality || {
      label: "high",
      warnings: [],
      sourceFlags: {
        price: "vps_snapshot_overlay",
        fundamentals: "kbs_finance",
        ownership: "quarantined",
        foreign: "unavailable",
      },
      sourceHealth: [
        {
          id: "vps_history",
          name: "VPS history",
          critical: true,
          status: "ok",
          message: "Live request succeeded",
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    signal: overrides.signal || "BUY",
    confidence: overrides.confidence ?? 8,
    market: overrides.market || {
      session: "closed",
      regime: "constructive",
      pulse: { status: "uptrend", note: "Constructive tape." },
    },
    relative: overrides.relative || {
      ret1w: 0.01,
      ret1m: 0.05,
      ret3m: 0.12,
      vsVNINDEX3m: 0.08,
      vsVN303m: 0.06,
      priceVsSma20Pct: 3,
      priceVsSma50Pct: 6,
    },
    executionRisk: overrides.executionRisk || {
      liquidityLabel: "tradeable",
      reason: "Liquidity clears the floor.",
    },
    wyckoff: overrides.wyckoff || {
      entry: { summary: "Pilot entry valid." },
    },
  };
}

test("persistScanOutcome keeps the last successful workspace when a later scan fails", () => {
  const healthySnapshot = buildScanSnapshot([
    makeStock({ ticker: "AAA", name: "Alpha" }),
  ], {
    scanMode: "watchlist",
    requestedCount: 1,
    scannedCount: 1,
    errorCount: 0,
  });

  scanService.persistLatestSnapshot(healthySnapshot, {
    source: "test",
    mode: "watchlist",
    selectedTicker: "AAA",
  });

  const failedSnapshot = buildScanSnapshot([], {
    scanMode: "watchlist",
    requestedCount: 1,
    scannedCount: 0,
    errorCount: 1,
  });

  scanService.persistScanOutcome({
    snapshot: failedSnapshot,
    errors: [{
      ticker: "AAA",
      error: "VPS history down",
      sourceStatus: {
        id: "vps_history",
        name: "VPS history",
        critical: true,
        status: "down",
        message: "VPS history down",
        updatedAt: new Date().toISOString(),
      },
    }],
  }, {
    source: "test",
    mode: "watchlist",
  });

  const record = scanService.getLatestSnapshotRecord();
  assert.equal(record.snapshot.count, 1);
  assert.equal(record.lastAttemptDiagnostics.stale, true);
  assert.equal(record.lastAttemptDiagnostics.errors.length, 1);
  assert.equal(record.lastAttemptDiagnostics.sourceHealth.find((item) => item.id === "vps_history")?.status, "down");
});
