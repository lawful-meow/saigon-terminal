import * as api from "./api.js";
import {
  escapeHtml,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtNumber,
  fmtPct,
  parseCommaList,
  parseLadder,
  parseTargets,
  toneByValue,
  toDateTimeLocal,
} from "./utils.js";

const ADVANCED_TABS = [
  { id: "research", label: "Nghiên cứu" },
  { id: "playbook", label: "Playbook" },
  { id: "journal", label: "Nhật ký" },
  { id: "publish", label: "Xuất bản" },
  { id: "command", label: "Lệnh" },
];

const state = {
  workspace: null,
  focusTicker: null,
  researchWindow: "7d",
  journalDate: "today",
  advancedOpen: false,
  advancedTab: "research",
  publishPreview: "/docs/",
  commandOutput: "Gõ `help` để xem lệnh. Khu vực này chỉ dành cho thao tác nâng cao.",
  taskStreams: new Map(),
  viewLoading: false,
  autoScanTriggered: false,
};

const refs = {};

function getWorkspace() {
  return state.workspace || {
    boardRows: [],
    alerts: [],
    sourceHealth: [],
    activeTasks: [],
    market: null,
    warnings: [],
    stale: false,
    focusStock: null,
    research: { evidence: [], latestBriefing: null, window: state.researchWindow, count: 0 },
    playbook: null,
    journal: { entries: [], date: state.journalDate },
    snapshotMeta: { generated: null, selectedTicker: null, count: 0, savedAt: null, source: "empty" },
    lastSuccessfulScanAt: null,
    lastAttemptedScanAt: null,
  };
}

function workspaceReady() {
  return Boolean(getWorkspace().snapshotMeta?.generated);
}

function topRows(limit = 10) {
  return [...(getWorkspace().boardRows || [])].slice(0, limit);
}

function focusStock() {
  const workspace = getWorkspace();
  if (!workspace.boardRows?.length) return null;
  return workspace.boardRows.find((row) => row.ticker === state.focusTicker) || workspace.boardRows[0] || null;
}

function setStatus(text, tone = "") {
  refs.statusChip.textContent = text;
  refs.statusChip.className = `chip ${tone}`.trim();
}

function syncStateFromWorkspace(workspace, options = {}) {
  state.workspace = workspace;
  if (options.ticker) {
    state.focusTicker = workspace.focusTicker || options.ticker;
    return;
  }
  state.focusTicker = workspace.boardRows?.[0]?.ticker || workspace.focusTicker || null;
}

async function loadWorkspace(overrides = {}) {
  state.viewLoading = true;
  render();

  try {
    const workspace = await api.getWorkspace({
      view: "home",
      ticker: overrides.ticker ?? undefined,
      window: overrides.window || state.researchWindow,
      date: overrides.date || state.journalDate,
    });
    syncStateFromWorkspace(workspace, overrides);
  } finally {
    state.viewLoading = false;
    render();
  }
}

function renderStateCard(title, copy, action = null, tone = "") {
  return `
    <div class="panel-body">
      <div class="state-card ${tone}">
        <div class="state-title">${escapeHtml(title)}</div>
        <div class="state-copy">${escapeHtml(copy)}</div>
        ${action ? `
          <div class="state-action">
            <button class="btn ${action.primary ? "btn-primary" : ""}" type="button" ${action.attr}="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function signalLabelVi(signal) {
  const labels = {
    STRONG_BUY: "Mạnh",
    BUY: "Tích cực",
    HOLD: "Quan sát",
    SELL: "Yếu",
    STRONG_SELL: "Rất yếu",
  };
  return labels[String(signal || "").toUpperCase()] || String(signal || "Không rõ");
}

function signalTone(signal) {
  const raw = String(signal || "").toUpperCase();
  if (raw.includes("BUY")) return "good";
  if (raw.includes("SELL")) return "bad";
  return "warn";
}

function attentionLabel(stock) {
  if (!stock) return "Chưa có";
  if (stock.confidence >= 8) return "Ưu tiên theo dõi";
  if (stock.confidence >= 6) return "Đáng chú ý";
  if (stock.confidence >= 4) return "Quan sát thêm";
  return "Độ rõ thấp";
}

function marketPulseLabel(status, regime) {
  const labels = {
    confirmed_uptrend: "Thị trường đang khỏe",
    uptrend_under_pressure: "Thị trường còn khỏe nhưng có áp lực",
    rally_attempt: "Đang hồi phục thử",
    correction: "Thị trường đang yếu",
  };
  return labels[status] || (regime === "constructive" ? "Thị trường tạm ổn" : regime === "bearish" ? "Thị trường đang yếu" : "Chưa rõ trạng thái");
}

function translateWarning(message) {
  const raw = String(message || "").trim();
  if (!raw) return "Chưa có cảnh báo cụ thể.";
  if (/foreign flow unavailable/i.test(raw)) return "Chưa có dữ liệu dòng tiền ngoại, nên độ chắc chắn giảm nhẹ.";
  if (/wyckoff read is low-confidence/i.test(raw)) return "Tín hiệu kỹ thuật chưa đủ rõ, không nên vội hành động.";
  if (/fundamentals unavailable/i.test(raw)) return "Thiếu dữ liệu cơ bản, nên đây chỉ là tín hiệu tham khảo.";
  if (/ownership unavailable/i.test(raw)) return "Thiếu dữ liệu sở hữu, nên cần thận trọng hơn khi đọc mã này.";
  if (/snapshot/i.test(raw) && /fallback/i.test(raw)) return "Giá realtime không đầy đủ, hệ thống đang dùng dữ liệu thay thế.";
  return raw;
}

function summarizeWhy(stock, workspace) {
  if (!stock) return "Chưa có mã nào để giải thích.";
  const leaderSectors = workspace.market?.sectors?.leaders?.map((row) => row.sector) || [];
  if (stock.breakout?.state === "near_trigger" && stock.breakout?.reason) {
    return `Giá đang ở gần vùng quan trọng: ${stock.breakout.reason}`;
  }
  if (leaderSectors.includes(stock.sector)) {
    return `${stock.ticker} đang nằm trong nhóm ngành mạnh hơn phần còn lại của VN30.`;
  }
  if (stock.strength?.score >= 70) {
    return `${stock.ticker} đang nằm trong nhóm mạnh hơn trung bình của rổ VN30.`;
  }
  if (stock.explain?.driversPositive?.length) {
    return stock.explain.driversPositive[0];
  }
  return `${stock.ticker} hiện là mã đang được xếp cao nhất trong snapshot hiện tại.`;
}

function summarizeRisk(stock, workspace) {
  if (!stock) return "Chưa có dữ liệu rủi ro.";
  if (stock.quality?.warnings?.length) return translateWarning(stock.quality.warnings[0]);
  if (workspace.stale) return "Snapshot hiện tại đã cũ; nên làm mới VN30 trước khi quyết định.";
  if (workspace.market?.pulse?.status === "correction") return "Thị trường chung đang yếu, nên ưu tiên phòng thủ hơn là mua mới.";
  if (stock.explain?.driversNegative?.length) return stock.explain.driversNegative[0];
  return "Chưa có rủi ro lớn nổi bật, nhưng vẫn nên đợi xác nhận thêm trước khi hành động.";
}

function summarizeAction(stock, workspace) {
  if (!stock) return "Quét VN30 để hệ thống gợi ý mã cần nhìn trước.";
  const signal = String(stock.signal || "").toUpperCase();
  if (signal === "STRONG_BUY" || signal === "BUY") {
    if (workspace.market?.pulse?.status === "correction") {
      return "Mã này nổi bật, nhưng thị trường đang yếu. Chỉ nên để vào danh sách theo dõi sát, chưa nên vội vào lệnh.";
    }
    return "Đưa mã này vào danh sách theo dõi sát. Chỉ cân nhắc hành động khi giá đi đúng các mốc bên dưới.";
  }
  if (signal === "SELL" || signal === "STRONG_SELL") {
    return "Ưu tiên phòng thủ. Không nên mua mới ở trạng thái hiện tại.";
  }
  return "Giữ ở chế độ quan sát. Chờ tín hiệu rõ hơn trước khi quyết định.";
}

function buildLevelRows(stock) {
  if (!stock) return [];
  const buyPoint = stock.entry?.[0] || stock.breakout?.triggerPrice || null;
  const stopPoint = stock.sl || stock.breakout?.invalidation || null;
  const targetOne = stock.tp?.[0] || null;
  const targetTwo = stock.tp?.[1] || null;

  return [
    { label: "Điểm mua cần nhìn", value: buyPoint },
    { label: "Mốc dừng lỗ", value: stopPoint },
    { label: "Mục tiêu gần", value: targetOne },
    { label: "Mục tiêu xa", value: targetTwo },
  ].filter((item) => item.value != null);
}

function renderHeroPanel() {
  const workspace = getWorkspace();
  const stock = focusStock();
  const activeScan = (workspace.activeTasks || []).find((task) =>
    task.type === "scan" && (task.status === "queued" || task.status === "running")
  );

  if (!workspaceReady()) {
    if (activeScan || state.viewLoading) {
      const step = activeScan?.currentStep || "Đang khởi tạo";
      return renderStateCard("Đang quét VN30", `${step}. Hệ thống sẽ tự hiện mã đứng đầu ngay khi có dữ liệu.`, null, "state-warn");
    }

    return renderStateCard(
      "Chưa có dữ liệu VN30",
      workspace.warnings?.[0] || "App sẽ tự quét VN30 khi mở lần đầu. Nếu chưa có dữ liệu, bấm nút dưới đây để thử lại.",
      { label: "Quét VN30", attr: "data-scan-mode", value: "vn30", primary: true },
      workspace.warnings?.length ? "state-bad" : ""
    );
  }

  return `
    <div class="panel-body">
      <div class="eyebrow">Hôm nay xem gì</div>
      <div class="hero-grid">
        <div class="hero-main">
          <div class="hero-ticker-row">
            <div>
              <div class="hero-ticker">${escapeHtml(stock?.ticker || "—")}</div>
              <div class="hero-name">${escapeHtml(stock?.name || "Chưa có mã")} · ${escapeHtml(stock?.sector || "—")}</div>
            </div>
            <div class="hero-price mono">${escapeHtml(fmtNumber(stock?.price))}</div>
          </div>

          <div class="inline-row">
            <span class="chip ${signalTone(stock?.signal)}">${escapeHtml(signalLabelVi(stock?.signal))}</span>
            <span class="chip">${escapeHtml(attentionLabel(stock))}</span>
            <span class="chip ${workspace.stale ? "warn" : "good"}">${workspace.stale ? "Dữ liệu cũ" : "Dữ liệu mới"}</span>
          </div>

          <div class="hero-copy">
            ${escapeHtml(marketPulseLabel(workspace.market?.pulse?.status, workspace.market?.regime))}.
            ${escapeHtml(workspace.market?.pulse?.note || "Bạn có thể bấm mã khác ở danh sách bên dưới để đổi nhanh.")}
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-item">
            <div class="mini-k">Lần quét tốt gần nhất</div>
            <div class="summary-value">${escapeHtml(fmtDateTime(workspace.lastSuccessfulScanAt))}</div>
          </div>
          <div class="summary-item">
            <div class="mini-k">Lần thử gần nhất</div>
            <div class="summary-value">${escapeHtml(fmtDateTime(workspace.lastAttemptedScanAt))}</div>
          </div>
          <div class="summary-item">
            <div class="mini-k">Số mã trong snapshot</div>
            <div class="summary-value">${escapeHtml(String(workspace.snapshotMeta?.count || 0))}</div>
          </div>
          <div class="summary-item">
            <div class="mini-k">Tình trạng nguồn</div>
            <div class="summary-value">${escapeHtml(workspace.sourceHealth?.some((item) => item.status === "down") ? "Có lỗi" : workspace.sourceHealth?.some((item) => item.status === "degraded") ? "Giảm nhẹ" : "Ổn định")}</div>
          </div>
        </div>
      </div>

      ${workspace.warnings?.length ? `
        <div class="warning-strip ${workspace.stale ? "warning-strip-bad" : "warning-strip-warn"}" style="margin-top:14px">
          ${workspace.warnings.slice(0, 2).map((warning) => `<div>${escapeHtml(translateWarning(warning))}</div>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderListPanel() {
  const workspace = getWorkspace();

  if (!workspaceReady()) {
    refs.listPanel.innerHTML = renderStateCard(
      "Danh sách mã sẽ hiện ở đây",
      "Khi quét xong VN30, bạn chỉ cần bấm vào một mã để đổi phần giải thích bên phải.",
      null
    );
    return;
  }

  const rows = topRows(10);
  refs.listPanel.innerHTML = `
    <div class="panel-body">
      <div class="eyebrow">Top VN30</div>
      <div class="panel-title">Bấm vào mã để đổi nhanh</div>
      <div class="panel-copy">Mặc định app mở mã đứng đầu snapshot. Bạn không cần dùng preset hay command để đổi mã.</div>
      <div class="ticker-list">
        ${rows.map((row, index) => `
          <button class="ticker-btn ${row.ticker === state.focusTicker ? "active" : ""}" type="button" data-select-ticker="${row.ticker}">
            <div class="ticker-rank">${index + 1}</div>
            <div class="ticker-main">
              <div class="ticker-topline">
                <strong>${escapeHtml(row.ticker)}</strong>
                <span class="ticker-signal ${signalTone(row.signal)}">${escapeHtml(signalLabelVi(row.signal))}</span>
              </div>
              <div class="ticker-copy">${escapeHtml(row.name || row.ticker)} · ${escapeHtml(row.sector || "—")}</div>
            </div>
            <div class="ticker-side">
              <div class="mono">${escapeHtml(fmtNumber(row.price))}</div>
              <div class="${toneByValue(row.sessionChangePct)}">${escapeHtml(fmtPct(row.sessionChangePct, 2))}</div>
            </div>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderFocusPanel() {
  const workspace = getWorkspace();
  const stock = focusStock();

  if (!workspaceReady() || !stock) {
    refs.focusPanel.innerHTML = renderStateCard(
      "Mã đang chọn",
      "Khi có dữ liệu, phần này sẽ giải thích ngắn gọn vì sao mã đang được ưu tiên nhìn trước.",
      null
    );
    return;
  }

  const levelRows = buildLevelRows(stock);

  refs.focusPanel.innerHTML = `
    <div class="panel-body">
      <div class="eyebrow">Mã đang chọn</div>
      <div class="panel-title">${escapeHtml(stock.ticker)} · ${escapeHtml(stock.name || stock.ticker)}</div>
      <div class="panel-copy">Đây là phần đọc nhanh dành cho người dùng phổ thông. Chỉ tập trung vào lý do nổi bật, rủi ro và hành động gợi ý.</div>

      <div class="plain-grid">
        <div class="plain-card">
          <div class="mini-k">Vì sao mã này nổi bật</div>
          <p>${escapeHtml(summarizeWhy(stock, workspace))}</p>
        </div>
        <div class="plain-card">
          <div class="mini-k">Rủi ro chính</div>
          <p>${escapeHtml(summarizeRisk(stock, workspace))}</p>
        </div>
        <div class="plain-card">
          <div class="mini-k">Hành động gợi ý</div>
          <p>${escapeHtml(summarizeAction(stock, workspace))}</p>
        </div>
        <div class="plain-card">
          <div class="mini-k">Mốc giá quan trọng</div>
          ${levelRows.length ? `
            <div class="levels-list">
              ${levelRows.map((item) => `
                <div class="levels-item">
                  <span>${escapeHtml(item.label)}</span>
                  <strong class="mono">${escapeHtml(fmtNumber(item.value))}</strong>
                </div>
              `).join("")}
            </div>
          ` : `<p>Chưa có mốc giá rõ ràng. Hãy ưu tiên quan sát thêm.</p>`}
        </div>
      </div>
    </div>
  `;
}

function renderDetailPanel() {
  const workspace = getWorkspace();
  const stock = focusStock();
  const evidence = (workspace.research?.evidence || []).slice(0, 5);
  const leaders = workspace.market?.sectors?.leaders || [];
  const sourceHealth = workspace.sourceHealth || [];

  if (!workspaceReady()) {
    refs.detailPanel.innerHTML = renderStateCard(
      "Chi tiết thêm",
      "Nguồn dữ liệu, bối cảnh thị trường và evidence sẽ hiện ở đây khi snapshot sẵn sàng.",
      null
    );
    return;
  }

  refs.detailPanel.innerHTML = `
    <div class="panel-body">
      <div class="eyebrow">Chi tiết thêm</div>
      <div class="panel-title">Chỉ mở sâu hơn khi bạn cần</div>
      <div class="details-stack">
        <details class="explainer" ${workspace.warnings?.length ? "open" : ""}>
          <summary>Cảnh báo dữ liệu</summary>
          <div class="detail-copy">
            ${workspace.warnings?.length
              ? workspace.warnings.map((warning) => `<div>• ${escapeHtml(translateWarning(warning))}</div>`).join("")
              : "Không có cảnh báo lớn trong snapshot hiện tại."}
          </div>
        </details>

        <details class="explainer">
          <summary>Bối cảnh thị trường</summary>
          <div class="detail-columns">
            <div class="plain-card">
              <div class="mini-k">Thị trường</div>
              <p>${escapeHtml(marketPulseLabel(workspace.market?.pulse?.status, workspace.market?.regime))}</p>
              <p>${escapeHtml(workspace.market?.pulse?.note || "Chưa có ghi chú thị trường.")}</p>
            </div>
            <div class="plain-card">
              <div class="mini-k">Nhóm ngành mạnh</div>
              <p>${leaders.length ? leaders.slice(0, 3).map((row) => `${row.sector} (#${row.rank})`).join(" · ") : "Chưa có dữ liệu ngành nổi bật."}</p>
              <p>${escapeHtml(stock?.sector ? `Mã đang chọn thuộc nhóm ${stock.sector}.` : "Chưa có sector cho mã đang chọn.")}</p>
            </div>
          </div>
        </details>

        <details class="explainer">
          <summary>Nguồn dữ liệu</summary>
          <div class="source-list">
            ${sourceHealth.length ? sourceHealth.map((item) => `
              <div class="source-row">
                <div>
                  <strong><span class="status-dot ${escapeHtml(item.status || "degraded")}"></span>${escapeHtml(item.name || item.id)}</strong>
                  <div class="source-copy">${escapeHtml(item.message || "Không có ghi chú")}</div>
                </div>
                <span class="chip ${item.status === "down" ? "bad" : item.status === "degraded" ? "warn" : "good"}">${escapeHtml(item.critical ? "Quan trọng" : "Phụ")}</span>
              </div>
            `).join("") : `<div class="detail-copy">Chưa có trạng thái nguồn dữ liệu.</div>`}
          </div>
        </details>

        <details class="explainer">
          <summary>Evidence và ghi chú gần nhất</summary>
          <div class="timeline">
            ${evidence.length ? evidence.map((item) => `
              <div class="timeline-item">
                <h4>${escapeHtml(item.title)}</h4>
                <div class="timeline-meta">${escapeHtml(fmtDateTime(item.publishedAt))} · ${escapeHtml(item.source)}</div>
                <div class="timeline-copy">${escapeHtml(item.note || "Không có mô tả.")}</div>
              </div>
            `).join("") : `<div class="detail-copy">Chưa có evidence mới cho mã đang chọn.</div>`}
          </div>
        </details>
      </div>
    </div>
  `;
}

function renderAdvancedTabs() {
  refs.advancedTabs.innerHTML = ADVANCED_TABS.map((tab) => `
    <button class="tab-btn ${state.advancedTab === tab.id ? "active" : ""}" type="button" data-advanced-tab="${tab.id}">
      ${escapeHtml(tab.label)}
    </button>
  `).join("");
}

function renderResearchTab() {
  const workspace = getWorkspace();
  const stock = focusStock();
  const research = workspace.research || { evidence: [], latestBriefing: null, count: 0 };

  if (!workspaceReady() || !stock) {
    return renderStateCard(
      "Chưa có mã để nghiên cứu",
      "Flow chính chưa có snapshot hoặc chưa có mã đang chọn.",
      { label: "Quét VN30", attr: "data-scan-mode", value: "vn30", primary: true }
    );
  }

  return `
    <div class="form-shell">
      <h3>Nghiên cứu cho ${escapeHtml(stock.ticker)}</h3>
      <div class="inline-row" style="margin-top:12px">
        ${["1d", "7d", "30d"].map((window) => `
          <button class="btn ${state.researchWindow === window ? "btn-primary" : ""}" type="button" data-research-window="${window}">
            ${window.toUpperCase()}
          </button>
        `).join("")}
        <button class="btn" type="button" data-refresh-research="${stock.ticker}">Làm mới evidence</button>
      </div>
      <div class="timeline" style="margin-top:16px">
        <div class="timeline-item">
          <h4>Briefing mới nhất</h4>
          <div class="timeline-copy">${escapeHtml(research.latestBriefing?.note || "Chưa có briefing mới.")}</div>
        </div>
      </div>
    </div>

    <div class="form-shell" style="margin-top:16px">
      <h3>Ghi chú tay</h3>
      <form id="researchNoteForm" class="form-grid" style="margin-top:12px">
        <input class="ghost-input" name="ticker" type="text" value="${escapeHtml(stock.ticker)}" readonly>
        <input class="ghost-input" name="title" type="text" placeholder="Tiêu đề ghi chú">
        <input class="ghost-input full" name="url" type="url" placeholder="Link nguồn nếu có">
        <textarea class="textarea full" name="note" placeholder="Viết lại điều bạn thấy quan trọng ở mã này."></textarea>
        <button class="btn btn-primary" type="submit">Lưu ghi chú</button>
      </form>
    </div>

    <div class="timeline" style="margin-top:16px">
      ${research.evidence?.map((item) => `
        <div class="timeline-item">
          <h4>${escapeHtml(item.title)}</h4>
          <div class="timeline-meta">${escapeHtml(item.source)} · ${escapeHtml(fmtDateTime(item.publishedAt))}</div>
          <div class="timeline-copy">${escapeHtml(item.note || "Không có mô tả.")}</div>
        </div>
      `).join("") || `<div class="empty">Chưa có evidence.</div>`}
    </div>
  `;
}

function serializeLadder(playbook) {
  return (playbook?.entryPlan?.ladder || [])
    .map((entry) => [entry.label || "", entry.price ?? "", entry.sizePct ?? "", entry.note || ""].join("|"))
    .join("\n");
}

function serializeTargets(playbook) {
  return (playbook?.targetPlan?.targets || [])
    .map((target) => [target.label || "", target.price ?? ""].join("|"))
    .join("\n");
}

function renderPlaybookTab() {
  const workspace = getWorkspace();
  const stock = focusStock();
  const playbook = workspace.playbook;

  if (!workspaceReady() || !stock || !playbook) {
    return renderStateCard(
      "Chưa có playbook",
      "Cần có snapshot hợp lệ và mã đang chọn trước khi chỉnh playbook.",
      { label: "Quét VN30", attr: "data-scan-mode", value: "vn30", primary: true }
    );
  }

  return `
    <div class="hero-grid">
      <div class="hero-card">
        <div class="mini-k">${escapeHtml(stock.ticker)} · Trạng thái</div>
        <div class="hero-price">${escapeHtml(playbook.state)}</div>
        <div class="hero-sub">Bias ${escapeHtml(playbook.regimeBias)} · review ${escapeHtml(fmtDateTime(playbook.nextReviewAt))}</div>
      </div>
      <div class="hero-card">
        <div class="mini-k">Tóm tắt hiện tại</div>
        <div class="hero-sub">${escapeHtml(playbook.thesis || "Chưa có thesis.")}</div>
      </div>
    </div>

    <form id="playbookForm" class="form-shell" style="margin-top:16px">
      <h3>Sửa playbook</h3>
      <div class="form-grid" style="margin-top:12px">
        <input class="ghost-input" name="ticker" type="text" value="${escapeHtml(stock.ticker)}" readonly>
        <select class="select" name="state">
          ${["draft", "armed", "active", "invalidated", "archived"].map((value) => `
            <option value="${value}" ${playbook.state === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
        <textarea class="textarea full" name="thesis" placeholder="Thesis">${escapeHtml(playbook.thesis || "")}</textarea>
        <textarea class="textarea full" name="evidenceIds" placeholder="Evidence ids, comma separated">${escapeHtml((playbook.evidenceIds || []).join(", "))}</textarea>
        <textarea class="textarea full" name="entryLadder" placeholder="Label|Price|SizePct|Note">${escapeHtml(serializeLadder(playbook))}</textarea>
        <input class="ghost-input" name="stopPrice" type="number" step="1" value="${escapeHtml(playbook.stopPlan?.price ?? "")}" placeholder="Stop price">
        <input class="ghost-input" name="invalidationPrice" type="number" step="1" value="${escapeHtml(playbook.invalidation?.price ?? "")}" placeholder="Invalidation price">
        <textarea class="textarea full" name="targets" placeholder="Label|Price">${escapeHtml(serializeTargets(playbook))}</textarea>
        <textarea class="textarea full" name="invalidationNote" placeholder="Invalidation note">${escapeHtml(playbook.invalidation?.note || "")}</textarea>
        <input class="ghost-input" name="riskTags" type="text" value="${escapeHtml((playbook.riskTags || []).join(", "))}" placeholder="risk tags">
        <input class="ghost-input" name="nextActionLabel" type="text" value="${escapeHtml(playbook.nextAction?.label || "")}" placeholder="Next action">
        <textarea class="textarea full" name="nextActionNote" placeholder="Next action note">${escapeHtml(playbook.nextAction?.note || "")}</textarea>
        <input class="ghost-input" name="nextReviewAt" type="datetime-local" value="${escapeHtml(toDateTimeLocal(playbook.nextReviewAt))}">
        <button class="btn btn-primary" type="submit">Lưu playbook</button>
      </div>
    </form>
  `;
}

function renderJournalTab() {
  const workspace = getWorkspace();
  return `
    <div class="form-shell">
      <h3>Nhật ký quyết định</h3>
      <form id="journalForm" class="form-grid" style="margin-top:12px">
        <input class="ghost-input" name="date" type="date" value="${escapeHtml(workspace.journal?.date || new Date().toISOString().slice(0, 10))}">
        <input class="ghost-input" name="ticker" type="text" value="${escapeHtml(state.focusTicker || "")}" placeholder="Ticker">
        <input class="ghost-input full" name="title" type="text" placeholder="Tiêu đề">
        <textarea class="textarea full" name="body" placeholder="Bạn đã thấy gì và tại sao nó quan trọng?"></textarea>
        <textarea class="textarea full" name="outcome" placeholder="Kết quả hoặc điều cần review lại"></textarea>
        <input class="ghost-input" name="tags" type="text" placeholder="tags, cách, nhau, bằng, dấu, phẩy">
        <button class="btn btn-primary" type="submit">Lưu nhật ký</button>
      </form>
    </div>

    <div class="timeline" style="margin-top:16px">
      ${workspace.journal?.entries?.map((entry) => `
        <div class="timeline-item">
          <h4>${escapeHtml(entry.title)}</h4>
          <div class="timeline-meta">${escapeHtml([entry.ticker || "desk", entry.category, fmtDate(entry.date)].join(" · "))}</div>
          <div class="timeline-copy">${escapeHtml(entry.body || "Không có nội dung")}${entry.outcome ? `\n\nOutcome: ${escapeHtml(entry.outcome)}` : ""}</div>
        </div>
      `).join("") || `<div class="empty">Chưa có nhật ký cho ngày này.</div>`}
    </div>
  `;
}

function renderPublishTab() {
  const workspace = getWorkspace();

  if (!workspaceReady()) {
    return renderStateCard(
      "Chưa có snapshot để xuất bản",
      "Cần có snapshot VN30 hợp lệ trước khi publish.",
      { label: "Quét VN30", attr: "data-scan-mode", value: "vn30", primary: true }
    );
  }

  return `
    <div class="hero-grid">
      <div class="hero-card">
        <div class="mini-k">Xuất bản hiện tại</div>
        <div class="hero-price">docs/</div>
        <div class="hero-sub">Snapshot ${escapeHtml(fmtDateTime(workspace.snapshotMeta?.generated))}</div>
      </div>
      <div class="hero-card">
        <div class="mini-k">Thao tác</div>
        <div class="inline-row" style="margin-top:12px">
          <button class="btn btn-primary" type="button" data-run-publish="true">Publish ngay</button>
          <a class="btn" href="${escapeHtml(state.publishPreview)}" target="_blank" rel="noreferrer">Mở docs</a>
        </div>
      </div>
    </div>
    <div class="timeline" style="margin-top:16px">
      <div class="timeline-item">
        <h4>Metadata</h4>
        <div class="timeline-copy">Generated: ${escapeHtml(fmtDateTime(workspace.snapshotMeta?.generated))}
Saved: ${escapeHtml(fmtDateTime(workspace.snapshotMeta?.savedAt))}
Rows: ${escapeHtml(String(workspace.snapshotMeta?.count || 0))}
Mode: ${escapeHtml(workspace.snapshotMeta?.scanMode || "vn30")}</div>
      </div>
    </div>
  `;
}

function renderCommandTab() {
  return `
    <div class="form-shell">
      <h3>Command</h3>
      <form id="commandForm" class="inline-row" style="margin-top:12px">
        <input class="ghost-input" id="commandInput" type="text" autocomplete="off" placeholder="Ví dụ: help, focus FPT, research FPT 7d, publish">
        <button class="btn btn-primary" type="submit">Chạy</button>
      </form>
      <div class="command-output" id="commandOutput" style="margin-top:12px">${escapeHtml(state.commandOutput)}</div>
    </div>
  `;
}

function renderAdvancedBody() {
  switch (state.advancedTab) {
    case "playbook":
      refs.advancedBody.innerHTML = renderPlaybookTab();
      break;
    case "journal":
      refs.advancedBody.innerHTML = renderJournalTab();
      break;
    case "publish":
      refs.advancedBody.innerHTML = renderPublishTab();
      break;
    case "command":
      refs.advancedBody.innerHTML = renderCommandTab();
      break;
    case "research":
    default:
      refs.advancedBody.innerHTML = renderResearchTab();
      break;
  }
}

function render() {
  renderListPanel();
  renderFocusPanel();
  renderDetailPanel();
  refs.heroPanel.innerHTML = renderHeroPanel();

  refs.refreshBtn.disabled = state.viewLoading;
  refs.advancedOverlay.classList.toggle("open", state.advancedOpen);
  renderAdvancedTabs();
  renderAdvancedBody();
}

function openAdvanced(tab = state.advancedTab) {
  state.advancedOpen = true;
  state.advancedTab = tab;
  render();
}

function closeAdvanced() {
  state.advancedOpen = false;
  render();
}

async function trackTask(task, options = {}) {
  setStatus(`${task.type} đang chờ`, "warn");
  await loadWorkspace({ ticker: options.reloadFocus === "current" ? state.focusTicker : undefined });

  let stream = null;
  let polling = null;
  let settled = false;
  let seenStatus = false;
  let streamOpened = false;
  let fallbackTimer = null;

  const stopTracking = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (stream) stream.close();
    if (polling) clearInterval(polling);
    stream = null;
    polling = null;
    fallbackTimer = null;
    state.taskStreams.delete(task.id);
  };

  const reloadWorkspace = async () => {
    if (options.reloadFocus === "top") {
      await loadWorkspace({ ticker: undefined });
      return;
    }
    await loadWorkspace({ ticker: state.focusTicker });
  };

  const handleStatus = async (taskData) => {
    if (!taskData || settled) return;
    seenStatus = true;

    if (taskData.resultRef?.previewPath) {
      state.publishPreview = taskData.resultRef.previewPath;
    }

    if (taskData.status === "completed") {
      settled = true;
      setStatus(taskData.warnings?.[0] || `${taskData.type} xong`, taskData.warnings?.length ? "warn" : "good");
      stopTracking();
      await reloadWorkspace();
      return;
    }

    if (taskData.status === "failed") {
      settled = true;
      setStatus(taskData.error || `${taskData.type} lỗi`, "bad");
      stopTracking();
      await reloadWorkspace();
      return;
    }

    setStatus(`${taskData.type}: ${taskData.currentStep}`, taskData.warnings?.length ? "warn" : "");
    await reloadWorkspace();
  };

  const startPolling = () => {
    if (polling || settled) return;
    setStatus(`Mất stream của ${task.type}, đang chuyển sang polling`, "warn");
    if (stream) {
      stream.close();
      stream = null;
    }
    polling = setInterval(async () => {
      try {
        const current = await api.getTask(task.id);
        await handleStatus(current);
      } catch (error) {
        setStatus(error.message, "bad");
        settled = true;
        stopTracking();
      }
    }, 1500);
  };

  stream = api.subscribeTask(task.id, {
    onOpen: () => {
      streamOpened = true;
    },
    onEvent: async (eventName, payload) => {
      if (eventName === "status") {
        await handleStatus(payload);
      }
    },
    onError: () => {
      if (!settled) startPolling();
    },
  });

  fallbackTimer = setTimeout(() => {
    if (!streamOpened && !seenStatus && !settled) startPolling();
  }, 1600);

  state.taskStreams.set(task.id, {
    close() {
      stopTracking();
    },
  });
}

async function runScan(mode = "vn30", extra = {}) {
  setStatus(mode === "vn30" ? "Đang làm mới VN30" : `Đang quét ${mode}`, "warn");
  const task = await api.startScanTask({ mode, ...extra });
  await trackTask(task, { reloadFocus: "top" });
}

async function runResearchRefresh(ticker = state.focusTicker) {
  if (!ticker) {
    setStatus("Hãy chọn một mã trước", "warn");
    return;
  }
  if (!workspaceReady()) {
    setStatus("Cần có snapshot VN30 hợp lệ trước", "warn");
    return;
  }
  setStatus(`Đang làm mới evidence cho ${ticker}`, "warn");
  const task = await api.startResearchTask({
    ticker,
    window: state.researchWindow,
  });
  await trackTask(task, { reloadFocus: "current" });
}

async function runPublish() {
  if (!workspaceReady()) {
    setStatus("Cần có snapshot hợp lệ trước khi publish", "warn");
    return;
  }
  setStatus("Đang publish snapshot", "warn");
  const task = await api.startPublishTask({
    selectedTicker: state.focusTicker,
  });
  await trackTask(task, { reloadFocus: "current" });
}

function serializePlaybookForm(form) {
  const formData = new FormData(form);
  return {
    state: String(formData.get("state") || "draft"),
    thesis: String(formData.get("thesis") || ""),
    evidenceIds: parseCommaList(formData.get("evidenceIds")),
    entryPlan: {
      ladder: parseLadder(formData.get("entryLadder")),
    },
    stopPlan: {
      price: Number(formData.get("stopPrice")) || null,
    },
    targetPlan: {
      targets: parseTargets(formData.get("targets")),
    },
    invalidation: {
      price: Number(formData.get("invalidationPrice")) || null,
      note: String(formData.get("invalidationNote") || ""),
    },
    riskTags: parseCommaList(formData.get("riskTags")),
    nextAction: {
      label: String(formData.get("nextActionLabel") || ""),
      note: String(formData.get("nextActionNote") || ""),
      dueAt: formData.get("nextReviewAt") ? new Date(String(formData.get("nextReviewAt"))).toISOString() : null,
    },
    nextReviewAt: formData.get("nextReviewAt") ? new Date(String(formData.get("nextReviewAt"))).toISOString() : null,
  };
}

async function executeAction(action, parsed) {
  switch (action.type) {
    case "scan.watchlist":
      await runScan("watchlist");
      return "Đã chạy scan watchlist.";
    case "scan.vn30":
      await runScan("vn30", { topN: action.topN, delayMs: action.delayMs });
      return `Đã chạy scan VN30${action.topN ? ` top ${action.topN}` : ""}.`;
    case "scan.one": {
      const result = await api.getSingleScan(action.ticker);
      state.focusTicker = action.ticker;
      await loadWorkspace({ ticker: action.ticker });
      return `Single scan ${action.ticker}\n\nSignal: ${result.signal}\nConfidence: ${result.confidence}/10\nWarnings: ${(result.quality?.warnings || []).join("; ") || "none"}`;
    }
    case "batch.scan":
      await runScan("batch", {
        tickers: action.tickers,
        topN: action.topN,
        delayMs: action.delayMs,
      });
      return `Đã chạy batch scan cho ${action.tickers.length} mã.`;
    case "focus.ticker":
      state.focusTicker = action.ticker;
      await loadWorkspace({ ticker: action.ticker });
      return `Đã chuyển focus sang ${action.ticker}.`;
    case "research.open":
      state.focusTicker = action.ticker;
      state.researchWindow = action.window;
      await loadWorkspace({ ticker: action.ticker });
      openAdvanced("research");
      if (workspaceReady()) {
        await runResearchRefresh(action.ticker);
      }
      return `Đã mở nghiên cứu cho ${action.ticker}.`;
    case "playbook.open":
      state.focusTicker = action.ticker;
      await loadWorkspace({ ticker: action.ticker });
      openAdvanced("playbook");
      return `Đã mở playbook cho ${action.ticker}.`;
    case "journal.open":
      state.journalDate = action.date;
      await loadWorkspace({ ticker: state.focusTicker, date: action.date });
      openAdvanced("journal");
      return `Đã mở nhật ký ${action.date}.`;
    case "watchlist.add":
      await api.addWatchlist(action.stock);
      return `Đã thêm ${action.stock.ticker} vào watchlist.`;
    case "watchlist.update":
      await api.updateWatchlist(action.ticker, action.patch);
      return `Đã cập nhật ${action.ticker}.`;
    case "watchlist.remove":
      await api.removeWatchlist(action.ticker);
      return `Đã xoá ${action.ticker}.`;
    case "preset.load":
      return "Simple mode không dùng preset ở giao diện chính.";
    case "prompt.open": {
      const prompt = await api.getPrompt();
      return prompt.prompt || "Không có prompt.";
    }
    case "publish.snapshot":
      openAdvanced("publish");
      if (!workspaceReady()) return "Cần có snapshot hợp lệ trước khi publish.";
      await runPublish();
      return "Đã bắt đầu publish.";
    case "help.general":
    case "help.topic":
      return parsed.help;
    default:
      return `Unsupported action ${action.type}`;
  }
}

async function handleCommandSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("commandInput");
  const output = document.getElementById("commandOutput");
  const raw = input?.value.trim() || "";
  if (!raw) return;

  try {
    const parsed = await api.parseCommand(raw);
    if (!parsed.result?.ok && parsed.result?.kind !== "help") {
      state.commandOutput = parsed.result?.error || parsed.help || "Command failed.";
    } else if (parsed.result?.kind === "help") {
      state.commandOutput = parsed.help;
    } else {
      state.commandOutput = await executeAction(parsed.result.action, parsed);
    }
  } catch (error) {
    state.commandOutput = error.message;
  }

  if (output) output.textContent = state.commandOutput;
}

async function autoScanIfNeeded() {
  const workspace = getWorkspace();
  const hasActiveScan = (workspace.activeTasks || []).some((task) =>
    task.type === "scan" && (task.status === "queued" || task.status === "running")
  );

  if (workspaceReady() || hasActiveScan || state.autoScanTriggered) return;

  state.autoScanTriggered = true;
  try {
    await runScan("vn30");
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

function bindEvents() {
  refs.refreshBtn.addEventListener("click", () => runScan("vn30"));
  refs.advancedBtn.addEventListener("click", () => openAdvanced());
  refs.closeAdvancedBtn.addEventListener("click", closeAdvanced);
  refs.advancedOverlay.addEventListener("click", (event) => {
    if (event.target === refs.advancedOverlay) closeAdvanced();
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-scan-mode],[data-select-ticker],[data-advanced-tab],[data-refresh-research],[data-research-window],[data-run-publish]");
    if (!button) return;

    try {
      if (button.dataset.scanMode) {
        await runScan(button.dataset.scanMode);
        return;
      }

      if (button.dataset.selectTicker) {
        state.focusTicker = button.dataset.selectTicker;
        await loadWorkspace({ ticker: state.focusTicker });
        return;
      }

      if (button.dataset.advancedTab) {
        openAdvanced(button.dataset.advancedTab);
        return;
      }

      if (button.dataset.researchWindow) {
        state.researchWindow = button.dataset.researchWindow;
        await loadWorkspace({ ticker: state.focusTicker, window: state.researchWindow });
        return;
      }

      if (button.dataset.refreshResearch) {
        await runResearchRefresh(button.dataset.refreshResearch);
        return;
      }

      if (button.dataset.runPublish) {
        await runPublish();
      }
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.addEventListener("submit", async (event) => {
    try {
      if (event.target.id === "researchNoteForm") {
        event.preventDefault();
        const formData = new FormData(event.target);
        await api.saveResearchNote({
          ticker: formData.get("ticker"),
          title: formData.get("title"),
          note: formData.get("note"),
          url: formData.get("url"),
        });
        setStatus("Đã lưu ghi chú", "good");
        await loadWorkspace({ ticker: state.focusTicker, window: state.researchWindow });
        return;
      }

      if (event.target.id === "playbookForm") {
        event.preventDefault();
        const payload = serializePlaybookForm(event.target);
        await api.savePlaybook(state.focusTicker, payload);
        setStatus("Đã lưu playbook", "good");
        await loadWorkspace({ ticker: state.focusTicker });
        return;
      }

      if (event.target.id === "journalForm") {
        event.preventDefault();
        const formData = new FormData(event.target);
        state.journalDate = String(formData.get("date") || "today");
        await api.saveJournal({
          date: formData.get("date"),
          ticker: formData.get("ticker"),
          title: formData.get("title"),
          body: formData.get("body"),
          outcome: formData.get("outcome"),
          tags: parseCommaList(formData.get("tags")),
        });
        setStatus("Đã lưu nhật ký", "good");
        await loadWorkspace({ ticker: state.focusTicker, date: state.journalDate });
        return;
      }

      if (event.target.id === "commandForm") {
        await handleCommandSubmit(event);
      }
    } catch (error) {
      setStatus(error.message, "bad");
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openAdvanced("command");
      return;
    }

    if (event.key === "Escape" && state.advancedOpen) {
      closeAdvanced();
    }
  });
}

async function init() {
  Object.assign(refs, {
    statusChip: document.getElementById("statusChip"),
    refreshBtn: document.getElementById("refreshBtn"),
    advancedBtn: document.getElementById("advancedBtn"),
    heroPanel: document.getElementById("heroPanel"),
    listPanel: document.getElementById("listPanel"),
    focusPanel: document.getElementById("focusPanel"),
    detailPanel: document.getElementById("detailPanel"),
    advancedOverlay: document.getElementById("advancedOverlay"),
    advancedTabs: document.getElementById("advancedTabs"),
    advancedBody: document.getElementById("advancedBody"),
    closeAdvancedBtn: document.getElementById("closeAdvancedBtn"),
  });

  bindEvents();
  setStatus("Đang tải workspace", "warn");

  try {
    await loadWorkspace();
    if (workspaceReady()) {
      setStatus("VN30 sẵn sàng", "good");
    } else {
      setStatus("Chưa có snapshot, đang chuẩn bị quét VN30", "warn");
      void autoScanIfNeeded();
    }
  } catch (error) {
    setStatus(error.message, "bad");
    refs.heroPanel.innerHTML = renderStateCard("Không tải được app", error.message, {
      label: "Thử lại",
      attr: "data-scan-mode",
      value: "vn30",
      primary: true,
    }, "state-bad");
  }
}

init();
