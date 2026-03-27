// ─── providers/kbs.js ─────────────────────────────────────────────────────────
// Public KBS enrichment for fundamentals / ownership.
// This stays off the VPS hot path: data is cached and failures degrade cleanly
// back to VPS-only scoring instead of blocking the board.
// ───────────────────────────────────────────────────────────────────────────────

const config = require("../config");
const { requestJson } = require("../adapters/http-client");

const FINANCE_BASE = config.sources.kbsFinance;
const CACHE_TTL_MS = config.sources.kbsCacheTtlMs || 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = config.sources.kbsFailureTtlMs || 2 * 60 * 1000;
const TIMEOUT = config.sources.kbsTimeout || Math.min(config.sources.timeout || 15000, 6000);
const QUARANTINED_PROFILE_WARNING = "KBS profile endpoint is quarantined; ownership/profile enrichment is disabled";

const cache = new Map();

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesAny(value, needles) {
  const text = normalizeText(value);
  return needles.some((needle) => text.includes(normalizeText(needle)));
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function growth(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return +(current / base - 1).toFixed(4);
}

function sumWindow(series, start, size) {
  const slice = series.slice(start, start + size);
  if (slice.length < size) return null;
  const values = slice.map((item) => item?.value).filter(Number.isFinite);
  if (values.length < size) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

async function getJson(url, sourceId, sourceName) {
  const { data } = await requestJson(url, {
    timeoutMs: TIMEOUT,
    headers: { "User-Agent": "SaigonEngine/2.2" },
    source: {
      id: sourceId,
      name: sourceName,
      critical: false,
    },
  });
  return data;
}

function cacheHit(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  if (entry.error) throw new Error(entry.error);
  return entry.value;
}

function cachePut(key, value, ttlMs, error = null) {
  cache.set(key, {
    value,
    error,
    expiresAt: Date.now() + ttlMs,
  });
}

function findRow(rows, matchers) {
  for (const row of rows || []) {
    const haystacks = [row?.NameEn, row?.Name];
    const matched = matchers.some((needles) =>
      haystacks.some((text) => includesAny(text, Array.isArray(needles) ? needles : [needles]))
    );
    if (matched) return row;
  }
  return null;
}

function flattenRatioRows(payload) {
  return Object.values(payload?.Content || {}).flatMap((rows) => (Array.isArray(rows) ? rows : []));
}

function seriesFromPayload(payload, sectionName, matchers) {
  const rows = payload?.Content?.[sectionName] || [];
  const row = findRow(rows, matchers);
  if (!row) return [];

  return (payload?.Head || [])
    .map((head, index) => ({
      year: num(head?.YearPeriod),
      termCode: head?.TermCode || null,
      reportDate: head?.ReportDate || null,
      value: num(row[`Value${index + 1}`]),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => new Date(b.reportDate || 0) - new Date(a.reportDate || 0));
}

function sameTermPriorYear(series) {
  const latest = series[0];
  if (!latest) return null;
  return (
    series.find((item) => item.year === latest.year - 1 && item.termCode === latest.termCode) ||
    series[4] ||
    null
  );
}

function latestValue(rows, matchers) {
  const row = findRow(rows, matchers);
  return row ? firstFinite(num(row.Value1), num(row.Value)) : null;
}

function parseInstitutionOwnership(profile) {
  const ownership = profile?.Ownership || [];
  const organizational = ownership.find((row) =>
    includesAny(row?.NM, ["co dong to chuc", "cđ tổ chức", "cd to chuc", "to chuc"])
  );
  if (organizational) return num(organizational.OR);

  const namedInstitutions = ownership
    .filter((row) => !includesAny(row?.NM, ["ca nhan", "cá nhân", "noi bo", "nội bộ"]))
    .map((row) => num(row.OR))
    .filter(Number.isFinite);

  if (!namedInstitutions.length) return null;
  return namedInstitutions.reduce((sum, value) => sum + value, 0);
}

function parseOverview({ profile, ratiosAnnual, quarterPages }) {
  const ratioRows = flattenRatioRows(ratiosAnnual);

  function quarterSeriesWithFallback(primaryMatchers, fallbackMatchers = null) {
    const primary = quarterPages.flatMap((page) =>
      seriesFromPayload(page, "Kết quả kinh doanh", primaryMatchers)
    );
    if (primary.length || !fallbackMatchers) return primary;
    return quarterPages.flatMap((page) =>
      seriesFromPayload(page, "Kết quả kinh doanh", fallbackMatchers)
    );
  }

  const quarterlyRevenueSeries = quarterSeriesWithFallback(
    [["net revenue", "doanh thu thuan", "doanh thu thuần"]],
    [["revenue", "doanh thu"]]
  );
  const quarterlyProfitSeries = quarterSeriesWithFallback(
    [["profit after tax for shareholders of parent company", "co dong cua cong ty me", "cổ đông của công ty mẹ"]],
    [["net profit after tax", "loi nhuan sau thue", "lợi nhuận sau thuế"]]
  );
  const quarterlyEpsSeries = quarterSeriesWithFallback(
    [["earnings per share", "lai co ban tren co phieu", "lãi cơ bản trên cổ phiếu"]],
    [["eps"]]
  );

  const latestQuarterComparable = sameTermPriorYear(quarterlyEpsSeries.length >= 5 ? quarterlyEpsSeries : quarterlyProfitSeries);
  const latestQuarterSeries = quarterlyEpsSeries.length >= 5 ? quarterlyEpsSeries : quarterlyProfitSeries;
  const epsGrowthQoQ = latestQuarterComparable
    ? growth(latestQuarterSeries[0]?.value, latestQuarterComparable.value)
    : null;

  const ttmEps = sumWindow(quarterlyEpsSeries, 0, 4);
  const prevTtmEps = sumWindow(quarterlyEpsSeries, 4, 4);
  const ttmProfit = sumWindow(quarterlyProfitSeries, 0, 4);
  const prevTtmProfit = sumWindow(quarterlyProfitSeries, 4, 4);
  const ttmRevenue = sumWindow(quarterlyRevenueSeries, 0, 4);
  const prevTtmRevenue = sumWindow(quarterlyRevenueSeries, 4, 4);

  const epsGrowth1Y = growth(
    firstFinite(ttmEps, ttmProfit),
    firstFinite(prevTtmEps, prevTtmProfit)
  );
  const revenueGrowth = growth(ttmRevenue, prevTtmRevenue);

  const institutionOwnership = parseInstitutionOwnership(profile);
  const outstandingShares = num(profile?.KLCPLH);
  const trailingEps = latestValue(ratioRows, [
    ["trailing eps", "earnings per share", "eps"],
  ]);

  return {
    pe: latestValue(ratioRows, [["p e", "p/e"]]),
    pb: latestValue(ratioRows, [["p b", "p/b"]]),
    roe: latestValue(ratioRows, [["roe", "return on equity"]]),
    roa: latestValue(ratioRows, [["roa", "return on assets"]]),
    eps: firstFinite(trailingEps, ttmEps),
    epsTTM: firstFinite(trailingEps, ttmEps),
    revenueGrowth,
    earningsGrowth: epsGrowth1Y,
    epsGrowthQoQ,
    epsGrowth1Y,
    institutionOwnership,
    institutionScore: Number.isFinite(institutionOwnership)
      ? +(institutionOwnership / 100).toFixed(4)
      : null,
    outstandingShares,
    employeeCount: num(profile?.HM),
    dividendYield: latestValue(ratioRows, [["dividend yield", "ty suat co tuc", "tỷ suất cổ tức"]]),
    asOf: profile?.AD || ratiosAnnual?.Head?.[0]?.ReportDate || quarterPages[0]?.Head?.[0]?.ReportDate || null,
  };
}

async function fetchFinance(ticker, type, termType, page = 1) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "8",
    type,
    unit: "1000",
    termtype: String(termType),
    languageid: "1",
  });
  return getJson(
    `${FINANCE_BASE}/${encodeURIComponent(ticker)}?${params.toString()}`,
    "kbs_finance",
    "KBS finance"
  );
}

async function enrich(ticker) {
  const key = String(ticker || "").toUpperCase();
  if (!key) throw new Error("Ticker required");

  const cached = cacheHit(key);
  if (cached) return cached;

  try {
    const settled = await Promise.allSettled([
      fetchFinance(key, "CSTC", 1, 1),
      fetchFinance(key, "KQKD", 2, 1),
      fetchFinance(key, "KQKD", 2, 2),
    ]);

    const [ratiosRes, quarter1Res, quarter2Res] = settled;
    const warnings = [QUARANTINED_PROFILE_WARNING, ...settled
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "unknown_error")];

    const profile = null;
    const ratiosAnnual = ratiosRes.status === "fulfilled" ? ratiosRes.value : null;
    const quarterPages = [quarter1Res, quarter2Res]
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const overview = parseOverview({ profile, ratiosAnnual, quarterPages });
    const hasData = Object.values(overview).some((value) => value != null);

    const payload = {
      pe: overview.pe,
      pb: overview.pb,
      eps: overview.eps,
      epsTTM: overview.epsTTM,
      roe: overview.roe,
      roa: overview.roa,
      marketCap: null,
      revenueGrowth: overview.revenueGrowth,
      earningsGrowth: overview.earningsGrowth,
      epsGrowthQoQ: overview.epsGrowthQoQ,
      epsGrowth1Y: overview.epsGrowth1Y,
      dividendYield: overview.dividendYield,
      institutionOwnership: overview.institutionOwnership,
      institutionScore: overview.institutionScore,
      outstandingShares: overview.outstandingShares,
      employeeCount: overview.employeeCount,
      _source: hasData ? "kbs_finance" : "kbs_unavailable",
      _warnings: warnings,
      _meta: {
        provider: "kbs",
        asOf: overview.asOf,
        ownershipSource: "quarantined",
        fundamentalsSource: ratiosAnnual || quarterPages.length ? "kbs_finance" : "unavailable",
        profileStatus: "quarantined",
        financeStatus: hasData ? "ok" : "degraded",
      },
      _sourceHealth: [
        {
          id: "kbs_finance",
          name: "KBS finance",
          critical: false,
          status: hasData ? (warnings.length > 1 ? "degraded" : "ok") : "degraded",
          message: hasData
            ? (warnings.length > 1 ? "Finance enrichment loaded with partial warnings" : "Finance enrichment available")
            : (warnings.find((warning) => warning !== QUARANTINED_PROFILE_WARNING) || "Finance enrichment unavailable"),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "kbs_profile",
          name: "KBS profile",
          critical: false,
          status: "degraded",
          message: QUARANTINED_PROFILE_WARNING,
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    cachePut(key, payload, hasData ? CACHE_TTL_MS : FAILURE_TTL_MS);
    return payload;
  } catch (error) {
    cachePut(key, null, FAILURE_TTL_MS, error.message);
    throw error;
  }
}

module.exports = { enrich };
