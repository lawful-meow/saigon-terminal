const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-terminal-test-"));
process.env.SAIGON_STORE_PATH = path.join(tempRoot, "scans.json");
process.env.SAIGON_WATCHLIST_PATH = path.join(tempRoot, "watchlist.json");

const store = require("../store");
const { createServer } = require("../server");
const { buildScanSnapshot } = require("../engine");

function makeStock(overrides = {}) {
  return {
    ticker: overrides.ticker || "AAA",
    name: overrides.name || overrides.ticker || "AAA",
    sector: overrides.sector || "TECH",
    tradedValue: overrides.tradedValue ?? 100,
    changePct: overrides.changePct ?? 0,
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
          changePct: -1,
          ret1m: -0.1,
          ret3m: -0.2,
          regime: "bearish",
          pulse: { status: "correction", score: 0.25 },
        },
      },
    },
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
