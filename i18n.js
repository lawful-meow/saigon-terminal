const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = ["en", "vi"];

const I18N = {
  en: {
    "signal.STRONG_BUY": "Strong Bullish Bias",
    "signal.BUY": "Bullish Bias",
    "signal.HOLD": "Neutral / Mixed",
    "signal.SELL": "Bearish Bias",
    "signal.STRONG_SELL": "Strong Bearish Bias",

    "confidence.high": "high conviction",
    "confidence.medium": "moderate conviction",
    "confidence.low": "low conviction",

    "coverage.strong": "strong",
    "coverage.usable": "usable",
    "coverage.thin": "thin",

    "factor.C": "Current earnings",
    "factor.A": "Annual growth",
    "factor.N": "New highs",
    "factor.S": "Supply / demand",
    "factor.L": "Leader / laggard",
    "factor.I": "Institutional support",
    "factor.M": "Market direction",

    "metric.epsGrowthQoQ": "Quarterly EPS growth",
    "metric.epsGrowth1Y": "Annual EPS growth",
    "metric.nearHighPct": "Price vs 52W high",
    "metric.volScore": "Volume vs avg20",
    "metric.rs3m": "3M relative strength",
    "metric.institutionScore": "Institutional ownership proxy",
    "metric.marketTrend": "Market trend score",
    "metric.unknown": "unknown",
    "metric.of_52w_high": "{value} of 52W high",

    "band.unknown": "Unknown",
    "band.lt": "< {value}",
    "band.gte": ">= {value}",
    "band.range": "{lower} to {upper}",

    "warning.missing_factors": "Missing CAN SLIM factors: {factors}",
    "warning.fundamentals_unavailable": "Fundamentals unavailable",
    "warning.ownership_unavailable": "Ownership enrichment unavailable",
    "warning.foreign_unavailable": "Foreign flow unavailable",
    "warning.price_history_only": "Price is history-only fallback",
    "warning.snapshot_fallback": "Snapshot fallback: {error}",
    "warning.snapshot_stale": "Snapshot is stale",
    "warning.wyckoff_low_confidence": "Wyckoff read is low-confidence",

    "breakout.no_active_trigger": "No active trigger",
    "breakout.rs_vs_vnindex": "RS vs VNINDEX {value}",
    "breakout.near_52w_highs": "near 52W highs",
    "breakout.range_compressed": "range compressed",
    "breakout.volume": "volume {state}",
    "breakout.volume.above_avg": "above avg",
    "breakout.volume.building": "building",
    "breakout.volume.neutral": "neutral",
    "breakout.volume.dry": "dry",
    "breakout.volume.unknown": "unknown",

    "execution.sizing_available": "Sizing available from active buy plan.",
    "execution.no_valid_buy_plan": "No valid active buy plan with entry and stop exists yet.",
    "execution.avg_value_below_threshold": "Average value traded is below the minimum liquidity threshold.",
    "execution.stop_too_wide_control": "Stop distance is too wide for a controlled execution plan.",
    "execution.stop_wide_caution": "Stop distance is wide enough to require caution.",
    "execution.liquidity_near_floor": "Liquidity clears the floor but still sits near the minimum threshold.",
    "execution.turnover_lagging": "Current turnover is lagging the recent average.",

    "factor_reason.no_value": "No {metric} value is available, so {factor} stays unknown and is excluded from observed CAN SLIM.",
    "factor_reason.below": "{metric} is {value}, below {upper}, so {factorCode} scores {score}/10.",
    "factor_reason.above": "{metric} is {value}, at or above {lower}, so {factorCode} scores {score}/10.",
    "factor_reason.between": "{metric} is {value}, between {lower} and {upper}, so {factorCode} scores {score}/10.",

    "driver.rs": "RS vs VNINDEX 3M {value}",
    "driver.price_above_sma50": "Price {value} above SMA50",
    "driver.price_vs_sma50": "Price {value} vs SMA50",
    "driver.volume_high": "Volume {ratio}x avg20",
    "driver.volume_low": "Volume only {ratio}x avg20",
    "driver.rsi_healthy": "RSI {value} in healthy range",
    "driver.rsi_stretched": "RSI {value} stretched",
    "driver.market_regime": "Market regime {value}",
    "driver.canslim_strength": "CAN SLIM strength {label} ({score}/100)",
    "driver.wyckoff_label": "Wyckoff {label}",
    "driver.coverage_only": "Coverage only {value}%",

    "delta.price": "price {value}",
    "delta.signal": "signal {from}→{to}",
    "delta.wyckoff": "wyckoff {from}→{to}",
    "delta.observed_cs": "observed CS {from}→{to}",
    "delta.cs": "CS {from}→{to}",
    "delta.no_change": "no change",

    "snapshot.note": "Board data is VPS-first. KBS enriches fundamentals and ownership when available. CAN SLIM is the ticker-strength layer, while Wyckoff handles timing and entry logic. Market direction now includes an IBD-style pulse proxy and Wyckoff output includes a test checklist.",
  },
  vi: {
    "signal.STRONG_BUY": "Thiên hướng tăng mạnh",
    "signal.BUY": "Thiên hướng tăng",
    "signal.HOLD": "Trung lập / pha trộn",
    "signal.SELL": "Thiên hướng giảm",
    "signal.STRONG_SELL": "Thiên hướng giảm mạnh",

    "confidence.high": "độ tin cậy cao",
    "confidence.medium": "độ tin cậy trung bình",
    "confidence.low": "độ tin cậy thấp",

    "coverage.strong": "mạnh",
    "coverage.usable": "dùng được",
    "coverage.thin": "mỏng",

    "factor.C": "Tăng trưởng lợi nhuận quý",
    "factor.A": "Tăng trưởng lợi nhuận năm",
    "factor.N": "Động lực giá mới",
    "factor.S": "Cung / cầu",
    "factor.L": "Sức mạnh dẫn dắt",
    "factor.I": "Dòng tiền tổ chức",
    "factor.M": "Xu hướng thị trường",

    "metric.epsGrowthQoQ": "Tăng trưởng EPS quý",
    "metric.epsGrowth1Y": "Tăng trưởng EPS năm",
    "metric.nearHighPct": "Giá so với đỉnh 52 tuần",
    "metric.volScore": "Khối lượng so với trung bình 20 phiên",
    "metric.rs3m": "Sức mạnh tương đối 3 tháng",
    "metric.institutionScore": "Proxy sở hữu tổ chức",
    "metric.marketTrend": "Điểm xu hướng thị trường",
    "metric.unknown": "chưa có dữ liệu",
    "metric.of_52w_high": "{value} của đỉnh 52 tuần",

    "band.unknown": "Chưa xác định",
    "band.lt": "< {value}",
    "band.gte": ">= {value}",
    "band.range": "{lower} đến {upper}",

    "warning.missing_factors": "Thiếu yếu tố CAN SLIM: {factors}",
    "warning.fundamentals_unavailable": "Không có dữ liệu cơ bản",
    "warning.ownership_unavailable": "Không có dữ liệu sở hữu tổ chức",
    "warning.foreign_unavailable": "Không có dữ liệu dòng tiền ngoại",
    "warning.price_history_only": "Giá đang dùng fallback từ history",
    "warning.snapshot_fallback": "Snapshot fallback: {error}",
    "warning.snapshot_stale": "Snapshot đã cũ",
    "warning.wyckoff_low_confidence": "Đọc Wyckoff có độ tin cậy thấp",

    "breakout.no_active_trigger": "Chưa có trigger chủ động",
    "breakout.rs_vs_vnindex": "RS so với VNINDEX {value}",
    "breakout.near_52w_highs": "đang gần đỉnh 52 tuần",
    "breakout.range_compressed": "biên độ đang nén",
    "breakout.volume": "khối lượng {state}",
    "breakout.volume.above_avg": "trên trung bình",
    "breakout.volume.building": "đang cải thiện",
    "breakout.volume.neutral": "trung tính",
    "breakout.volume.dry": "cạn",
    "breakout.volume.unknown": "chưa rõ",

    "execution.sizing_available": "Đã có sizing từ kế hoạch mua đang hiệu lực.",
    "execution.no_valid_buy_plan": "Chưa có kế hoạch mua hợp lệ với entry và stop.",
    "execution.avg_value_below_threshold": "Giá trị giao dịch trung bình dưới ngưỡng thanh khoản tối thiểu.",
    "execution.stop_too_wide_control": "Biên stop quá rộng cho kế hoạch thực thi có kiểm soát.",
    "execution.stop_wide_caution": "Biên stop đủ rộng nên cần thận trọng.",
    "execution.liquidity_near_floor": "Thanh khoản vượt ngưỡng tối thiểu nhưng vẫn sát ngưỡng.",
    "execution.turnover_lagging": "Giá trị giao dịch hiện tại đang chậm hơn mức trung bình gần đây.",

    "factor_reason.no_value": "Không có dữ liệu {metric}, nên {factor} ở trạng thái unknown và bị loại khỏi observed CAN SLIM.",
    "factor_reason.below": "{metric} là {value}, thấp hơn {upper}, nên {factorCode} đạt {score}/10.",
    "factor_reason.above": "{metric} là {value}, bằng hoặc cao hơn {lower}, nên {factorCode} đạt {score}/10.",
    "factor_reason.between": "{metric} là {value}, nằm giữa {lower} và {upper}, nên {factorCode} đạt {score}/10.",

    "driver.rs": "RS so với VNINDEX 3M {value}",
    "driver.price_above_sma50": "Giá {value} nằm trên SMA50",
    "driver.price_vs_sma50": "Giá {value} so với SMA50",
    "driver.volume_high": "Khối lượng {ratio}x trung bình 20 phiên",
    "driver.volume_low": "Khối lượng chỉ {ratio}x trung bình 20 phiên",
    "driver.rsi_healthy": "RSI {value} trong vùng khỏe",
    "driver.rsi_stretched": "RSI {value} đang quá căng",
    "driver.market_regime": "Trạng thái thị trường {value}",
    "driver.canslim_strength": "Sức mạnh CAN SLIM {label} ({score}/100)",
    "driver.wyckoff_label": "Wyckoff {label}",
    "driver.coverage_only": "Độ phủ chỉ {value}%",

    "delta.price": "giá {value}",
    "delta.signal": "tín hiệu {from}→{to}",
    "delta.wyckoff": "wyckoff {from}→{to}",
    "delta.observed_cs": "observed CS {from}→{to}",
    "delta.cs": "CS {from}→{to}",
    "delta.no_change": "không thay đổi",

    "snapshot.note": "Dữ liệu board ưu tiên VPS. KBS bổ sung dữ liệu cơ bản và sở hữu khi khả dụng. CAN SLIM dùng để xếp hạng sức mạnh ticker, còn Wyckoff dùng cho timing và điểm vào. Market direction đã có pulse proxy theo IBD và Wyckoff output có checklist test.",
  },
};

function normalizeLanguage(language) {
  const raw = String(language || DEFAULT_LANGUAGE).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(raw) ? raw : DEFAULT_LANGUAGE;
}

function t(language, key, vars = {}) {
  const lang = normalizeLanguage(language);
  const value = I18N[lang]?.[key] ?? I18N[DEFAULT_LANGUAGE]?.[key] ?? key;
  return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

module.exports = {
  I18N,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  t,
};
