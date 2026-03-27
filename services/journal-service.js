const crypto = require("crypto");
const config = require("../config");
const watchlist = require("../watchlist");
const { appendJsonl, readJsonl, resolveProjectPath } = require("./file-store");

function journalPath() {
  return resolveProjectPath(process.env.SAIGON_JOURNAL_PATH || config.store.journalPath || "./data/journal.jsonl");
}

function normalizeTicker(value) {
  return watchlist.normalizeTicker(value);
}

function normalizeDate(value) {
  if (!value || value === "today") return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function loadEntries() {
  return readJsonl(journalPath())
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function addEntry(payload = {}) {
  const createdAt = new Date().toISOString();
  const title = String(payload.title || payload.body || "Journal entry").trim();
  const entry = {
    id: payload.id || `journal:${crypto.randomUUID()}`,
    ticker: normalizeTicker(payload.ticker),
    category: String(payload.category || "desk").trim().toLowerCase(),
    title,
    body: String(payload.body || "").trim(),
    outcome: String(payload.outcome || "").trim(),
    tags: Array.from(new Set((payload.tags || []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))),
    date: normalizeDate(payload.date || createdAt),
    createdAt,
    updatedAt: createdAt,
  };

  appendJsonl(journalPath(), entry);
  return entry;
}

function getEntries(date = "today") {
  const normalized = normalizeDate(date);
  return loadEntries().filter((entry) => entry.date === normalized);
}

module.exports = {
  normalizeDate,
  addEntry,
  getEntries,
  loadEntries,
};
