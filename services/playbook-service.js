const config = require("../config");
const watchlist = require("../watchlist");
const { readJson, writeJson, resolveProjectPath } = require("./file-store");

const VALID_STATES = ["draft", "armed", "active", "invalidated", "archived"];
const ALLOWED_TRANSITIONS = {
  draft: ["draft", "armed", "active", "archived"],
  armed: ["draft", "armed", "active", "invalidated", "archived"],
  active: ["active", "invalidated", "archived"],
  invalidated: ["invalidated", "armed", "archived"],
  archived: ["archived"],
};

function playbooksPath() {
  return resolveProjectPath(process.env.SAIGON_PLAYBOOKS_PATH || config.store.playbooksPath || "./data/playbooks.json");
}

function normalizeTicker(value) {
  return watchlist.normalizeTicker(value);
}

function loadAll() {
  return readJson(playbooksPath(), {});
}

function saveAll(data) {
  return writeJson(playbooksPath(), data);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizePriceLevels(values) {
  return asArray(values)
    .map((entry) => ({
      label: asString(entry?.label || ""),
      price: Number(entry?.price),
      sizePct: Number(entry?.sizePct ?? 0),
      note: asString(entry?.note || ""),
    }))
    .filter((entry) => entry.label || Number.isFinite(entry.price));
}

function deriveRegimeBias(snapshot, stock) {
  const marketStatus = String(snapshot?.market?.pulse?.status || snapshot?.market?.regime || "").toLowerCase();
  const signal = String(stock?.signal || "").toUpperCase();

  if (marketStatus.includes("correction") || marketStatus.includes("bearish")) return "defensive";
  if (signal === "BUY" || signal === "STRONG_BUY") return "offensive";
  return "balanced";
}

function deriveState(playbook) {
  if (playbook.state === "archived" || playbook.archivedAt) return "archived";
  if (playbook.state === "invalidated" || playbook.invalidation?.triggered || playbook.invalidatedAt) return "invalidated";
  if (playbook.state === "active") return "active";
  if (playbook.state === "armed") return "armed";
  if (playbook.thesis || playbook.evidenceIds?.length || playbook.entryPlan?.ladder?.length) return "armed";
  return "draft";
}

function transitionPlaybookState(currentState = "draft", nextState = "draft") {
  if (!VALID_STATES.includes(nextState)) throw new Error(`Invalid playbook state: ${nextState}`);
  const allowed = ALLOWED_TRANSITIONS[currentState] || ["draft"];
  if (!allowed.includes(nextState)) {
    throw new Error(`Playbook transition ${currentState} -> ${nextState} is not allowed`);
  }
  return nextState;
}

function stockDefaults(stock) {
  const primaryPlans = asArray(stock?.wyckoff?.entry?.plans);
  const ladder = primaryPlans.map((plan, index) => ({
    label: plan.label || `Entry ${index + 1}`,
    price: Number(plan.price),
    sizePct: index === 0 ? 50 : 25,
    note: asString(plan.why || ""),
  })).filter((entry) => Number.isFinite(entry.price));

  return {
    entryPlan: {
      ladder,
      trigger: Number(primaryPlans[0]?.price) || null,
      note: asString(stock?.wyckoff?.entry?.summary || ""),
    },
    stopPlan: {
      price: Number(primaryPlans[0]?.stop) || Number(stock?.sl) || null,
      note: asString(stock?.executionRisk?.reason || ""),
    },
    targetPlan: {
      targets: asArray(stock?.tp).map((price, index) => ({
        label: `Target ${index + 1}`,
        price: Number(price),
      })).filter((target) => Number.isFinite(target.price)),
      note: asString(stock?.breakout?.reason || ""),
    },
    invalidation: {
      price: Number(primaryPlans[0]?.stop) || Number(stock?.sl) || null,
      note: asString(stock?.wyckoff?.entry?.invalidation || stock?.quality?.warnings?.[0] || ""),
      triggered: false,
    },
  };
}

function createDefaultPlaybook(ticker, snapshot, evidenceIds = []) {
  const normalized = normalizeTicker(ticker);
  const stock = snapshot?.stocks?.find((item) => item.ticker === normalized) || null;
  const defaults = stockDefaults(stock);
  const now = new Date().toISOString();

  return {
    ticker: normalized,
    state: "draft",
    regimeBias: deriveRegimeBias(snapshot, stock),
    thesis: "",
    evidenceIds: asArray(evidenceIds),
    entryPlan: defaults.entryPlan,
    stopPlan: defaults.stopPlan,
    targetPlan: defaults.targetPlan,
    invalidation: defaults.invalidation,
    riskTags: uniq([
      snapshot?.market?.pulse?.status || null,
      stock?.executionRisk?.liquidityLabel || null,
    ]),
    nextAction: {
      label: stock?.signal === "BUY" || stock?.signal === "STRONG_BUY" ? "Review entry ladder" : "Wait for confirmation",
      note: asString(stock?.delta || stock?.breakout?.reason || ""),
      dueAt: now,
    },
    nextReviewAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizePlaybook(input, snapshot) {
  const now = new Date().toISOString();
  const base = createDefaultPlaybook(input.ticker, snapshot, input.evidenceIds);
  const next = {
    ...base,
    ...input,
    ticker: normalizeTicker(input.ticker || base.ticker),
    regimeBias: asString(input.regimeBias || base.regimeBias || "balanced"),
    thesis: asString(input.thesis || base.thesis),
    evidenceIds: uniq(asArray(input.evidenceIds ?? base.evidenceIds).map(String)),
    entryPlan: {
      ladder: normalizePriceLevels(input.entryPlan?.ladder ?? base.entryPlan.ladder),
      trigger: Number(input.entryPlan?.trigger ?? base.entryPlan.trigger) || null,
      note: asString(input.entryPlan?.note ?? base.entryPlan.note),
    },
    stopPlan: {
      price: Number(input.stopPlan?.price ?? base.stopPlan.price) || null,
      note: asString(input.stopPlan?.note ?? base.stopPlan.note),
    },
    targetPlan: {
      targets: asArray(input.targetPlan?.targets ?? base.targetPlan.targets)
        .map((target, index) => ({
          label: asString(target?.label || `Target ${index + 1}`),
          price: Number(target?.price),
        }))
        .filter((target) => Number.isFinite(target.price)),
      note: asString(input.targetPlan?.note ?? base.targetPlan.note),
    },
    invalidation: {
      price: Number(input.invalidation?.price ?? base.invalidation.price) || null,
      note: asString(input.invalidation?.note ?? base.invalidation.note),
      triggered: Boolean(input.invalidation?.triggered ?? base.invalidation.triggered),
    },
    riskTags: uniq(asArray(input.riskTags ?? base.riskTags).map((value) => asString(value).toLowerCase())),
    nextAction: {
      label: asString(input.nextAction?.label ?? base.nextAction.label),
      note: asString(input.nextAction?.note ?? base.nextAction.note),
      dueAt: input.nextAction?.dueAt ? new Date(input.nextAction.dueAt).toISOString() : base.nextAction.dueAt,
    },
    nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt).toISOString() : base.nextReviewAt,
    createdAt: input.createdAt || base.createdAt || now,
    updatedAt: now,
  };

  next.state = VALID_STATES.includes(input.state) ? input.state : deriveState(next);
  if (next.invalidation.triggered) next.state = "invalidated";
  return next;
}

function getPlaybook(ticker, options = {}) {
  const normalized = normalizeTicker(ticker);
  const all = loadAll();
  const existing = all[normalized];
  if (existing) return normalizePlaybook(existing, options.snapshot);
  return createDefaultPlaybook(normalized, options.snapshot, options.evidenceIds || []);
}

function savePlaybook(ticker, patch = {}, options = {}) {
  const normalized = normalizeTicker(ticker);
  const all = loadAll();
  const current = getPlaybook(normalized, options);
  const requestedState = patch.state || current.state;

  transitionPlaybookState(current.state, requestedState);

  const next = normalizePlaybook({
    ...current,
    ...patch,
    ticker: normalized,
    state: requestedState,
  }, options.snapshot);

  next.state = transitionPlaybookState(current.state, next.state);
  if (next.state === "invalidated") next.invalidatedAt = next.invalidatedAt || new Date().toISOString();
  if (next.state === "archived") next.archivedAt = next.archivedAt || new Date().toISOString();

  all[normalized] = next;
  saveAll(all);
  return next;
}

function listPinned(limit = 8) {
  return Object.values(loadAll())
    .map((item) => normalizePlaybook(item))
    .filter((item) => item.state !== "archived")
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
}

module.exports = {
  VALID_STATES,
  transitionPlaybookState,
  deriveState,
  createDefaultPlaybook,
  getPlaybook,
  savePlaybook,
  listPinned,
};
