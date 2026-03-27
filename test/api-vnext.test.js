const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-api-vnext-"));
process.env.SAIGON_STORE_PATH = path.join(tempRoot, "scans.json");
process.env.SAIGON_WATCHLIST_PATH = path.join(tempRoot, "watchlist.json");
process.env.SAIGON_DOCS_DIR = path.join(tempRoot, "docs");
process.env.SAIGON_WORKSPACE_PATH = path.join(tempRoot, "workspace.json");
process.env.SAIGON_PLAYBOOKS_PATH = path.join(tempRoot, "playbooks.json");
process.env.SAIGON_TASKS_PATH = path.join(tempRoot, "tasks.json");
process.env.SAIGON_TASK_LOG_PATH = path.join(tempRoot, "task-log.jsonl");
process.env.SAIGON_RESEARCH_PATH = path.join(tempRoot, "research.jsonl");
process.env.SAIGON_JOURNAL_PATH = path.join(tempRoot, "journal.jsonl");

const { buildScanSnapshot } = require("../engine");
const { createServer } = require("../server");
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
    market: overrides.market || {
      session: "closed",
      regime: "bearish",
      pulse: {
        status: "correction",
        exposure: "0-20%",
        distributionDays: 6,
        note: "Distribution pressure is elevated.",
      },
      indexes: {
        VNINDEX: {
          price: 1000,
          sessionChangePct: -1,
          prevCloseChangePct: -1,
          changePct: -1,
          ret1m: -0.08,
          ret3m: -0.15,
          regime: "bearish",
          pulse: { status: "correction", score: 0.25 },
        },
      },
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
    strength: overrides.strength || {
      score: 72,
      label: "strong",
      rank: 1,
      percentile: 92,
    },
    breakout: overrides.breakout || {
      state: "near_trigger",
      score: 76,
      triggerPrice: 120,
      distancePct: -1,
      invalidation: 112,
      volumeSupport: "building",
      reason: "Trigger sits just above current price.",
    },
    executionRisk: overrides.executionRisk || {
      status: "ready",
      liquidityLabel: "tradeable",
      avgValue20: overrides.avgValue20 ?? overrides.tradedValue ?? 100,
      tradedValue: overrides.tradedValue ?? 100,
      stopDistancePct: 5,
      stopDistanceAtr: 1.4,
      riskReward1: 2.5,
      riskReward2: 4.2,
      pilotShares: 100,
      fullShares: 200,
      pilotNotional: 10000000,
      fullNotional: 20000000,
      reason: "Liquidity clears the floor.",
    },
    quality: overrides.quality || {
      label: "high",
      score: 84,
      warnings: [],
      sourceFlags: {
        price: "vps_snapshot_overlay",
        fundamentals: "kbs",
        ownership: "kbs",
        foreign: "unavailable",
      },
    },
    signal: overrides.signal || "BUY",
    confidence: overrides.confidence ?? 8,
    scanRunId: overrides.scanRunId ?? "watchlist-run",
    wyckoff: overrides.wyckoff || {
      entry: {
        summary: "Pilot entry is valid.",
        plans: [{ label: "Pilot", price: 120, stop: 112, why: "Breakout reclaim" }],
      },
    },
  };
}

test("workspace, research, playbook, journal, and legacy publish routes remain usable", async () => {
  const snapshot = buildScanSnapshot([
    makeStock({ ticker: "AAA", name: "Alpha", sector: "TECH" }),
    makeStock({ ticker: "BBB", name: "Beta", sector: "BANK", changePct: -2, signal: "HOLD", confidence: 5 }),
  ], {
    scanMode: "watchlist",
  });

  scanService.persistLatestSnapshot(snapshot, {
    selectedTicker: "AAA",
    source: "test",
    mode: "watchlist",
  });

  const server = createServer(0);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const workspace = await fetch(`http://127.0.0.1:${port}/api/workspace?view=overview&ticker=AAA`).then((res) => res.json());
    assert.equal(workspace.focusTicker, "AAA");
    assert.equal(workspace.boardRows.length, 2);

    const noteResponse = await fetch(`http://127.0.0.1:${port}/api/research/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "AAA", title: "Desk note", note: "Watching AAA." }),
    });
    assert.equal(noteResponse.status, 200);

    const research = await fetch(`http://127.0.0.1:${port}/api/research?ticker=AAA&window=7d`).then((res) => res.json());
    assert.ok(research.count >= 1);
    assert.ok(research.evidence.some((item) => item.kind === "operator_note"));

    const playbookSave = await fetch(`http://127.0.0.1:${port}/api/playbooks/AAA`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "armed", thesis: "AAA is actionable." }),
    }).then((res) => res.json());
    assert.equal(playbookSave.state, "armed");

    const playbook = await fetch(`http://127.0.0.1:${port}/api/playbooks/AAA`).then((res) => res.json());
    assert.match(playbook.thesis, /AAA is actionable/);

    const journalSave = await fetch(`http://127.0.0.1:${port}/api/journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-03-27",
        ticker: "AAA",
        title: "Opening review",
        body: "The desk stays defensive.",
      }),
    });
    assert.equal(journalSave.status, 200);

    const journal = await fetch(`http://127.0.0.1:${port}/api/journal?date=2026-03-27`).then((res) => res.json());
    assert.equal(journal.entries.length, 1);

    const publish = await fetch(`http://127.0.0.1:${port}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, selectedTicker: "AAA" }),
    }).then((res) => res.json());
    assert.equal(publish.status, "ok");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("workspace home view is empty on cold start when no successful snapshot exists", async () => {
  fs.rmSync(process.env.SAIGON_WORKSPACE_PATH, { force: true });
  fs.rmSync(path.join(process.env.SAIGON_DOCS_DIR, "snapshot.json"), { force: true });

  const server = createServer(0);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const workspace = await fetch(`http://127.0.0.1:${port}/api/workspace?view=home`).then((res) => res.json());
    assert.equal(workspace.view, "home");
    assert.equal(workspace.focusTicker, null);
    assert.deepEqual(workspace.boardRows, []);
    assert.equal(workspace.snapshotMeta.count, 0);
    assert.equal(workspace.snapshotMeta.source, "empty");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("workspace home view defaults focus to the top ranked ticker instead of the persisted selection", async () => {
  const snapshot = buildScanSnapshot([
    makeStock({
      ticker: "AAA",
      name: "Alpha",
      sector: "TECH",
      signal: "STRONG_BUY",
      confidence: 9,
      changePct: 2.4,
      strength: {
        score: 88,
        label: "leader",
        rank: 1,
        percentile: 98,
      },
    }),
    makeStock({
      ticker: "BBB",
      name: "Beta",
      sector: "BANK",
      signal: "HOLD",
      confidence: 4,
      changePct: -0.6,
      strength: {
        score: 54,
        label: "mixed",
        rank: 2,
        percentile: 42,
      },
    }),
  ], {
    scanMode: "vn30",
  });

  const topTicker = snapshot.stocks[0]?.ticker;
  const persistedSelection = snapshot.stocks.find((stock) => stock.ticker !== topTicker)?.ticker;

  scanService.persistLatestSnapshot(snapshot, {
    selectedTicker: persistedSelection,
    source: "test",
    mode: "vn30",
  });

  const server = createServer(0);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const workspace = await fetch(`http://127.0.0.1:${port}/api/workspace?view=home`).then((res) => res.json());
    assert.equal(workspace.view, "home");
    assert.equal(workspace.focusTicker, topTicker);
    assert.equal(workspace.focusTicker, workspace.boardRows[0]?.ticker);
    assert.notEqual(workspace.focusTicker, persistedSelection);
    assert.equal(workspace.snapshotMeta.selectedTicker, topTicker);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("workspace exposes stale state and source health after a failed refresh keeps the last good snapshot", async () => {
  const goodSnapshot = buildScanSnapshot([
    makeStock({ ticker: "AAA", name: "Alpha", sector: "TECH" }),
  ], {
    scanMode: "watchlist",
    requestedCount: 1,
    scannedCount: 1,
    errorCount: 0,
  });

  scanService.persistLatestSnapshot(goodSnapshot, {
    selectedTicker: "AAA",
    source: "test",
    mode: "watchlist",
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

  const server = createServer(0);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const workspace = await fetch(`http://127.0.0.1:${port}/api/workspace?view=home`).then((res) => res.json());
    assert.equal(workspace.view, "home");
    assert.equal(workspace.stale, true);
    assert.equal(workspace.boardRows.length, 1);
    assert.equal(workspace.focusTicker, workspace.boardRows[0]?.ticker);
    assert.ok(workspace.warnings.some((warning) => /AAA: VPS history down/.test(warning)));
    assert.equal(workspace.sourceHealth.find((item) => item.id === "vps_history")?.status, "down");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
