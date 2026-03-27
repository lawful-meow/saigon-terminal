const fs = require("fs");
const path = require("path");

function docsDir() {
  return path.resolve(__dirname, process.env.SAIGON_DOCS_DIR || "docs");
}

function ensureDocsDir() {
  fs.mkdirSync(docsDir(), { recursive: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fmtNumber(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("vi-VN");
}

function fmtCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function fmtPct(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function resolveFocusStock(snapshot, selectedTicker) {
  const stock = snapshot?.stocks?.find((item) => item.ticker === selectedTicker) || snapshot?.stocks?.[0] || null;
  return stock;
}

function buildWorkspaceFallback(snapshot, options = {}) {
  const selectedTicker = options.selectedTicker || snapshot?.stocks?.[0]?.ticker || null;
  const focusStock = resolveFocusStock(snapshot, selectedTicker);

  return {
    focusTicker: focusStock?.ticker || null,
    focusStock,
    market: snapshot?.market || null,
    boardRows: snapshot?.stocks || [],
    alerts: snapshot?.alerts?.items || [],
    playbook: null,
    research: {
      latestBriefing: null,
    },
    snapshotMeta: {
      generated: snapshot?.generated || null,
      savedAt: snapshot?.generated || null,
      count: snapshot?.count || 0,
      scanMode: snapshot?.scanMode || null,
    },
  };
}

function buildPage(snapshot, options = {}) {
  const workspace = options.workspace || buildWorkspaceFallback(snapshot, options);
  const focusStock = workspace.focusStock || resolveFocusStock(snapshot, options.selectedTicker);
  const playbook = workspace.playbook;
  const alerts = workspace.alerts || [];
  const leaders = workspace.market?.sectors?.leaders || [];
  const laggards = workspace.market?.sectors?.laggards || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saigon Terminal Snapshot</title>
<style>
:root{
  --bg:#081219;
  --panel:#101c25;
  --panel-2:#132331;
  --line:#264253;
  --text:#eef4f7;
  --muted:#aac0cb;
  --subtle:#7c95a3;
  --accent:#6fdcb6;
  --good:#59dc93;
  --warn:#ffcb72;
  --bad:#ff8b79;
}
*{box-sizing:border-box}
body{
  margin:0;
  font-family:"IBM Plex Sans","Segoe UI",sans-serif;
  color:var(--text);
  background:
    radial-gradient(circle at 0% 0%, rgba(111,220,182,.14), transparent 24%),
    radial-gradient(circle at 100% 0%, rgba(136,200,255,.12), transparent 22%),
    linear-gradient(180deg, #071119 0%, #081219 100%);
}
.app{max-width:1480px;margin:0 auto;padding:20px}
.topbar,.panel{
  border:1px solid var(--line);border-radius:24px;background:rgba(11,21,28,.92)
}
.topbar{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:20px}
.brand-title{font-size:28px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
.brand-title span:last-child{color:var(--accent)}
.brand-copy{margin-top:6px;color:var(--muted);font-size:13px;line-height:1.6}
.chip{
  display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border:1px solid var(--line);
  border-radius:999px;background:rgba(18,36,48,.9);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase
}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;margin-top:18px;align-items:start}
.stack,.rail{display:grid;gap:16px}
.panel{padding:18px}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d8fff0}
.panel-title{margin-top:8px;font-size:21px;font-weight:800}
.panel-copy{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.6}
.metric-grid,.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.metric-card,.item{padding:14px;border:1px solid var(--line);border-radius:18px;background:rgba(12,22,29,.86)}
.metric-k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--subtle)}
.metric-v{margin-top:8px;font-size:28px;font-weight:900;line-height:1}
.metric-copy,.item p{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.55}
.hero{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.hero-card{padding:16px;border:1px solid var(--line);border-radius:20px;background:rgba(11,20,26,.88)}
.hero-price{margin-top:10px;font-size:40px;font-weight:900;line-height:1}
.hero-copy{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.55}
.mono{font-family:"IBM Plex Mono","Menlo",monospace;font-variant-numeric:tabular-nums}
.tone-good{color:var(--good)}
.tone-bad{color:var(--bad)}
.timeline{display:grid;gap:10px;margin-top:16px}
.timeline-item{padding:14px;border-left:3px solid rgba(111,220,182,.36);border-radius:16px;background:rgba(10,18,24,.9);border:1px solid rgba(38,66,83,.75)}
.timeline-meta{margin-top:6px;color:var(--subtle);font-size:12px}
.timeline-copy{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.6;white-space:pre-wrap}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;min-width:900px}
th,td{padding:12px 10px;border-bottom:1px solid rgba(38,66,83,.55);text-align:left}
th{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#d9e8ef}
td{font-size:13px}
@media (max-width:1040px){
  .layout{grid-template-columns:1fr}
  .metric-grid,.detail-grid,.hero{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div>
      <div class="brand-title"><span>SAIGON</span> <span>TERMINAL</span></div>
      <div class="brand-copy">Published read-only war-room snapshot. Local editing stays in the live workspace.</div>
    </div>
    <div style="display:grid;gap:8px">
      <span class="chip">${escapeHtml(workspace.market?.pulse?.status || "snapshot")}</span>
      <div class="brand-copy">Generated ${escapeHtml(fmtDateTime(snapshot?.generated))} · Rows ${escapeHtml(String(snapshot?.count || 0))}</div>
    </div>
  </header>

  <main class="layout">
    <div class="stack">
      <section class="panel">
        <div class="eyebrow">Overview</div>
        <div class="panel-title">Board-first market read</div>
        <div class="metric-grid" style="margin-top:14px">
          <div class="metric-card">
            <div class="metric-k">Market pulse</div>
            <div class="metric-v">${escapeHtml(workspace.market?.pulse?.status || "unknown")}</div>
            <div class="metric-copy">${escapeHtml(workspace.market?.pulse?.note || "No pulse note.")}</div>
          </div>
          <div class="metric-card">
            <div class="metric-k">Breadth</div>
            <div class="metric-v">${escapeHtml(String(workspace.market?.breadth?.advancers ?? "—"))} / ${escapeHtml(String(workspace.market?.breadth?.decliners ?? "—"))}</div>
            <div class="metric-copy">${escapeHtml(String(workspace.market?.breadth?.unchanged ?? "—"))} unchanged in snapshot universe.</div>
          </div>
          <div class="metric-card">
            <div class="metric-k">Turnover</div>
            <div class="metric-v mono">${escapeHtml(fmtCompact(workspace.market?.turnover))}</div>
            <div class="metric-copy">Universe turnover across current display rows.</div>
          </div>
          <div class="metric-card">
            <div class="metric-k">Sector leaders</div>
            <div class="metric-v">${escapeHtml(leaders[0]?.sector || "—")}</div>
            <div class="metric-copy">${escapeHtml(leaders.map((row) => `${row.sector} #${row.rank}`).join(" · ") || "No sector leaders.")}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="eyebrow">Focus</div>
        <div class="panel-title">${escapeHtml(focusStock?.ticker || "No focus ticker")}</div>
        <div class="hero" style="margin-top:14px">
          <div class="hero-card">
            <div class="metric-k">${escapeHtml(focusStock?.sector || "—")}</div>
            <div class="hero-price mono">${escapeHtml(fmtNumber(focusStock?.price))}</div>
            <div class="hero-copy ${focusStock?.sessionChangePct >= 0 ? "tone-good" : "tone-bad"}">
              Session ${escapeHtml(fmtPct(focusStock?.sessionChangePct, 2))} · Signal ${escapeHtml(focusStock?.signal || "—")} · Breakout ${escapeHtml(focusStock?.breakout?.state || "—")}
            </div>
          </div>
          <div class="hero-card">
            <div class="metric-k">Selected playbook</div>
            <div class="hero-copy">${escapeHtml(playbook?.thesis || "No saved playbook thesis. Publish view still carries the board and selected ticker context.")}</div>
            <div class="hero-copy">Next action: ${escapeHtml(playbook?.nextAction?.label || focusStock?.breakout?.reason || "No next action saved.")}</div>
          </div>
        </div>
        <div class="timeline">
          <div class="timeline-item">
            <strong>Latest briefing</strong>
            <div class="timeline-copy">${escapeHtml(workspace.research?.latestBriefing?.note || "No saved briefing included in this snapshot.")}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="eyebrow">Board</div>
        <div class="panel-title">Published universe</div>
        <div class="table-wrap" style="margin-top:14px">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Sector</th>
                <th>Price</th>
                <th>Session</th>
                <th>Strength</th>
                <th>Breakout</th>
                <th>Quality</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              ${(workspace.boardRows || []).map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.ticker)}</strong><br><span style="color:var(--muted)">${escapeHtml(row.name || row.ticker)}</span></td>
                  <td>${escapeHtml(row.sector || "—")}</td>
                  <td class="mono">${escapeHtml(fmtNumber(row.price))}</td>
                  <td class="${row.sessionChangePct >= 0 ? "tone-good" : "tone-bad"}">${escapeHtml(fmtPct(row.sessionChangePct, 2))}</td>
                  <td>${escapeHtml(row.strength?.label || "—")} ${row.strength?.score != null ? `· ${escapeHtml(String(row.strength.score))}` : ""}</td>
                  <td>${escapeHtml(row.breakout?.state || "—")}</td>
                  <td>${escapeHtml(row.quality?.label || "—")} · ${escapeHtml(String(row.coveragePct ?? "—"))}%</td>
                  <td>${escapeHtml(row.signal || "—")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <aside class="rail">
      <section class="panel">
        <div class="eyebrow">Alerts</div>
        <div class="panel-title">What needs attention</div>
        <div class="timeline">
          ${alerts.length ? alerts.slice(0, 6).map((alert) => `
            <div class="timeline-item">
              <strong>${escapeHtml(alert.title)}</strong>
              <div class="timeline-meta">${escapeHtml((alert.ticker ? `${alert.ticker} · ` : "") + (alert.level || "info"))}</div>
              <div class="timeline-copy">${escapeHtml(alert.summary || (alert.reasons || []).join("; ") || "No detail")}</div>
            </div>
          `).join("") : `<div class="item"><p>No alerts in this publish payload.</p></div>`}
        </div>
      </section>

      <section class="panel">
        <div class="eyebrow">Sector Rotation</div>
        <div class="panel-title">Leader / laggard strip</div>
        <div class="detail-grid" style="margin-top:14px">
          <div class="item">
            <strong>Leaders</strong>
            <p>${escapeHtml(leaders.map((row) => `${row.sector} (#${row.rank}, rot ${row.rotationScore})`).join(" · ") || "No leader rows")}</p>
          </div>
          <div class="item">
            <strong>Laggards</strong>
            <p>${escapeHtml(laggards.map((row) => `${row.sector} (#${row.rank}, rot ${row.rotationScore})`).join(" · ") || "No laggard rows")}</p>
          </div>
        </div>
      </section>
    </aside>
  </main>
</div>
<script>
window.__SAIGON_PUBLISH__ = ${safeJson({
    snapshot,
    workspace,
    selectedTicker: options.selectedTicker || focusStock?.ticker || null,
  })};
</script>
</body>
</html>`;
}

function publishSnapshot(snapshot, options = {}) {
  ensureDocsDir();
  const html = buildPage(snapshot, options);
  const outputPath = path.join(docsDir(), "index.html");
  const jsonPath = path.join(docsDir(), "snapshot.json");
  const noJekyllPath = path.join(docsDir(), ".nojekyll");
  const publishedAt = new Date().toISOString();

  fs.writeFileSync(outputPath, html, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify({
    publishedAt,
    selectedTicker: options.selectedTicker || snapshot?.stocks?.[0]?.ticker || null,
    snapshot,
    workspace: options.workspace || null,
    prompt: options.prompt || "",
  }, null, 2), "utf8");
  fs.writeFileSync(noJekyllPath, "", "utf8");

  return {
    status: "ok",
    publishedAt,
    outputPath: "docs/index.html",
    snapshotPath: "docs/snapshot.json",
    previewPath: "/docs/",
  };
}

module.exports = { publishSnapshot };
