const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-terminal-test-"));
process.env.SAIGON_STORE_PATH = path.join(tempRoot, "scans.json");
process.env.SAIGON_WATCHLIST_PATH = path.join(tempRoot, "watchlist.json");
process.env.SAIGON_DOCS_DIR = path.join(tempRoot, "docs");

const store = require("../store");
const { createServer } = require("../server");
const { buildScanSnapshot } = require("../engine");
const publisher = require("../publisher");

function makeStock(overrides = {}) {
  const changePct = overrides.changePct ?? 0;
  const sessionChangePct = overrides.sessionChangePct ?? changePct;
  const prevCloseChangePct = overrides.prevCloseChangePct ?? changePct;

  return {
    ticker: overrides.ticker || "AAA",
    name: overrides.name || overrides.ticker || "AAA",
    sector: overrides.sector || "TECH",
    tradedValue: overrides.tradedValue ?? 100,
    sessionChangePct,
    prevCloseChangePct,
    changePct,
    observedCanSlimTotal: overrides.observedCanSlimTotal ?? 40,
    observedCanSlimMax: overrides.observedCanSlimMax ?? 70,
    market: overrides.market || {
      session: "closed",
      regime: "bearish",
      pulse: {
        status: "correction",
        exposure: "0-20%",
        distributionDays: 5,
      },
      indexes: {
        VNINDEX: {
          price: 1000,
          sessionChangePct: -1,
          prevCloseChangePct: -1,
          changePct: -1,
          ret1m: -0.1,
          ret3m: -0.2,
          regime: "bearish",
          pulse: { status: "correction", score: 0.25 },
        },
      },
    },
    relative: overrides.relative || {
      ret1w: 0,
      ret1m: 0,
      ret3m: 0,
      vsVNINDEX3m: 0,
      vsVN303m: 0,
      priceVsSma20Pct: 0,
      priceVsSma50Pct: 0,
    },
    strength: overrides.strength || {
      score: 50,
      label: "steady",
      rank: null,
      percentile: 50,
    },
    breakout: overrides.breakout || {
      state: "not_ready",
      score: 0,
      triggerPrice: null,
      distancePct: null,
      invalidation: null,
      volumeSupport: false,
      reason: "n/a",
    },
    executionRisk: overrides.executionRisk || {
      status: "unavailable",
      liquidityLabel: "trap_risk",
      avgValue20: overrides.avgValue20 ?? overrides.tradedValue ?? 100,
      tradedValue: overrides.tradedValue ?? 100,
      stopDistancePct: null,
      stopDistanceAtr: null,
      riskReward1: null,
      riskReward2: null,
      pilotShares: 0,
      fullShares: 0,
      pilotNotional: 0,
      fullNotional: 0,
      reason: "n/a",
    },
    scanRunId: overrides.scanRunId ?? null,
    ...overrides,
  };
}

test("GET and DELETE /api/history are both reachable", async () => {
  store.clear();
  store.addScan("FPT", {
    ticker: "FPT",
    price: 77000,
    signal: "HOLD",
    confidence: 5,
    scanTime: new Date().toISOString(),
  });

  const server = createServer(0);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const before = await fetch(`http://127.0.0.1:${port}/api/history`);
    assert.equal(before.status, 200);
    const beforeJson = await before.json();
    assert.ok(beforeJson.FPT);

    const cleared = await fetch(`http://127.0.0.1:${port}/api/history`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.deepEqual(await cleared.json(), { status: "cleared" });

    const after = await fetch(`http://127.0.0.1:${port}/api/history`);
    assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), {});
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    store.clear();
  }
});

test("buildScanSnapshot keeps top-N display rows but summarizes the full scanned universe", () => {
  const results = [
    makeStock({ ticker: "AAA", sector: "TECH", tradedValue: 100, changePct: 1 }),
    makeStock({ ticker: "BBB", sector: "BANK", tradedValue: 200, changePct: -2 }),
    makeStock({ ticker: "CCC", sector: "ENERGY", tradedValue: 300, changePct: 3 }),
  ];

  const snapshot = buildScanSnapshot(results, {
    topN: 1,
    universeCount: 3,
    requestedCount: 3,
    scannedCount: 3,
    errorCount: 0,
    scanMode: "batch_top_strength",
    delayMs: 450,
  });

  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.stocks.length, 1);
  assert.equal(snapshot.market.turnover, 600);
  assert.deepEqual(snapshot.market.breadth, {
    advancers: 2,
    decliners: 1,
    unchanged: 0,
  });
  assert.deepEqual(
    snapshot.market.sectors.all.map((sector) => sector.sector),
    ["ENERGY", "TECH", "BANK"]
  );
});

test("getPreviousRunStocks skips incomplete runs and sector drift appears only for comparable watchlist runs", () => {
  store.clear();
  const universeKey = "AAA|BBB";

  store.addScan("AAA", {
    ticker: "AAA",
    sector: "BANK",
    scanRunId: "run-incomplete",
    _scanMode: "watchlist",
    _scanUniverseKey: universeKey,
    scanTime: "2026-03-25T09:00:00.000Z",
  });

  store.addScan("AAA", {
    ticker: "AAA",
    sector: "BANK",
    scanRunId: "run-complete",
    _scanMode: "watchlist",
    _scanUniverseKey: universeKey,
    scanTime: "2026-03-24T09:00:00.000Z",
  });
  store.addScan("BBB", {
    ticker: "BBB",
    sector: "TECH",
    scanRunId: "run-complete",
    _scanMode: "watchlist",
    _scanUniverseKey: universeKey,
    scanTime: "2026-03-24T09:00:01.000Z",
  });

  const previousRun = store.getPreviousRunStocks({
    currentRunId: "run-current",
    scanMode: "watchlist",
    universeKey,
  });

  assert.equal(previousRun.length, 2);
  assert.deepEqual(previousRun.map((stock) => stock.ticker).sort(), ["AAA", "BBB"]);

  const previousStocks = [
    makeStock({
      ticker: "AAA",
      sector: "BANK",
      changePct: 2,
      tradedValue: 300,
      relative: { ret1w: 0.02, ret1m: 0.08, ret3m: 0.18, vsVNINDEX3m: 0.14, vsVN303m: 0.1, priceVsSma20Pct: 4, priceVsSma50Pct: 8 },
      strength: { score: 82, label: "leader", rank: 1, percentile: 99 },
    }),
    makeStock({
      ticker: "AAB",
      sector: "BANK",
      changePct: 1,
      tradedValue: 250,
      relative: { ret1w: 0.01, ret1m: 0.05, ret3m: 0.11, vsVNINDEX3m: 0.09, vsVN303m: 0.06, priceVsSma20Pct: 3, priceVsSma50Pct: 6 },
      strength: { score: 76, label: "strong", rank: 2, percentile: 90 },
    }),
    makeStock({
      ticker: "BBB",
      sector: "TECH",
      changePct: -1,
      tradedValue: 200,
      relative: { ret1w: -0.02, ret1m: -0.04, ret3m: 0.01, vsVNINDEX3m: -0.03, vsVN303m: -0.01, priceVsSma20Pct: -2, priceVsSma50Pct: -4 },
      strength: { score: 54, label: "mixed", rank: 3, percentile: 45 },
    }),
    makeStock({
      ticker: "BBC",
      sector: "TECH",
      changePct: 0,
      tradedValue: 180,
      relative: { ret1w: -0.01, ret1m: -0.02, ret3m: 0.02, vsVNINDEX3m: -0.01, vsVN303m: 0, priceVsSma20Pct: -1, priceVsSma50Pct: -2 },
      strength: { score: 58, label: "mixed", rank: 4, percentile: 52 },
    }),
  ];

  const currentStocks = [
    makeStock({
      ticker: "AAA",
      sector: "BANK",
      changePct: -1,
      tradedValue: 210,
      relative: { ret1w: -0.01, ret1m: 0.01, ret3m: 0.04, vsVNINDEX3m: 0.01, vsVN303m: 0, priceVsSma20Pct: 1, priceVsSma50Pct: 2 },
      strength: { score: 64, label: "steady", rank: 3, percentile: 60 },
    }),
    makeStock({
      ticker: "AAB",
      sector: "BANK",
      changePct: 0,
      tradedValue: 205,
      relative: { ret1w: 0, ret1m: 0.02, ret3m: 0.05, vsVNINDEX3m: 0.02, vsVN303m: 0.01, priceVsSma20Pct: 1, priceVsSma50Pct: 3 },
      strength: { score: 62, label: "steady", rank: 4, percentile: 55 },
    }),
    makeStock({
      ticker: "BBB",
      sector: "TECH",
      changePct: 3,
      tradedValue: 280,
      relative: { ret1w: 0.03, ret1m: 0.09, ret3m: 0.19, vsVNINDEX3m: 0.15, vsVN303m: 0.12, priceVsSma20Pct: 5, priceVsSma50Pct: 9 },
      strength: { score: 85, label: "leader", rank: 1, percentile: 99 },
    }),
    makeStock({
      ticker: "BBC",
      sector: "TECH",
      changePct: 2,
      tradedValue: 260,
      relative: { ret1w: 0.02, ret1m: 0.07, ret3m: 0.16, vsVNINDEX3m: 0.12, vsVN303m: 0.1, priceVsSma20Pct: 4, priceVsSma50Pct: 7 },
      strength: { score: 80, label: "strong", rank: 2, percentile: 94 },
    }),
  ];

  const watchlistSnapshot = buildScanSnapshot(currentStocks, {
    scanMode: "watchlist",
    previousSummaryStocks: previousStocks,
  });
  const watchlistSectors = new Map(watchlistSnapshot.market.sectors.all.map((sector) => [sector.sector, sector]));

  assert.equal(watchlistSectors.get("TECH").rank, 1);
  assert.equal(watchlistSectors.get("TECH").prevRank, 2);
  assert.equal(watchlistSectors.get("TECH").rankDelta, 1);
  assert.equal(watchlistSectors.get("BANK").rank, 2);
  assert.equal(watchlistSectors.get("BANK").prevRank, 1);
  assert.equal(watchlistSectors.get("BANK").rankDelta, -1);

  const batchSnapshot = buildScanSnapshot(currentStocks, {
    scanMode: "batch_top_strength",
    previousSummaryStocks: previousStocks,
  });

  assert.equal(batchSnapshot.market.sectors.all[0].prevRank, null);
  assert.equal(batchSnapshot.market.sectors.all[0].rankDelta, null);
});

test("publishSnapshot writes sector rotation and stock scan metadata", () => {
  const snapshot = buildScanSnapshot([
    makeStock({
      ticker: "AAA",
      sector: "BANK",
      scanRunId: "watchlist-run-1",
      relative: { ret1w: 0.02, ret1m: 0.06, ret3m: 0.14, vsVNINDEX3m: 0.1, vsVN303m: 0.07, priceVsSma20Pct: 4, priceVsSma50Pct: 6 },
      strength: { score: 78, label: "strong", rank: 1, percentile: 96 },
    }),
    makeStock({
      ticker: "BBB",
      sector: "TECH",
      scanRunId: "watchlist-run-1",
      relative: { ret1w: 0.01, ret1m: 0.03, ret3m: 0.07, vsVNINDEX3m: 0.04, vsVN303m: 0.03, priceVsSma20Pct: 2, priceVsSma50Pct: 4 },
      strength: { score: 68, label: "steady", rank: 2, percentile: 82 },
    }),
  ], {
    scanMode: "watchlist",
  });

  const result = publisher.publishSnapshot(snapshot, {
    prompt: "rotation snapshot",
    selectedTicker: "AAA",
  });

  assert.equal(result.status, "ok");

  const snapshotPath = path.join(process.env.SAIGON_DOCS_DIR, "snapshot.json");
  const published = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

  assert.equal(published.snapshot.stocks[0].scanRunId, "watchlist-run-1");
  assert.ok(typeof published.snapshot.market.sectors.all[0].rotationScore === "number");
  assert.ok(Object.prototype.hasOwnProperty.call(published.snapshot.market.sectors.all[0], "prevRank"));
  assert.ok(Object.prototype.hasOwnProperty.call(published.snapshot.market.sectors.all[0], "rankDelta"));
});
