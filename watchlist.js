// ─── watchlist.js ─────────────────────────────────────────────────────────────
// Editable watchlist persistence.
// Falls back to config defaults until a custom watchlist is saved.
// ───────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const config = require("./config");

const WATCHLIST_PATH = path.resolve(__dirname, config.store.watchlistPath || "./data/watchlist.json");

function ensureDir() {
  const dir = path.dirname(WATCHLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeStock(stock = {}) {
  const ticker = normalizeTicker(stock.ticker);
  if (!ticker || ticker.length < 2 || ticker.length > 12) {
    throw new Error("Ticker must be 2-12 alphanumeric characters");
  }

  return {
    ticker,
    name: String(stock.name || ticker).trim() || ticker,
    sector: String(stock.sector || "USER").trim().toUpperCase() || "USER",
  };
}

function dedupe(stocks) {
  const seen = new Set();
  return stocks.filter((stock) => {
    if (seen.has(stock.ticker)) return false;
    seen.add(stock.ticker);
    return true;
  });
}

function defaults() {
  return dedupe((config.stocks || []).map((stock) => normalizeStock(stock)));
}

function load() {
  ensureDir();
  if (!fs.existsSync(WATCHLIST_PATH)) return defaults();

  try {
    const data = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));
    if (!Array.isArray(data)) return defaults();
    const normalized = data.map((stock) => normalizeStock(stock));
    return dedupe(normalized);
  } catch (error) {
    console.error("[watchlist] corrupt file, falling back to defaults:", error.message);
    return defaults();
  }
}

function save(stocks) {
  ensureDir();
  const normalized = dedupe((stocks || []).map((stock) => normalizeStock(stock)));
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function getAll() {
  return load();
}

function getTicker(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  return load().find((stock) => stock.ticker === normalizedTicker) || null;
}

function add(stock) {
  const next = normalizeStock(stock);
  const list = load();
  if (list.some((item) => item.ticker === next.ticker)) {
    throw new Error(`Ticker ${next.ticker} already exists`);
  }
  list.push(next);
  return save(list);
}

function update(originalTicker, patch = {}) {
  const fromTicker = normalizeTicker(originalTicker);
  const list = load();
  const index = list.findIndex((stock) => stock.ticker === fromTicker);
  if (index === -1) throw new Error(`Ticker ${fromTicker} not found`);

  const next = normalizeStock({ ...list[index], ...patch });
  if (next.ticker !== fromTicker && list.some((stock) => stock.ticker === next.ticker)) {
    throw new Error(`Ticker ${next.ticker} already exists`);
  }

  list[index] = next;
  return save(list);
}

function remove(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  const list = load();
  const next = list.filter((stock) => stock.ticker !== normalizedTicker);
  if (next.length === list.length) throw new Error(`Ticker ${normalizedTicker} not found`);
  return save(next);
}

module.exports = {
  getAll,
  getTicker,
  add,
  update,
  remove,
  save,
  normalizeStock,
  normalizeTicker,
};
