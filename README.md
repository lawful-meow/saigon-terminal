# Saigon Terminal

![Node 18+](https://img.shields.io/badge/node-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Market Vietnam](https://img.shields.io/badge/market-Vietnam-0f766e?style=flat-square)
![Data VPS + KBS](https://img.shields.io/badge/data-VPS%20%2B%20KBS-2563eb?style=flat-square)
![GitHub Pages Export](https://img.shields.io/badge/export-GitHub%20Pages-111827?style=flat-square&logo=github)

Board-first desk monitor for Vietnam equities.

Saigon Terminal scans a curated watchlist, ranks tickers by CAN SLIM-style strength, times entries and exits with Wyckoff structure, and publishes a clean static snapshot you can ship to GitHub Pages.

Most retail dashboards give you more widgets than decisions. This repo does the opposite: tighter universe, clearer ranking, explainable scoring, and a local-first workflow that is fast enough to actually become part of your desk.

If you are still jumping between broker tabs, spreadsheets, and half-broken screeners, this is the more opinionated setup.

## Why This Repo Is Worth Cloning

- `Board-first, not prompt-first`: the product is the ranked board and detail view. AI prompt export exists, but it is deliberately secondary.
- `Local scoring`: price, relative strength, volume behavior, IBD-style market pulse, CAN SLIM strength, and Wyckoff timing logic are computed inside the app, not outsourced to a black box.
- `Explainable output`: each factor carries observed score, coverage, warnings, and reasoning. Missing data stays `unknown`; it is not faked as neutral.
- `Publishable by default`: one API call writes `docs/index.html` and `docs/snapshot.json` so the same snapshot can be hosted on GitHub Pages.
- `Provider-aware design`: VPS drives the market/board path, KBS enriches fundamentals and ownership, and the model is already prepared for additional providers later.
- `Minimal runtime`: no framework boot chain, no package install ceremony, no frontend build step. Run it with Node 18+.

## What You Get

- Ranked market board with market header, benchmark context, IBD-style pulse proxy, breadth, turnover, and sector leaders/laggards
- Per-ticker detail layer with price action, relative strength, CAN SLIM strength rank, step-by-step Wyckoff phase/action/entry playbook, Wyckoff tests, and warnings
- History persistence in `data/scans.json`
- HTTP API for full scans, single-ticker scans, prompt export, publish flow, history, and health checks
- Static publish flow for GitHub Pages
- Clear source separation between market data, enrichment data, and local scoring

## Quick Start

### Requirements

- Node.js `18+`

### Run

```bash
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

There is no `package.json` because this repo uses Node's built-in modules plus native `fetch` from Node 18+.

### Configure Your Universe

Edit [`config.js`](./config.js) and update:

- `stocks`: watchlist / universe
- `canslim`: factor thresholds
- `volumeRules`: volume classification
- `sources`: provider endpoints, timeouts, and roadmap
- `server.port`: local server port

## Workflow

### 1. Scan the board

```bash
curl -X POST http://localhost:3000/api/scan
```

This returns a full terminal snapshot with market context, ranked stocks, and any provider errors.

### 2. Inspect one ticker

```bash
curl http://localhost:3000/api/scan/FPT
```

Useful when you want a single-symbol read without re-reading the whole board.

### 3. Export a prompt

```bash
curl http://localhost:3000/api/prompt
```

This generates a scan plus a Claude-ready prompt. The prompt is a utility, not the core product.

### 4. Publish a static snapshot

```bash
curl -X POST http://localhost:3000/api/publish
```

This writes:

- `docs/index.html`
- `docs/snapshot.json`

Commit `docs/` and enable GitHub Pages from that directory.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/scan` | Scan the configured universe and return a full snapshot |
| `POST` | `/api/publish` | Generate static output for GitHub Pages |
| `GET` | `/api/scan/:ticker` | Scan a single ticker |
| `GET` | `/api/prompt` | Scan + prompt export |
| `GET` | `/api/test` | Test VPS + KBS connectivity |
| `GET` | `/api/history` | Return stored history |
| `GET` | `/api/history/:ticker` | Return history for one ticker |
| `DELETE` | `/api/history` | Clear stored history |
| `GET` | `/api/health` | Health check |

## Scoring Semantics

Saigon Terminal is intentionally explicit about what it knows and what it does not.

- `Observed CAN SLIM`: score only across factors that have real data
- `Coverage %`: percentage of CAN SLIM factors currently observed
- `Normalized CAN SLIM`: observed score scaled back to a 70-point frame for strength math
- `Strength`: CAN SLIM-style ticker ranking layer
- `Rule Read`: final directional bias from the engine, primarily driven by Wyckoff timing state
- `Rule Strength`: strength of the rules output, not certainty
- `Quality`: composite of coverage, freshness, and source health

Important: missing factors do not silently degrade into a neutral score in the UI. They stay `unknown`.

## Data Strategy

The app does not treat any external provider as absolute truth. The internal snapshot is the canonical record, and provenance is preserved at the field level.

| Provider | Status | Role |
| --- | --- | --- |
| `VPS` | Active | Price, OHLCV, market snapshot, benchmark context |
| `KBS` | Active | Fundamentals and ownership enrichment for `C / A / I` |
| `FireAnt` | Planned | Optional secondary fundamentals path |
| `SSI` | Planned | Execution/session/security metadata |
| `FiinGroup / Vietstock` | Vendor review | Enterprise datafeed path |
| `vnstock` | Reference only | Research / prototyping |

See [`CANSLIM_SOURCES.md`](./CANSLIM_SOURCES.md) for the factor-level source matrix.

## Architecture

```text
config.js      universe, thresholds, provider roadmap
fetcher.js     VPS history/snapshot + KBS enrichment I/O
resolver.js    source precedence / canonical source flags
analyzer.js    pure metric computation + market context
rules.js       CAN SLIM strength ranking + signal logic
wyckoff.js     daily-bar Wyckoff structure, action plan, and entry logic
formatter.js   terminal snapshot + explanation layer + prompt export
store.js       JSON history persistence
engine.js      orchestration
server.js      HTTP API + static UI
publisher.js   GitHub Pages export
```

The separation matters:

- `fetcher.js` does I/O
- `analyzer.js` does math
- `rules.js` does scoring
- `wyckoff.js` turns daily bars into a structural phase, action plan, and entry map
- `engine.js` orchestrates
- `formatter.js` turns the result into something a human can read quickly

That makes the repo easier to extend without smearing business logic across the stack.

## UI And Output Surfaces

- [`public/index.html`](./public/index.html): local interactive UI
- [`docs/index.html`](./docs/index.html): published static snapshot
- [`docs/snapshot.json`](./docs/snapshot.json): publish payload
- [`data/scans.json`](./data/scans.json): persisted scan history

## Design Principles

- `Board-first`: the board is the product, not the decoration around the product
- `Explainability over mystique`: every rank should be defensible
- `Graceful degradation`: provider failures should lower confidence, not fabricate certainty
- `Local-first`: the app should still feel useful without a cloud control plane
- `Composable data model`: providers can be swapped or layered without rewriting the whole engine

## Current Limitations

- Breadth, turnover, and sector leader/laggard stats are computed from the configured universe, not the full market
- Execution-only fields such as bid/ask depth, foreign room, and order-book imbalance are not wired in yet
- Live data quality depends on public upstream endpoints and can degrade when those endpoints fail or throttle
- The watchlist is curated by config; this is a desk monitor, not a full-market discovery platform

## Why It Feels Different

A lot of side projects stop at "fetch some prices and draw a table." This one already has the shape of a real desk tool:

- opinionated ranking
- explainable signals
- provider separation
- publish flow
- extensible architecture

That combination is what makes the repo interesting. You are not cloning a toy dashboard. You are cloning a foundation you can actually trade your workflow around.
