const fs = require("fs");
const path = require("path");

function resolveProjectPath(target) {
  return path.resolve(__dirname, "..", target);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback = null) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[file-store] Failed to read JSON ${path.basename(filePath)}: ${error.message}`);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  return value;
}

function readJsonl(filePath) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return [];

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error(`[file-store] Failed to parse JSONL ${path.basename(filePath)}: ${error.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonl(filePath, entry) {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

function clearFile(filePath, emptyValue = null) {
  ensureParentDir(filePath);
  if (emptyValue == null) {
    fs.writeFileSync(filePath, "", "utf8");
    return null;
  }
  return writeJson(filePath, emptyValue);
}

module.exports = {
  resolveProjectPath,
  ensureParentDir,
  readJson,
  writeJson,
  readJsonl,
  appendJsonl,
  clearFile,
};
