# MPP EV Injector

A Chrome extension that overlays **expected value (EV)** and **score rarity analytics** directly on [mpp.football](https://mpp.football) — a French World Cup 2026 fantasy football pool.

It also includes a standalone HTML calculator (`score_ev_rarity_calculator.html`) for offline analysis.

## Installation

No build step required — pure vanilla JavaScript.

1. Clone or download this repo
2. Copy the API key config:
   ```
   cp mpp-ev-extension/config.example.js mpp-ev-extension/config.js
   ```
3. (Optional) Add your free API key from [the-odds-api.com](https://the-odds-api.com) to `config.js` for live odds. Without it, the extension falls back to the bundled static odds snapshot.
4. Open `chrome://extensions/` in Chrome
5. Enable **Developer mode** (top right)
6. Click **Load unpacked** → select the `mpp-ev-extension/` folder
7. Navigate to [mpp.football](https://mpp.football) — overlays appear automatically

## What it does

- Injects an **EV overlay** on each match outcome showing the expected points value of picking that result
- Shows a **score rarity badge** on each possible scoreline (Easy → Ultra Rare) with its EV
- Highlights the highest-EV contrarian pick on the current page

## Odds data

The extension uses two sources, merged automatically:

| Source | Coverage | Notes |
|---|---|---|
| `world_cup_2026_pool_odds.json` | Full tournament (104 matches) | Static snapshot, always available |
| [the-odds-api.com](https://the-odds-api.com) | Next 3 days | Live odds, requires free API key |

Live odds take precedence over the static snapshot for upcoming matches.

## Standalone calculator

Open `score_ev_rarity_calculator.html` directly in any browser — no extension or server needed.

## Configuration

Key tuning constants are at the top of `mpp-ev-extension/content.js`:

| Constant | Default | Description |
|---|---|---|
| `SCORE_EV_TOTAL_GOALS` | `2.6` | Expected goals baseline for the Poisson model |
| `FIELD_FAVORITE_ALPHA` | `1.3` | Crowd over-weighting of favorites |
| `FIELD_DRAW_BIAS` | `0.85` | Crowd under-picking of draws |
| `FIELD_FRANCE_BIAS` | `1.4` | France over-weighting (French office pool context) |
