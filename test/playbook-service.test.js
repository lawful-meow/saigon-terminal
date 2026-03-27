const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "saigon-playbook-test-"));
process.env.SAIGON_PLAYBOOKS_PATH = path.join(tempRoot, "playbooks.json");

const playbookService = require("../services/playbook-service");

function makeSnapshot() {
  return {
    market: {
      regime: "constructive",
      pulse: {
        status: "confirmed_uptrend",
      },
    },
    stocks: [
      {
        ticker: "FPT",
        signal: "BUY",
        breakout: { state: "triggered" },
        executionRisk: { liquidityLabel: "tradeable", reason: "Liquidity clears the floor." },
        sl: 112000,
        tp: [128000, 134000],
        wyckoff: {
          entry: {
            summary: "Pilot entry is valid.",
            plans: [
              { label: "Pilot", price: 120000, stop: 112000, why: "Breakout reclaim" },
            ],
          },
        },
      },
    ],
  };
}

test("playbook service saves explicit thesis and preserves transition rules", () => {
  const snapshot = makeSnapshot();
  const current = playbookService.getPlaybook("FPT", { snapshot });
  assert.equal(current.state, "draft");

  const saved = playbookService.savePlaybook("FPT", {
    state: "armed",
    thesis: "Reclaim with healthy liquidity and improving market tone.",
    riskTags: ["breakout", "tech"],
    nextAction: {
      label: "Watch the open",
      note: "Only size up if price holds above trigger.",
      dueAt: "2026-03-27T09:30:00.000Z",
    },
  }, { snapshot });

  assert.equal(saved.state, "armed");
  assert.match(saved.thesis, /healthy liquidity/);

  const invalidated = playbookService.savePlaybook("FPT", {
    state: "invalidated",
    invalidation: {
      price: 112000,
      note: "Failed back under reclaim.",
      triggered: true,
    },
  }, { snapshot });

  assert.equal(invalidated.state, "invalidated");
  assert.ok(invalidated.invalidatedAt);
});

test("transitionPlaybookState rejects impossible archived rollback", () => {
  assert.throws(() => playbookService.transitionPlaybookState("archived", "draft"));
});
