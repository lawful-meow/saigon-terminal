const scanService = require("./scan-service");
const playbookService = require("./playbook-service");
const researchService = require("./research-service");
const journalService = require("./journal-service");
const taskService = require("./task-service");
const freeSources = require("../adapters/free-sources");
const { mergeSourceHealth } = require("./source-health");

const VIEWS = ["home", "overview", "board", "research", "playbook", "journal", "publish"];

function normalizeView(value) {
  const raw = String(value || "home").trim().toLowerCase();
  return VIEWS.includes(raw) ? raw : "home";
}

function resolveFocusTicker(snapshot, ticker, selectedTicker) {
  const wanted = String(ticker || selectedTicker || snapshot?.stocks?.[0]?.ticker || "").trim().toUpperCase();
  const stock = snapshot?.stocks?.find((item) => item.ticker === wanted) || snapshot?.stocks?.[0] || null;
  return stock?.ticker || null;
}

function uniqStrings(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function buildSourceHealth(snapshot, diagnostics = null) {
  return mergeSourceHealth(
    diagnostics?.sourceHealth || [],
    scanService.aggregateSourceHealth(snapshot),
    freeSources.sourceHealth()
  );
}

function buildWarnings(diagnostics = null) {
  if (!diagnostics) return [];

  return uniqStrings([
    ...(diagnostics.warnings || []),
    ...(diagnostics.errors || []).map((entry) =>
      entry?.ticker ? `${entry.ticker}: ${entry.error}` : entry?.error || null
    ),
  ]);
}

function buildNextActions(playbooks = [], alerts = []) {
  const fromPlaybooks = playbooks.map((playbook) => ({
    ticker: playbook.ticker,
    title: playbook.nextAction?.label || "Review playbook",
    note: playbook.nextAction?.note || "",
    dueAt: playbook.nextAction?.dueAt || playbook.nextReviewAt || null,
    source: "playbook",
  }));

  const fromAlerts = alerts.slice(0, 3).map((alert) => ({
    ticker: alert.ticker || null,
    title: alert.title,
    note: alert.summary || "",
    dueAt: null,
    source: "alert",
  }));

  return [...fromPlaybooks, ...fromAlerts].slice(0, 8);
}

function buildWorkspaceSnapshotFromSnapshot(snapshot, options = {}) {
  const view = normalizeView(options.view);
  const focusTicker = resolveFocusTicker(snapshot, options.ticker, options.selectedTicker);
  const research = focusTicker
    ? researchService.listEvidence({
      ticker: focusTicker,
      window: options.window,
      snapshot,
    })
    : { ticker: null, window: "7d", count: 0, evidence: [], latestBriefing: null, sourceHealth: freeSources.sourceHealth() };
  const playbook = focusTicker
    ? playbookService.getPlaybook(focusTicker, {
      snapshot,
      evidenceIds: research.evidence.slice(0, 6).map((item) => item.id),
    })
    : null;
  const pinnedItems = playbookService.listPinned();
  const alerts = snapshot?.alerts?.items || [];

  return {
    generatedAt: new Date().toISOString(),
    view,
    views: VIEWS,
    focusTicker,
    focusStock: snapshot?.stocks?.find((stock) => stock.ticker === focusTicker) || null,
    market: snapshot?.market || null,
    boardRows: snapshot?.stocks || [],
    alerts,
    smartLists: snapshot?.smartLists || null,
    warnings: uniqStrings(options.warnings || []),
    stale: !!options.stale,
    sourceHealth: buildSourceHealth(snapshot, options.diagnostics || null),
    activeTasks: taskService.listRecentTasks(),
    pinnedItems,
    activeRisks: alerts.slice(0, 6),
    nextActions: buildNextActions(pinnedItems, alerts),
    recentNotes: researchService.listRecentNotes(),
    research: {
      ...research,
      sourceHealth: mergeSourceHealth(research.sourceHealth || [], freeSources.sourceHealth()),
    },
    playbook,
    journal: {
      date: journalService.normalizeDate(options.date || "today"),
      entries: journalService.getEntries(options.date || "today"),
    },
    lastSuccessfulScanAt: options.lastSuccessfulScanAt || snapshot?.generated || null,
    lastAttemptedScanAt: options.lastAttemptedScanAt || options.lastSuccessfulScanAt || snapshot?.generated || null,
    snapshotMeta: {
      generated: snapshot?.generated || null,
      scanMode: snapshot?.scanMode || null,
      selectedTicker: options.selectedTicker || focusTicker,
      count: snapshot?.count || 0,
      savedAt: options.savedAt || null,
      source: options.source || "workspace",
    },
  };
}

function emptyWorkspace(options = {}, record = null) {
  const diagnostics = record?.lastAttemptDiagnostics || null;
  return {
    generatedAt: new Date().toISOString(),
    view: normalizeView(options.view),
    views: VIEWS,
    focusTicker: null,
    focusStock: null,
    market: null,
    boardRows: [],
    alerts: [],
    smartLists: null,
    warnings: buildWarnings(diagnostics),
    stale: !!diagnostics,
    sourceHealth: buildSourceHealth(null, diagnostics),
    activeTasks: taskService.listRecentTasks(),
    pinnedItems: playbookService.listPinned(),
    activeRisks: [],
    nextActions: [],
    recentNotes: researchService.listRecentNotes(),
    research: {
      ticker: null,
      window: options.window || "7d",
      count: 0,
      evidence: [],
      latestBriefing: null,
      sourceHealth: freeSources.sourceHealth(),
    },
    playbook: null,
    journal: {
      date: journalService.normalizeDate(options.date || "today"),
      entries: journalService.getEntries(options.date || "today"),
    },
    lastSuccessfulScanAt: record?.lastSuccessfulScanAt || null,
    lastAttemptedScanAt: record?.lastAttemptedScanAt || diagnostics?.attemptedAt || null,
    snapshotMeta: {
      generated: null,
      scanMode: record?.mode || null,
      selectedTicker: record?.selectedTicker || null,
      count: 0,
      savedAt: record?.savedAt || null,
      source: record?.source || "empty",
    },
  };
}

function getWorkspace(options = {}) {
  const record = options.record || scanService.getLatestSnapshotRecord();
  const snapshot = options.snapshot || record?.snapshot || null;
  const diagnostics = record?.lastAttemptDiagnostics || null;
  const view = normalizeView(options.view);
  const selectedTicker = options.selectedTicker || (view === "home" ? null : record?.selectedTicker);

  if (!snapshot) return emptyWorkspace(options, record);

  return buildWorkspaceSnapshotFromSnapshot(snapshot, {
    ...options,
    view,
    selectedTicker,
    savedAt: options.savedAt || record?.savedAt,
    source: options.source || record?.source,
    diagnostics,
    warnings: buildWarnings(diagnostics),
    stale: !!diagnostics && (!diagnostics.succeeded || diagnostics.stale),
    lastSuccessfulScanAt: record?.lastSuccessfulScanAt || record?.savedAt || snapshot.generated,
    lastAttemptedScanAt: record?.lastAttemptedScanAt || diagnostics?.attemptedAt || record?.savedAt || snapshot.generated,
  });
}

module.exports = {
  VIEWS,
  normalizeView,
  buildWorkspaceSnapshotFromSnapshot,
  getWorkspace,
};
