# CAN SLIM Source Matrix

Last updated: 2026-03-25

This document maps each CAN SLIM factor in Saigon Engine to:

- the metric currently used in code
- whether that metric is valid, proxy-only, or wrong for CAN SLIM
- recommended data sources
- the next implementation target

Current scoring config lives in [config.js](./config.js), and the current metric derivation lives in [analyzer.js](./analyzer.js).

## Current Repo Status

| Factor | Current metric in code | Current source | Status | Problem |
|---|---|---|---|---|
| `C` | `epsGrowthQoQ` | `earningsGrowth || 0` from `overview` | Placeholder | Not actual quarterly EPS growth; currently degenerates to `0` when fundamentals are missing. |
| `A` | `epsGrowth1Y` | `earningsGrowth || 0` from `overview` | Placeholder | Not actual annual EPS growth; duplicates `C` logic. |
| `N` | `nearHighPct` | VPS price history | Usable proxy | Good for technical breakout/new high, but does not capture catalyst/news. |
| `S` | `volScore` | VPS price + volume | Partially valid | Volume breakout is usable, but CAN SLIM `S` also wants supply/share structure. |
| `L` | `rs3m` | VPS price history + VPS index history | Implemented phase 1 | Now should be relative 3M strength vs market benchmark, not raw stock return. |
| `I` | `foreignNetPct` | foreign flow | Wrong meaning | Institutional sponsorship is not the same as foreign flow. Foreign can only be a weak proxy. |
| `M` | `marketTrend` | VPS index history | Implemented phase 1 | Should now use market benchmarks instead of the stock's own trend. |

## Current Code References

- CAN SLIM factor mapping: [config.js#L45-L52](./config.js#L45-L52)
- Fundamentals + growth proxies: [analyzer.js#L104-L116](./analyzer.js#L104-L116)
- Relative strength proxy: [analyzer.js#L128-L130](./analyzer.js#L128-L130)
- Foreign proxy: [analyzer.js#L118-L126](./analyzer.js#L118-L126)
- Market trend proxy: [analyzer.js#L206-L212](./analyzer.js#L206-L212)

## Recommended Source Matrix

| Factor | Target metric | Primary source | Fallback source | Runtime fit | Notes |
|---|---|---|---|---|---|
| `C` | Quarterly EPS growth YoY, or quarterly net profit attributable to parent YoY | [FiinTrade Snapshot](https://web.fiintrade.vn/en/features/fundamental/snapshot/), [FiinTrade Financial Statement](https://web.fiintrade.vn/en/features/fundamental/financial-statement/), [Vietstock DataFeed](https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep?language=en) | Official disclosures from exchanges/issuer IR pages | Needs new provider | Prefer EPS YoY. If bank/insurance EPS is noisy, use parent NPAT YoY as fallback. |
| `A` | Annual EPS growth, 3Y EPS CAGR, ROE, margin trend | [FiinTrade Financial Analysis](https://web.fiintrade.vn/en/features/fundamental/financial-analysis/), [FiinTrade Snapshot](https://web.fiintrade.vn/en/features/fundamental/snapshot/), [Vietstock DataFeed](https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep?language=en) | Official annual reports / audited annual financial statements | Needs new provider | `A` should not reuse the same metric as `C`. |
| `N` | 3M/6M/12M new high, breakout from base, optional catalyst flags | VPS history: [FPT example](https://histdatafeed.vps.com.vn/tradingview/history?symbol=FPT&resolution=D&from=1742860800&to=1743465600) | News/disclosure feed for catalyst overlay | Can do now | VPS already supports the technical half of `N`. News is optional phase 2. |
| `S` | Volume breakout + outstanding shares / free float / share issuance / treasury activity | VPS for realtime volume, plus [Vietstock DataFeed](https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep?language=en) or [FiinTrade Ownership](https://web.fiintrade.vn/en/features/fundamental/ownership/) for share structure | Exchange profile pages / company profile pages | Partial now | Keep current volume ratio, then upgrade `S` with supply-side fields. |
| `L` | Relative strength vs `VNINDEX`/`VN30` and optionally sector peers | VPS index history: [VNINDEX](https://histdatafeed.vps.com.vn/tradingview/history?symbol=VNINDEX&resolution=D&from=1742860800&to=1743465600), [VN30](https://histdatafeed.vps.com.vn/tradingview/history?symbol=VN30&resolution=D&from=1742860800&to=1743465600) | Sector benchmark from vendor dataset | Can do now | This is the cheapest high-value fix after `M`. |
| `I` | Institutional ownership, sponsor count trend, fund/major-holder changes | [FiinTrade Ownership](https://web.fiintrade.vn/en/features/fundamental/ownership/), [Vietstock DataFeed](https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep?language=en) | Foreign flow as weak proxy only | Needs new provider | Do not treat foreign flow as the canonical `I`. |
| `M` | Market regime from `VNINDEX`/`VN30` trend, breadth, distribution days | VPS index history: [VNINDEX](https://histdatafeed.vps.com.vn/tradingview/history?symbol=VNINDEX&resolution=D&from=1742860800&to=1743465600), [VN30](https://histdatafeed.vps.com.vn/tradingview/history?symbol=VN30&resolution=D&from=1742860800&to=1743465600) | Exchange market statistics, breadth from vendor | Can do now | `M` should be market-level, not stock-level. |

## Source Recommendations By Cost / Complexity

### Option 1: Lowest complexity

- Keep **VPS** for realtime prices, daily bars, and index history.
- Add **Vietstock DataFeed** for fundamentals, profiles, and ownership.

Why:

- Vietstock explicitly advertises **API / Sync Data** delivery.
- Coverage includes:
  - financial statements
  - financial ratios
  - company data
  - key shareholders
  - director/shareholder transactions
  - foreign trading
  - index and stock datasets

Reference: [Vietstock DataFeed](https://dichvu.vietstock.vn/du-lieu-tai-chinh/datafeed---du-lieu-tai-chinh-tich-hop-chuyen-nghiep?language=en)

### Option 2: Best functional fit for CAN SLIM research

- Keep **VPS** for market data.
- Add **FiinTrade** for:
  - company snapshot
  - financial statement
  - financial analysis
  - ownership
  - consensus
  - top foreign trading / money flow / ranking

Why:

- FiinTrade's feature coverage aligns naturally with a CAN SLIM-style workflow.
- Public pages clearly show the product has the right modules, but public API docs are not exposed in the same way as Vietstock.

References:

- [FiinTrade Overview](https://web.fiintrade.vn/en/features/overview)
- [FiinTrade Snapshot](https://web.fiintrade.vn/en/features/fundamental/snapshot/)
- [FiinTrade Financial Statement](https://web.fiintrade.vn/en/features/fundamental/financial-statement/)
- [FiinTrade Financial Analysis](https://web.fiintrade.vn/en/features/fundamental/financial-analysis/)
- [FiinTrade Ownership](https://web.fiintrade.vn/en/features/fundamental/ownership/)
- [FiinTrade Consensus Analysis](https://web.fiintrade.vn/en/features/fundamental/consensus-analysis/)

### Option 3: Official-source fallback

Use official exchange and issuer disclosure pages only as fallback or audit sources, not as the primary runtime data layer.

Reasons:

- coverage is fragmented
- formats are inconsistent
- scraping is brittle
- historical normalization becomes expensive

References:

- [HNX Information Disclosure](https://www.hnx.vn/en-gb/thong-tin-cong-bo-ny-hnx.html)
- [HSX File DataFeed](https://datafeed.hsx.vn/)

## Recommended Replacement Metrics

These are the target metrics that should replace the current weak proxies:

| Factor | Replace current metric with |
|---|---|
| `C` | `quarterlyEpsYoY` |
| `A` | `annualEpsGrowth` and optionally `roe` / `threeYearEpsCagr` |
| `N` | `newHigh252dPct` or `breakoutScore` |
| `S` | `volumeBreakoutScore` + `supplyConstraintScore` |
| `L` | `relativeStrengthVsVNIndex` and optionally `relativeStrengthVsSector` |
| `I` | `institutionalSponsorshipScore` |
| `M` | `marketRegimeScore` built from `VNINDEX` / `VN30` |

## Implementation Order

1. Keep `N` and the volume half of `S` on VPS.
2. Add a fundamentals provider for `C` and `A`.
3. Add ownership / institutional provider for `I`.
4. Upgrade `S` with share structure and float data.

## Bottom Line

- **Can do now with VPS only:** `N`, most of `M`, a better `L`, and the volume half of `S`
- **Needs a second provider:** `C`, `A`, `I`, and the supply-side half of `S`
- **Best practical stack:** `VPS + Vietstock DataFeed`
- **Best research-friendly stack:** `VPS + FiinTrade`
