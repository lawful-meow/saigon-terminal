const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-research-test-"));
process.env.SAIGON_RESEARCH_PATH = path.join(tempRoot, "research.jsonl");

const researchService = require("../services/research-service");

function makeSnapshot() {
  return {
    generated: "2026-03-27T03:00:00.000Z",
    market: {
      regime: "bearish",
      pulse: {
        status: "correction",
        exposure: "0-20%",
        distributionDays: 6,
        note: "Distribution pressure is elevated.",
      },
      breadth: {
        advancers: 3,
        decliners: 22,
        unchanged: 0,
      },
      sectors: {
        all: [
          { sector: "TECH", rank: 1, rotationScore: 82, avgChangePct: 1.2, avgRsVsVNINDEX3m: 0.15, rankDelta: 1 },
        ],
      },
    },
    alerts: {
      items: [
        {
          id: "alert-1",
          title: "FPT is near trigger",
          summary: "Entry trigger is close and liquidity remains healthy.",
          ticker: "FPT",
          level: "high",
        },
      ],
    },
    stocks: [
      {
        ticker: "FPT",
        name: "FPT Corp",
        sector: "TECH",
        scanTime: "2026-03-27T03:00:00.000Z",
        price: 120000,
        signal: "BUY",
        confidence: 8,
        breakout: { state: "near_trigger", reason: "Trigger sits just above current price." },
        executionRisk: { liquidityLabel: "tradeable", reason: "Liquidity clears the floor." },
        quality: { warnings: ["Fundamentals unavailable"] },
        delta: "signal HOLD→BUY",
      },
    ],
  };
}

test("research service stores operator notes and builds a merged evidence timeline", () => {
  const snapshot = makeSnapshot();
  researchService.appendOperatorNote({
    ticker: "FPT",
    title: "Desk note",
    note: "Watching for a high-volume breakout through resistance.",
  });

  const evidence = researchService.listEvidence({
    ticker: "FPT",
    window: "7d",
    snapshot,
  });

  assert.ok(evidence.count >= 3);
  assert.equal(evidence.evidence[0].tickerTags.includes("FPT"), true);
  assert.ok(evidence.evidence.some((item) => item.kind === "operator_note"));

  const briefing = researchService.saveBriefing("FPT", snapshot, evidence.evidence);
  assert.equal(briefing.kind, "briefing");

  const next = researchService.listEvidence({
    ticker: "FPT",
    window: "7d",
    snapshot,
  });
  assert.equal(next.latestBriefing.kind, "briefing");
});

test("computeNovelty penalizes similar evidence", () => {
  const novelty = researchService.computeNovelty({
    source: "operator_note",
    title: "FPT breakout note",
    note: "Watching a breakout note with volume",
    tickerTags: ["FPT"],
  }, [
    {
      source: "operator_note",
      title: "FPT breakout note",
      note: "Watching a breakout note with volume",
      tickerTags: ["FPT"],
    },
  ]);

  assert.ok(novelty < 50);
});
