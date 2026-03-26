# PR Stack Audit - 2026-03-26

## Snapshot
- `origin/main` is the integration base.
- Remote branches are stacked commits, not independent PRs.
- Local WIP is preserved; no pull/merge/cherry-pick performed in this audit.

## Stacked Order (oldest -> newest)
1. `6083c9c` - stabilization-history-and-batch-summary
2. `8dfdd6a` - breakout-readiness
3. `b8e90a7` - sector-drilldown-bank-basket
4. `76a4c68` - execution-risk-card
5. `6ff9299` - sector-rotation-rank-drift

## Overlap Matrix
| Commit | Base/shared changes | Feature-specific changes | Conflict with current local WIP |
|---|---|---|---|
| `6083c9c` | `server.js`, `engine.js`, `formatter.js`, `publisher.js`, `store.js`, `watchlist.js`, `test/stabilization.test.js` | history route stabilization and batch summary semantics | `server.js`, `formatter.js` |
| `8dfdd6a` | `formatter.js`, `publisher.js`, `public/index.html` | breakout readiness surfaces | `formatter.js`, `public/index.html` |
| `b8e90a7` | `formatter.js`, `publisher.js`, `public/index.html` | sector drilldown and BANK basket summaries | `formatter.js`, `public/index.html` |
| `76a4c68` | `formatter.js`, `publisher.js`, `public/index.html` | execution risk sizing and liquidity warnings | `formatter.js`, `public/index.html` |
| `6ff9299` | `engine.js`, `formatter.js`, `publisher.js`, `store.js`, `test/stabilization.test.js`, `public/index.html` | sector rotation ranks and drift tracking | `formatter.js`, `public/index.html` |

## Local WIP Considerations
- High conflict surface exists on:
  - `server.js`
  - `formatter.js`
  - `public/index.html`
- Direct idea overlap was not found for:
  - `alerts.js`
  - `smartlists.js`
  - `commands.js`

## Safe Integration Strategy
- Do not merge all PR branches sequentially.
- Integrate by unique commit intent:
  1. branch from `main` into an integration branch
  2. cherry-pick only required commits in stacked order
  3. resolve conflicts once at integration branch level
  4. run full verification and publish
- If only the latest feature set is needed, prefer evaluating `6ff9299` stack as one candidate and pruning overlapping earlier steps.

