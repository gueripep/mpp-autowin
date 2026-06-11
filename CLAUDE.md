# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Chrome extension (`mpp-ev-extension/`) that injects expected-value (EV) overlays and score-rarity analytics into the [mpp.football](https://mpp.football) website — a French World Cup 2026 fantasy football pool. It also includes a standalone HTML calculator (`score_ev_rarity_calculator.html`) for offline analysis.

## Installation (no build step)

Pure vanilla JavaScript — no bundler, no transpiler, no package manager.

To load the extension locally:
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `mpp-ev-extension/`

To use the standalone calculator: open `score_ev_rarity_calculator.html` directly in any browser.

## Architecture

### Extension files (`mpp-ev-extension/`)

| File | Role |
|---|---|
| `manifest.json` | Manifest V3; runs `content.js` on `*://mpp.football/*` at `document_idle` |
| `content.js` | All logic — odds loading, probability math, DOM parsing, EV injection |
| `content.css` | Styles for injected overlays and tier badges |
| `world_cup_2026_pool_odds.json` | Static odds snapshot (~104 fixtures, decimal/fractional/American formats) |

### Data flow

1. `initOdds()` fetches the odds JSON via `chrome.runtime.getURL` and parses decimal odds into implied probabilities.
2. `processMatches()` walks match containers in the MPP DOM, extracts team names and match time, looks up odds, and runs the math pipeline.
3. A `MutationObserver` (150 ms debounce) re-triggers `processMatches()` on DOM changes caused by MPP's SPA navigation.
4. `updateX2Badge()` highlights the highest-EV contrarian pick on the current page view.

### Core math pipeline (`content.js`)

- **`normTeam()`** — French→English team name translation (30 mappings).
- **`poissonPMF(k, lam)`** — Poisson probability mass function.
- **`matchProbs(lam, mu)`** — home/draw/away probabilities from a double-Poisson model.
- **`solveExpG(pH, pD, pA)`** — grid-searches `(λ, μ)` Poisson parameters to match implied probabilities and a configurable average-goals baseline (`SCORE_EV_TOTAL_GOALS = 2.6`).
- **`buildFieldOutcomeShares()`** — models crowd pick distribution with hand-tuned biases: `FIELD_FAVORITE_ALPHA = 1.3` (crowds over-back favorites), `FIELD_DRAW_BIAS = 0.85` (under-pick draws), `FIELD_FRANCE_BIAS = 1.4` (France 40% over-weighted in this French-office context).
- **`buildScoreScores()`** — generates all 0–5 × 0–5 scores with `pTrue` (Poisson), `pHuman` (crowd estimate), `humanPct` (rarity in pool), `tier` (Easy 20pts → Ultra rare 100pts), and `ev`.
- **`crowdScoreBiasMultiplier(score, pH, pA)`** — amplifies popular scores, dampens rare ones; drives rarity tiers.

### Key tuning constants (top of `content.js`)

```js
TOURNAMENT_MATCHES = 104
SCORE_EV_TOTAL_GOALS = 2.6
SCORE_EV_FAV_BIAS = 0.28
SCORE_EV_DOG_BIAS = 0.22
FIELD_FAVORITE_ALPHA = 1.3
FIELD_DRAW_BIAS = 0.85
FIELD_FRANCE_BIAS = 1.4
```

## Testing

No automated tests. QA is manual:
- Load the extension, open a live MPP match page, inspect injected overlays in DevTools.
- Cross-check EV numbers against `score_ev_rarity_calculator.html` for parity.

## Caveats

- **Odds are a static snapshot** (early June 2026). No live-update mechanism.
- **DOM parsing is brittle**: `content.js` depends on MPP's current HTML structure. A site redesign will break selectors.
- **Crowd bias model is heuristic**, not trained on real pick-distribution data.
- **No knockout-round support**: exact-score EV degrades in extra-time scenarios.
