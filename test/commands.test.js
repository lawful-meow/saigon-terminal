const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCommand, formatAction } = require("../commands");

test("parseCommand supports vNext focus and research verbs", () => {
  const focus = parseCommand("focus FPT");
  assert.equal(focus.ok, true);
  assert.equal(focus.action.type, "focus.ticker");
  assert.equal(focus.action.ticker, "FPT");

  const research = parseCommand("research FPT 30d");
  assert.equal(research.ok, true);
  assert.equal(research.action.type, "research.open");
  assert.equal(research.action.window, "30d");

  const plan = parseCommand("plan FPT");
  assert.equal(plan.action.type, "playbook.open");

  const journal = parseCommand("journal today");
  assert.equal(journal.action.type, "journal.open");
});

test("parseCommand preserves legacy aliases and scan variants", () => {
  const alias = parseCommand("open fpt");
  assert.equal(alias.ok, true);
  assert.equal(alias.action.type, "focus.ticker");
  assert.equal(alias.action.ticker, "FPT");

  const vn30 = parseCommand("scan vn30", { topN: 7, delayMs: 300 });
  assert.equal(vn30.action.type, "scan.vn30");
  assert.equal(vn30.action.topN, 7);

  const single = parseCommand("scan FPT");
  assert.equal(single.action.type, "scan.one");
  assert.match(formatAction(single.action), /FPT/);
});
