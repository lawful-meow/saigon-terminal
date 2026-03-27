// ─── resolver.js ───────────────────────────────────────────────────────────────
// Canonical source resolver.
// The terminal keeps one internal record per field with provenance rather than
// pretending one external provider owns every data domain.
// ────────────────────────────────────────────────────────────────────────────────

const config = require("./config");

const PRECEDENCE = {
  price: ["vps", "kbs", "fireant", "ssi", "vietstock", "fiingroup"],
  market: ["vps", "kbs", "fireant", "ssi"],
  fundamentals: ["kbs", "fireant", "vietstock", "fiingroup", "vps"],
  ownership: ["kbs", "fireant", "vietstock", "fiingroup", "vps"],
  foreign: ["fireant", "vietstock", "fiingroup", "vps"],
  execution: ["ssi", "vps"],
};

function normalizeCandidate(candidate = {}) {
  return {
    provider: candidate.provider || "unknown",
    value: candidate.value == null ? null : candidate.value,
    asOf: candidate.asOf || null,
    freshnessSec: Number.isFinite(candidate.freshnessSec) ? candidate.freshnessSec : null,
    status: candidate.status || (candidate.value == null ? "unavailable" : "ok"),
    note: candidate.note || null,
  };
}

function resolveField(domain, candidates = []) {
  const precedence = PRECEDENCE[domain] || [];
  const normalized = candidates.map(normalizeCandidate);
  const ranked = normalized
    .filter((candidate) => candidate.value != null && candidate.status === "ok")
    .sort((a, b) => {
      const ai = precedence.indexOf(a.provider);
      const bi = precedence.indexOf(b.provider);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  const chosen = ranked[0] || normalized[0] || { provider: "unknown", value: null, status: "unavailable" };
  const conflicts = ranked.length > 1
    ? ranked
        .filter((candidate) => candidate.provider !== chosen.provider && candidate.value !== chosen.value)
        .map((candidate) => ({
          provider: candidate.provider,
          value: candidate.value,
          asOf: candidate.asOf,
        }))
    : [];

  return {
    value: chosen.value ?? null,
    source: chosen.provider,
    asOf: chosen.asOf || null,
    freshnessSec: chosen.freshnessSec ?? null,
    status: chosen.status,
    note: chosen.note || null,
    conflicts,
    candidates: normalized,
  };
}

function buildSourceFlags(meta = {}) {
  return {
    price: meta.snapshotOverlayUsed ? "vps_snapshot_overlay" : "vps_history_only",
    market: meta.marketSource || "vps_history",
    fundamentals: meta.fundamentalsSource || "unavailable",
    ownership: meta.ownershipSource || meta.fundamentalsSource || "unavailable",
    foreign: meta.foreignSource || "unavailable",
    priceTransport: meta.priceTransport || "fetch",
    snapshotTransport: meta.snapshotTransport || null,
    marketTransport: meta.marketTransport || null,
    providerRoadmap: config.sources.roadmap,
  };
}

module.exports = { resolveField, buildSourceFlags, PRECEDENCE };
