// ─── publisher.js ──────────────────────────────────────────────────────────────
// Export a static snapshot page that can be hosted on GitHub Pages.
// Output is self-contained: one HTML file with embedded snapshot data.
// ────────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

function docsDir() {
  return path.resolve(__dirname, process.env.SAIGON_DOCS_DIR || "docs");
}

function ensureDocsDir() {
  fs.mkdirSync(docsDir(), { recursive: true });
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildPage(snapshot, options = {}) {
  const prompt = options.prompt || "";
  const selectedTicker = options.selectedTicker || snapshot?.stocks?.[0]?.ticker || null;
  const data = {
    snapshot,
    prompt,
    selectedTicker,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saigon Terminal Snapshot</title>
<style>
:root{
  --bg:#071014;
  --bg-2:#0c161c;
  --panel:#101d24;
  --panel-2:#14252f;
  --line:#27414d;
  --text:#f3f0e9;
  --muted:#b9c7ce;
  --subtle:#7e939d;
  --accent:#5ce1b8;
  --accent-2:#7fd0ff;
  --good:#57df94;
  --bad:#ff8573;
  --warn:#ffc869;
  --shadow:0 24px 60px rgba(0,0,0,.28);
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:"IBM Plex Sans","Avenir Next","Segoe UI",sans-serif;
  color:var(--text);
  background:
    radial-gradient(circle at top left, rgba(92,225,184,.11), transparent 24%),
    radial-gradient(circle at 88% 0%, rgba(127,208,255,.10), transparent 22%),
    linear-gradient(180deg, #061014 0%, #081117 38%, #071014 100%);
}
a{color:#d9fff1;text-decoration:none}
.app{max-width:1500px;margin:0 auto;padding:24px}
.topbar{
  display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;
  padding:18px 20px;border:1px solid var(--line);border-radius:24px;
  background:rgba(7,16,20,.84);backdrop-filter:blur(18px);box-shadow:var(--shadow);
}
.brand-title{font-size:28px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
.brand-title span:last-child{color:var(--accent)}
.brand-sub,.meta-copy{color:var(--muted);font-size:13px;line-height:1.6}
.pill{
  display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:999px;
  border:1px solid rgba(92,225,184,.28);background:rgba(92,225,184,.10);color:#d9fff0;
  font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;margin-top:18px;align-items:start}
.stack,.rail{display:grid;gap:16px}
.panel{
  border:1px solid var(--line);border-radius:24px;padding:18px;
  background:linear-gradient(180deg, rgba(16,29,36,.96), rgba(12,22,28,.96));
  box-shadow:var(--shadow);
}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d2fff0}
.panel-title{font-size:22px;font-weight:800;margin-top:6px}
.sheet-nav-wrap{display:grid;gap:10px}
.sheet-nav-label{font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.16em}
.sheet-nav{display:flex;gap:8px;overflow:auto;padding-bottom:2px}
.sheet-nav::-webkit-scrollbar{height:8px}
.sheet-nav::-webkit-scrollbar-thumb{background:rgba(40,69,81,.8);border-radius:999px}
.sheet-tab{
  min-width:132px;padding:10px 12px;border-radius:16px;border:1px solid rgba(40,69,81,.82);
  background:rgba(10,18,24,.92);color:var(--text);text-align:left;display:grid;gap:4px;flex:0 0 auto;
}
.sheet-tab.active{
  border-color:rgba(92,225,184,.38);background:rgba(92,225,184,.10);box-shadow:inset 0 0 0 1px rgba(92,225,184,.14);
}
.sheet-tab-ticker{font-size:13px;font-weight:800;letter-spacing:.04em}
.sheet-tab-meta{font-size:11px;color:var(--muted);line-height:1.4}
.focus-hero{
  display:grid;grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr);gap:14px;margin-top:14px;
}
.hero-slab{
  padding:16px;border-radius:20px;border:1px solid rgba(40,69,81,.82);
  background:
    radial-gradient(circle at 0% 0%, rgba(92,225,184,.12), transparent 28%),
    radial-gradient(circle at 100% 100%, rgba(127,208,255,.12), transparent 30%),
    rgba(11,20,26,.92);
}
.hero-price{font-size:42px;font-weight:900;line-height:1;letter-spacing:-.03em;margin:8px 0 10px}
.mono{font-family:"IBM Plex Mono","SFMono-Regular","Menlo",monospace;font-variant-numeric:tabular-nums}
.chip-row,.market-grid,.kv-grid,.history-strip{display:flex;gap:8px;flex-wrap:wrap}
.chip,.signal-chip,.quality-chip{
  display:inline-flex;align-items:center;min-height:30px;padding:0 10px;border-radius:999px;
  border:1px solid rgba(40,69,81,.8);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
}
.chip{background:rgba(127,208,255,.08);color:#e3f6ff}
.signal-chip[data-signal="STRONG_BUY"],.signal-chip[data-signal="BUY"]{background:rgba(92,225,184,.10);color:#ddfff3}
.signal-chip[data-signal="HOLD"]{background:rgba(127,208,255,.10);color:#e3f6ff}
.signal-chip[data-signal="SELL"],.signal-chip[data-signal="STRONG_SELL"]{background:rgba(255,133,115,.12);color:#ffd4ce}
.quality-chip[data-tone="high"]{background:rgba(92,225,184,.10);color:#ddfff3}
.quality-chip[data-tone="medium"]{background:rgba(255,200,105,.10);color:#ffecc7}
.quality-chip[data-tone="low"]{background:rgba(255,133,115,.12);color:#ffd4ce}
.tone-good{color:var(--good)}
.tone-bad{color:var(--bad)}
.detail-grid,.kv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}
.stat-card,.section-card{
  padding:12px;border-radius:16px;border:1px solid rgba(40,69,81,.78);background:rgba(11,20,26,.88);
}
.stat-k,.kv .k{font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px}
.stat-v{font-size:20px;font-weight:800}
.kv{display:grid;gap:4px}
.kv .v{font-size:14px;line-height:1.45}
.list{display:grid;gap:8px}
.item{
  padding:10px 12px;border-radius:14px;background:rgba(20,37,47,.9);
  border:1px solid rgba(40,69,81,.7);font-size:13px;line-height:1.5;
}
.factor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.factor-card{
  padding:12px;border-radius:16px;border:1px solid rgba(40,69,81,.82);background:rgba(15,26,33,.92);display:grid;gap:10px;
}
.factor-card[data-status="unknown"]{border-color:rgba(255,200,105,.28);background:rgba(45,34,18,.20)}
.factor-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.factor-name{font-size:13px;font-weight:800;letter-spacing:.03em}
.factor-metric{margin-top:4px;color:var(--muted);font-size:12px;line-height:1.4}
.factor-score{
  min-width:62px;padding:8px 10px;border-radius:14px;border:1px solid rgba(40,69,81,.8);
  background:rgba(9,18,24,.9);font-size:13px;font-weight:800;text-align:center;
}
.factor-score[data-tone="strong"]{border-color:rgba(92,225,184,.34);color:#ddfff3}
.factor-score[data-tone="weak"]{border-color:rgba(255,133,115,.34);color:#ffd4ce}
.factor-score[data-tone="unknown"]{border-color:rgba(255,200,105,.34);color:#ffecc7}
.factor-meta,.factor-bands{display:flex;gap:8px;flex-wrap:wrap}
.factor-reason{font-size:13px;color:var(--text);line-height:1.55}
.factor-band{
  display:inline-flex;align-items:center;min-height:26px;padding:0 8px;border-radius:999px;
  border:1px solid rgba(40,69,81,.8);color:var(--muted);font-size:11px;letter-spacing:.04em;
}
.factor-band.active{border-color:rgba(92,225,184,.34);background:rgba(92,225,184,.10);color:#ddfff3}
.board-table{width:100%;border-collapse:collapse;margin-top:14px;min-width:1000px}
.board-wrap{overflow:auto}
.board-table th,.board-table td{padding:12px 10px;border-bottom:1px solid rgba(38,64,76,.7);text-align:left;font-size:13px}
.board-table th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#d9e8ee}
.board-table tr.active{background:rgba(92,225,184,.08)}
.market-grid{display:grid;grid-template-columns:1fr;gap:12px;margin-top:14px}
.market-card{padding:14px;border-radius:18px;border:1px solid rgba(40,69,81,.7);background:linear-gradient(180deg, rgba(21,37,47,.96), rgba(13,24,31,.96))}
.market-k{font-size:11px;color:var(--subtle);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
.market-v{font-size:24px;font-weight:800;line-height:1.05}
.market-s{margin-top:8px;color:var(--muted);font-size:13px;line-height:1.5}
.history-chip{min-width:88px;padding:8px 10px;border-radius:14px;background:rgba(20,37,47,.9);border:1px solid rgba(40,69,81,.7)}
.history-chip .ts{color:var(--subtle);font-size:10px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.1em}
.history-chip .sv{font-size:12px;line-height:1.5}
details{margin-top:14px}
summary{cursor:pointer;color:#d9fff1;font-weight:700}
pre{
  margin-top:10px;padding:16px;border-radius:18px;border:1px solid rgba(40,69,81,.8);
  background:rgba(11,20,26,.92);color:#dbe7ec;font-family:"IBM Plex Mono","SFMono-Regular","Menlo",monospace;
  font-size:12px;white-space:pre-wrap;line-height:1.7
}
@media (max-width:1100px){
  .layout{grid-template-columns:1fr}
  .focus-hero{grid-template-columns:1fr}
  .market-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:760px){
  .app{padding:12px}
  .detail-grid,.kv-grid,.market-grid,.factor-grid{grid-template-columns:1fr}
  .hero-price{font-size:34px}
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div>
      <div class="brand-title"><span>SAIGON</span> <span>TERMINAL</span></div>
      <div class="brand-sub">Published market snapshot</div>
    </div>
    <div>
      <span class="pill">Snapshot</span>
      <div class="meta-copy" id="headerMeta"></div>
    </div>
  </header>

  <main class="layout">
    <div class="stack">
      <section class="panel" id="focusPanel"></section>
      <section class="panel">
        <div class="eyebrow">Ranked Board</div>
        <div class="panel-title">Published universe</div>
        <div class="board-wrap" id="boardWrap"></div>
      </section>
    </div>

    <aside class="rail">
      <section class="panel">
        <div class="eyebrow">Market Rail</div>
        <div class="panel-title">Benchmarks and breadth</div>
        <div class="market-grid" id="marketGrid"></div>
      </section>

      <section class="panel">
        <div class="eyebrow">Snapshot</div>
        <div class="panel-title">Publish details</div>
        <div class="detail-grid" id="publishStats"></div>
      </section>
    </aside>
  </main>
</div>

<script>
const DATA = ${safeJson(data)};
const SIGNAL_LABELS = {
  STRONG_BUY: "Strong Bullish Bias",
  BUY: "Bullish Bias",
  HOLD: "Neutral / Mixed",
  SELL: "Bearish Bias",
  STRONG_SELL: "Strong Bearish Bias",
};

const state = {
  snapshot: DATA.snapshot,
  prompt: DATA.prompt || "",
  selectedTicker: DATA.selectedTicker || DATA.snapshot?.stocks?.[0]?.ticker || null,
};

function fNum(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("vi-VN");
}

function fK(n) {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function fPct(n, scale = 1, digits = 1) {
  if (n == null) return "—";
  const value = Number(n) * scale;
  return \`\${value >= 0 ? "+" : ""}\${value.toFixed(digits)}%\`;
}

function signalLabel(signal) {
  return SIGNAL_LABELS[signal] || String(signal || "UNKNOWN").replace(/_/g, " ");
}

function qualityTone(label) {
  return label === "high" ? "high" : (label === "medium" ? "medium" : "low");
}

function factorScoreTone(detail) {
  if (detail.score == null) return "unknown";
  return detail.score >= 8 ? "strong" : "weak";
}

function warningSummary(stock) {
  const missing = stock.quality?.missingFactors?.length ? \`Missing \${stock.quality.missingFactors.join("/")}\` : null;
  const firstWarning = (stock.quality?.warnings || []).find((warning) =>
    !missing || !warning.includes("Missing CAN SLIM factors")
  ) || null;
  return [missing, firstWarning].filter(Boolean).join(" · ") || "Clean";
}

function fRR(value) {
  if (value == null) return "—";
  return \`\${Number(value).toFixed(2)}R\`;
}

function activeWyckoffEvents(wyckoff) {
  return Object.values(wyckoff?.events || {}).filter((event) => event && event.active);
}

function renderWyckoffPlans(wyckoff) {
  const plans = wyckoff?.entry?.plans || [];
  if (!plans.length) {
    return \`<div class="item">\${wyckoff?.entry?.summary || "No active long entry."}</div>\`;
  }

  return plans.map((plan) => \`
    <div class="factor-card">
      <div class="factor-head">
        <div>
          <div class="factor-name">\${plan.label}</div>
          <div class="factor-metric">\${plan.why || "No rationale provided."}</div>
        </div>
        <div class="factor-score" data-tone="\${plan.kind === "buy" ? "strong" : "unknown"}">\${plan.kind === "buy" ? "BUY" : "WAIT"}</div>
      </div>
      <div class="factor-meta">
        <span class="chip">Entry \${fNum(plan.price)}</span>
        <span class="chip">Stop \${fNum(plan.stop)}</span>
        <span class="chip">T1 \${fNum(plan.target1)}</span>
        <span class="chip">T2 \${fNum(plan.target2)}</span>
      </div>
      <div class="factor-reason">Risk / reward: \${fRR(plan.riskReward1)} to T1, \${fRR(plan.riskReward2)} to T2.</div>
    </div>
  \`).join("");
}

function renderWyckoffWatch(wyckoff) {
  const watch = wyckoff?.entry?.watch || [];
  if (!watch.length) {
    return \`<div class="item">\${wyckoff?.entry?.invalidation || "No watch trigger defined."}</div>\`;
  }

  return watch.map((item) => \`
    <div class="item">
      <strong>\${item.label}</strong><br>
      \${item.price != null ? \`Trigger \${fNum(item.price)}. \` : ""}\${item.why || ""}
    </div>
  \`).join("");
}

function renderWyckoffReasoning(wyckoff) {
  const reasoning = wyckoff?.reasoning || [];
  return reasoning.map((item) => \`
    <div class="item">
      <strong>Step \${item.step}. \${item.title}</strong><br>
      \${item.detail}
    </div>
  \`).join("") || \`<div class="item">No reasoning available.</div>\`;
}

function renderActionItems(items, emptyCopy) {
  if (!items?.length) return \`<div class="item">\${emptyCopy}</div>\`;
  return items.map((item) => \`<div class="item">\${item}</div>\`).join("");
}

function renderWyckoffTests(wyckoff) {
  const active = wyckoff?.tests?.activeSide === "sell" ? wyckoff?.tests?.sell?.items : wyckoff?.tests?.buy?.items;
  if (!active?.length) return \`<div class="item">No Wyckoff tests recorded.</div>\`;
  return active.map((test) => \`<div class="item \${test.status === "pass" ? "tone-good" : test.status === "fail" ? "tone-bad" : ""}"><strong>\${test.label}</strong><br>\${test.detail}</div>\`).join("");
}

function renderHeader() {
  const meta = document.getElementById("headerMeta");
  meta.textContent = \`\${new Date(state.snapshot.generated).toLocaleString("vi-VN")} · \${state.snapshot.count} tickers\`;
}

function renderMarket() {
  const market = state.snapshot.market;
  const grid = document.getElementById("marketGrid");
  const cards = ["VNINDEX", "VN30"].map((symbol) => {
    const index = market.indexes[symbol];
    if (!index) return "";
    const tone = (index.changePct || 0) >= 0 ? "tone-good" : "tone-bad";
    return \`
      <div class="market-card">
        <div class="market-k">\${symbol}</div>
        <div class="market-v mono">\${fNum(index.price)}</div>
        <div class="market-s \${tone}">\${index.changePct >= 0 ? "+" : ""}\${index.changePct}% · \${index.regime}</div>
        <div class="chip-row">
          <span class="chip">1M \${fPct(index.ret1m, 100)}</span>
          <span class="chip">3M \${fPct(index.ret3m, 100)}</span>
        </div>
      </div>
    \`;
  }).join("");

  grid.innerHTML = cards + \`
    <div class="market-card">
      <div class="market-k">Market Pulse</div>
      <div class="market-v">\${market.pulse?.status || "unknown"}</div>
      <div class="market-s">\${market.pulse?.note || "No pulse note available."}</div>
      <div class="chip-row">
        <span class="chip">Exposure \${market.pulse?.exposure || "n/a"}</span>
        <span class="chip">Dist \${market.pulse?.distributionDays ?? "n/a"}</span>
        \${market.pulse?.followThrough?.date ? \`<span class="chip">FTD \${market.pulse.followThrough.date}</span>\` : ""}
      </div>
    </div>
    <div class="market-card">
      <div class="market-k">Breadth</div>
      <div class="market-v mono">\${market.breadth.advancers} / \${market.breadth.decliners}</div>
      <div class="market-s">\${market.breadth.unchanged} unchanged · session \${market.session.replace(/_/g, " ")}</div>
    </div>
    <div class="market-card">
      <div class="market-k">Turnover</div>
      <div class="market-v mono">\${fK(market.turnover)}</div>
      <div class="market-s">Universe turnover in this snapshot</div>
    </div>
  \`;
}

function renderPublishStats() {
  const root = document.getElementById("publishStats");
  const selected = state.snapshot.stocks.find((stock) => stock.ticker === state.selectedTicker) || state.snapshot.stocks[0];
  root.innerHTML = [
    \`<div class="stat-card"><div class="stat-k">Focus</div><div class="stat-v">\${selected?.ticker || "—"}</div><div>\${selected ? selected.explain.ruleRead : "—"}</div></div>\`,
    \`<div class="stat-card"><div class="stat-k">Universe</div><div class="stat-v mono">\${state.snapshot.count}</div><div>Tickers in this published snapshot</div></div>\`,
    \`<div class="stat-card"><div class="stat-k">Published</div><div class="stat-v mono">\${new Date(state.snapshot.generated).toLocaleString("vi-VN")}</div><div>Snapshot timestamp</div></div>\`,
    \`<div class="stat-card"><div class="stat-k">Strength</div><div class="stat-v mono">\${selected?.strength?.score == null ? "—" : \`\${selected.strength.score}/100\`}</div><div>\${selected?.strength?.label || "No strength label"}\${selected?.strength?.rank ? \` · Rank #\${selected.strength.rank}\` : ""}</div></div>\`,
  ].join("");
}

function renderBoard() {
  const root = document.getElementById("boardWrap");
  root.innerHTML = \`
    <table class="board-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Sector</th>
          <th>Last</th>
          <th>Chg%</th>
          <th>Value</th>
          <th>Vol x Avg</th>
          <th>RS vs VNINDEX</th>
          <th>Strength</th>
          <th>Observed CAN SLIM</th>
          <th>Rule Read</th>
          <th>Quality</th>
        </tr>
      </thead>
      <tbody>
        \${state.snapshot.stocks.map((stock) => {
          const selected = stock.ticker === state.selectedTicker ? "active" : "";
          const observedPct = stock.observedCanSlimMax > 0
            ? \`\${stock.observedCanSlimTotal}/\${stock.observedCanSlimMax} · \${stock.coveragePct}%\`
            : \`N/A · \${stock.coveragePct}%\`;
          const strengthText = stock.strength?.score == null
            ? "N/A"
            : \`\${stock.strength.score}/100 · #\${stock.strength?.rank || "—"}\`;
          return \`
            <tr class="\${selected}" data-ticker="\${stock.ticker}">
              <td><strong>\${stock.ticker}</strong><div style="color:var(--muted);font-size:12px;margin-top:4px">\${stock.name}</div></td>
              <td>\${stock.sector}</td>
              <td class="mono">\${fNum(stock.price)}</td>
              <td class="\${(stock.changePct || 0) >= 0 ? "tone-good" : "tone-bad"}">\${stock.changePct >= 0 ? "+" : ""}\${stock.changePct}%</td>
              <td class="mono">\${fK(stock.tradedValue)}</td>
              <td class="mono">\${stock.volRatio}x</td>
              <td class="\${stock.relative?.vsVNINDEX3m >= 0 ? "tone-good" : "tone-bad"}">\${fPct(stock.relative?.vsVNINDEX3m, 100)}</td>
              <td><span class="chip">\${strengthText}</span><div style="color:var(--muted);font-size:12px;margin-top:5px">\${stock.strength?.label || "n/a"}</div></td>
              <td><span class="chip">\${observedPct}</span></td>
              <td><span class="signal-chip" data-signal="\${stock.signal}">\${signalLabel(stock.signal)}</span></td>
              <td><span class="quality-chip" data-tone="\${qualityTone(stock.quality.label)}">\${stock.quality.label}</span><div style="color:var(--muted);font-size:12px;margin-top:5px">\${warningSummary(stock)}</div></td>
            </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
  \`;

  root.querySelectorAll("[data-ticker]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedTicker = row.dataset.ticker;
      renderBoard();
      renderFocus();
      renderPublishStats();
    });
  });
}

function renderFocus() {
  const stock = state.snapshot.stocks.find((item) => item.ticker === state.selectedTicker) || state.snapshot.stocks[0];
  const tickerNav = state.snapshot.stocks.map((item) => \`
    <button class="sheet-tab \${item.ticker === stock.ticker ? "active" : ""}" data-sheet-nav="\${item.ticker}">
      <div class="sheet-tab-ticker">\${item.ticker}</div>
      <div class="sheet-tab-meta">\${item.changePct >= 0 ? "+" : ""}\${item.changePct}% · \${item.confidence}/10</div>
    </button>
  \`).join("");
  const positives = stock.explain.driversPositive.length
    ? stock.explain.driversPositive.map((line) => \`<div class="item tone-good">\${line}</div>\`).join("")
    : \`<div class="item">No strong positive drivers.</div>\`;
  const negatives = stock.explain.driversNegative.length
    ? stock.explain.driversNegative.map((line) => \`<div class="item tone-bad">\${line}</div>\`).join("")
    : \`<div class="item">No major negative drivers.</div>\`;
  const warnings = stock.quality.warnings.length
    ? stock.quality.warnings.map((line) => \`<div class="item">\${line}</div>\`).join("")
    : \`<div class="item">No active warnings.</div>\`;
  const factors = Object.entries(stock.explain.factorBreakdown).map(([factor, detail]) =>
    \`
      <div class="factor-card" data-status="\${detail.status}">
        <div class="factor-head">
          <div>
            <div class="factor-name">\${factor} · \${detail.factorLabel}</div>
            <div class="factor-metric">\${detail.metricLabel}</div>
          </div>
          <div class="factor-score" data-tone="\${factorScoreTone(detail)}">\${detail.score == null ? "?" : \`\${detail.score}/10\`}</div>
        </div>
        <div class="factor-meta">
          <span class="chip">\${detail.status}</span>
          <span class="chip">Raw \${detail.displayValue}</span>
          <span class="chip">\${detail.bandLabel}</span>
        </div>
        <div class="factor-reason">\${detail.reason}</div>
        <div class="factor-bands">
          \${detail.bands.map((band) => \`<span class="factor-band \${band.active ? "active" : ""}">\${band.score} · \${band.label}</span>\`).join("")}
        </div>
      </div>
    \`
  ).join("");
  const history = (stock.historyMini || []).map((entry) => \`
    <div class="history-chip">
      <div class="ts">\${new Date(entry.timestamp).toLocaleString("vi-VN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
      <div class="sv mono">\${fNum(entry.price)}</div>
      <div class="sv">\${signalLabel(entry.signal)}</div>
      <div class="sv">\${entry.confidence}/10</div>
    </div>
  \`).join("");

  const wyckoff = stock.wyckoff || {};
  const activeEvents = activeWyckoffEvents(wyckoff);
  const eventChips = activeEvents.length
    ? activeEvents.map((event) => \`<span class="chip">\${event.name} \${event.volumeRatio != null ? \`\${event.volumeRatio}x\` : ""}</span>\`).join("")
    : \`<span class="chip">No fresh Wyckoff trigger</span>\`;
  const primaryPlan = wyckoff.entry?.plans?.[0] || null;
  const primaryPlanText = primaryPlan
    ? \`Entry \${fNum(primaryPlan.price)} · Stop \${fNum(primaryPlan.stop)}\`
    : (wyckoff.entry?.summary || "No active long entry.");
  const invalidationText = wyckoff.entry?.invalidation || "No invalidation level recorded.";
  const reasoning = renderWyckoffReasoning(wyckoff);
  const planCards = renderWyckoffPlans(wyckoff);
  const watchItems = renderWyckoffWatch(wyckoff);
  const actionSteps = renderActionItems(wyckoff.action?.steps, "No action steps recorded.");
  const avoidSteps = renderActionItems(wyckoff.action?.shouldAvoid, "No avoid list recorded.");
  const testItems = renderWyckoffTests(wyckoff);

  document.getElementById("focusPanel").innerHTML = \`
    <div class="sheet-nav-wrap">
      <div class="sheet-nav-label">Quick Ticker Nav</div>
      <div class="sheet-nav">\${tickerNav}</div>
    </div>

    <div class="eyebrow">Main Sheet</div>
    <div class="panel-title">\${stock.ticker} · \${stock.name}</div>
    <div class="meta-copy">\${stock.sector} · \${new Date(stock.scanTime).toLocaleString("vi-VN")} · \${stock.market.session.replace(/_/g, " ")} market</div>

    <div class="focus-hero">
      <div class="hero-slab">
        <div class="hero-price mono">\${fNum(stock.price)}</div>
        <div class="\${stock.changePct >= 0 ? "tone-good" : "tone-bad"}">\${stock.changePct >= 0 ? "+" : ""}\${stock.changePct}% · \${fK(stock.tradedValue)} traded · \${fNum(stock.volume)} volume</div>
        <div class="chip-row" style="margin-top:12px">
          <span class="signal-chip" data-signal="\${stock.signal}">\${signalLabel(stock.signal)}</span>
          <span class="chip">Strength \${stock.strength?.score == null ? "N/A" : \`\${stock.strength.score}/100\`}</span>
          <span class="chip">\${stock.strength?.label || "n/a"}\${stock.strength?.rank ? \` · #\${stock.strength.rank}\` : ""}</span>
          <span class="quality-chip" data-tone="\${qualityTone(stock.quality.label)}">\${stock.quality.label} · \${stock.coveragePct}%</span>
          <span class="chip">Observed \${stock.observedCanSlimTotal}/\${stock.observedCanSlimMax || 0}</span>
          <span class="chip">RS vs VNINDEX \${fPct(stock.relative.vsVNINDEX3m, 100)}</span>
          <span class="chip">\${wyckoff.stage || stock.wyckoffStage || stock.wyckoffPhase || "Wyckoff n/a"}</span>
          <span class="chip">Wyckoff \${wyckoff.confidence || "—"}/100</span>
        </div>
      </div>
      <div class="stack" style="gap:12px">
        <div class="stat-card"><div class="stat-k">Rule Strength</div><div class="stat-v mono">\${stock.confidence}/10</div><div>\${stock.explain.ruleStrength.label}</div></div>
        <div class="stat-card"><div class="stat-k">CAN SLIM Strength</div><div class="stat-v mono">\${stock.strength?.score == null ? "—" : \`\${stock.strength.score}/100\`}</div><div>\${stock.strength?.label || "No strength label"}\${stock.strength?.rank ? \` · Rank #\${stock.strength.rank}\` : ""}</div></div>
        <div class="stat-card"><div class="stat-k">Wyckoff Action</div><div class="stat-v">\${wyckoff.action?.label || "No action"}</div><div>\${wyckoff.action?.summary || wyckoff.entry?.summary || "No Wyckoff action summary."}</div></div>
        <div class="stat-card"><div class="stat-k">Primary Entry</div><div>\${primaryPlanText}</div><div>\${primaryPlan ? \`T1 \${fNum(primaryPlan.target1)} · T2 \${fNum(primaryPlan.target2)}\` : invalidationText}</div></div>
        <div class="stat-card"><div class="stat-k">Delta</div><div>\${stock.delta}</div></div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="section-card">
        <div class="eyebrow">Context</div>
        <div class="kv-grid">
          <div class="kv"><div class="k">Market Pulse</div><div class="v">\${stock.market.pulse?.status || "unknown"}</div></div>
          <div class="kv"><div class="k">Suggested Exposure</div><div class="v">\${stock.market.pulse?.exposure || "n/a"}</div></div>
          <div class="kv"><div class="k">RS vs VNINDEX</div><div class="v mono">\${fPct(stock.relative.vsVNINDEX3m, 100)}</div></div>
          <div class="kv"><div class="k">RS vs VN30</div><div class="v mono">\${fPct(stock.relative.vsVN303m, 100)}</div></div>
          <div class="kv"><div class="k">Vol x Avg20</div><div class="v mono">\${stock.volRatio}x</div></div>
          <div class="kv"><div class="k">RSI14</div><div class="v mono">\${stock.rsi14 ?? "—"}</div></div>
          <div class="kv"><div class="k">PE / PB</div><div class="v mono">\${stock.pe ?? "—"} / \${stock.pb ?? "—"}</div></div>
          <div class="kv"><div class="k">ROE</div><div class="v mono">\${stock.roe ?? "—"}</div></div>
        </div>
      </div>

      <div class="section-card">
        <div class="eyebrow">Wyckoff Map</div>
        <div class="kv-grid">
          <div class="kv"><div class="k">Phase</div><div class="v">\${wyckoff.label || stock.wyckoffPhase || "N/A"}</div></div>
          <div class="kv"><div class="k">Bias</div><div class="v">\${wyckoff.bias || stock.wyckoffBias || "N/A"}</div></div>
          <div class="kv"><div class="k">Support / Resistance</div><div class="v mono">\${fNum(wyckoff.levels?.support)} / \${fNum(wyckoff.levels?.resistance)}</div></div>
          <div class="kv"><div class="k">Range Position</div><div class="v">\${wyckoff.levels?.pricePositionPct == null ? "N/A" : \`\${wyckoff.levels.pricePositionPct}% · \${wyckoff.context?.rangeLocation || ""}\`}</div></div>
          <div class="kv"><div class="k">Trend Bias</div><div class="v">\${wyckoff.context?.trendBias || "N/A"}</div></div>
          <div class="kv"><div class="k">Invalidation</div><div class="v">\${invalidationText}</div></div>
        </div>
        <div class="chip-row" style="margin-top:12px">\${eventChips}</div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="section-card">
        <div class="eyebrow">Wyckoff Steps</div>
        <div class="list" style="margin-top:12px">\${reasoning}</div>
      </div>
      <div class="section-card">
        <div class="eyebrow">Action Plan</div>
        <div class="list" style="margin-top:12px">\${actionSteps}</div>
      </div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Wyckoff Tests</div>
      <div class="list" style="margin-top:12px">\${testItems}</div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Avoid</div>
      <div class="list" style="margin-top:12px">\${avoidSteps}</div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Wyckoff Entry Plans</div>
      <div class="factor-grid" style="margin-top:12px">\${planCards}</div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Watch Triggers</div>
      <div class="list" style="margin-top:12px">\${watchItems}</div>
    </div>

    <div class="detail-grid" style="margin-top:14px">
      <div class="section-card">
        <div class="eyebrow">Positive Drivers</div>
        <div class="list" style="margin-top:12px">\${positives}</div>
      </div>
      <div class="section-card">
        <div class="eyebrow">Negative Drivers</div>
        <div class="list" style="margin-top:12px">\${negatives}</div>
      </div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Factor Breakdown</div>
      <div class="factor-grid" style="margin-top:12px">\${factors}</div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Quality & Sources</div>
      <div class="kv-grid" style="margin-top:12px">
        <div class="kv"><div class="k">Freshness</div><div class="v">\${stock.quality.freshnessSec == null ? "N/A" : stock.quality.freshnessSec + " sec"}</div></div>
        <div class="kv"><div class="k">Price Source</div><div class="v">\${stock.quality.sourceFlags.price}</div></div>
        <div class="kv"><div class="k">Fundamentals</div><div class="v">\${stock.quality.sourceFlags.fundamentals}</div></div>
        <div class="kv"><div class="k">Ownership</div><div class="v">\${stock.quality.sourceFlags.ownership}</div></div>
      </div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">Warnings</div>
      <div class="list" style="margin-top:12px">\${warnings}</div>
    </div>

    <div class="section-card" style="margin-top:14px">
      <div class="eyebrow">History Strip</div>
      <div class="history-strip" style="margin-top:12px">\${history}</div>
    </div>
  \`;

  document.querySelectorAll("[data-sheet-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTicker = button.dataset.sheetNav;
      renderBoard();
      renderFocus();
      renderPublishStats();
    });
  });
}

renderHeader();
renderMarket();
renderPublishStats();
renderBoard();
renderFocus();
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
