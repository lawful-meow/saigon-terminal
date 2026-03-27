const STATUS_RANK = {
  down: 3,
  degraded: 2,
  ok: 1,
};

function normalizeStatus(value) {
  if (value === "down" || value === "degraded" || value === "ok") return value;
  if (value === "failed") return "down";
  if (value === "disabled") return "degraded";
  if (value === "ready") return "ok";
  return "degraded";
}

function createSourceHealthRow(row = {}) {
  return {
    id: row.id || "unknown_source",
    name: row.name || row.label || row.id || "Unknown source",
    critical: row.critical !== false,
    status: normalizeStatus(row.status),
    message: row.message || row.detail || null,
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

function mergeSourceHealth(...groups) {
  const merged = new Map();

  for (const group of groups) {
    for (const raw of group || []) {
      const row = createSourceHealthRow(raw);
      const existing = merged.get(row.id);

      if (!existing) {
        merged.set(row.id, row);
        continue;
      }

      const shouldReplace = STATUS_RANK[row.status] > STATUS_RANK[existing.status];
      merged.set(row.id, {
        ...existing,
        ...(shouldReplace ? row : {}),
        name: existing.name || row.name,
        critical: existing.critical || row.critical,
        message: shouldReplace
          ? row.message || existing.message
          : existing.message || row.message,
        updatedAt: row.updatedAt || existing.updatedAt,
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    const severity = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (severity !== 0) return severity;
    if (a.critical !== b.critical) return Number(b.critical) - Number(a.critical);
    return a.name.localeCompare(b.name);
  });
}

module.exports = {
  createSourceHealthRow,
  mergeSourceHealth,
  normalizeStatus,
};
