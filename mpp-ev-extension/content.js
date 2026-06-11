const EV_ATTR = "data-ev-injected";
const CONTRARIAN_EV_ATTR = "data-contrarian-ev";
const SCORE_EV_ATTR = "data-score-ev-injected";
const SCORE_OUTCOME_EV_ATTR = "data-score-outcome-ev-injected";

const TOURNAMENT_MATCHES = 104; // 2026 World Cup total matches

// ODDS_API_KEY is declared in config.js (gitignored) — see config.example.js
const ODDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ODDS_FETCH_DAYS = 3;

const SCORE_EV_TOTAL_GOALS = 2.6;
const SCORE_EV_FAV_BIAS = 0.28;
const SCORE_EV_DOG_BIAS = 0.22;
const SCORE_EV_MAX_GOALS = 5;

const FR_TO_EN = {
  "mexique": "mexico", "afrique du sud": "south africa", "corée du sud": "south korea",
  "tchéquie": "czech republic", "bosnie": "bosnia and herzegovina",
  "bosnie-herzégovine": "bosnia and herzegovina", "brésil": "brazil", "maroc": "morocco",
  "haïti": "haiti", "écosse": "scotland", "australie": "australia", "turquie": "turkey",
  "allemagne": "germany", "curaçao": "curacao", "pays-bas": "netherlands", "japon": "japan",
  "côte d'ivoire": "ivory coast", "suède": "sweden", "tunisie": "tunisia",
  "états-unis": "usa", "sénégal": "senegal", "irak": "iraq", "égypte": "egypt", "belgique": "belgium",
  "rd congo": "dr congo", "congo (rdc)": "dr congo", "ouzbékistan": "uzbekistan",
  "colombie": "colombia", "argentine": "argentina", "jordanie": "jordan",
  "algérie": "algeria", "autriche": "austria", "angleterre": "england",
  "nouvelle-zélande": "new zealand", "équateur": "ecuador", "espagne": "spain",
  "suisse": "switzerland", "norvège": "norway", "croatie": "croatia",
  "arabie saoudite": "saudi arabia", "cap-vert": "cape verde",
};

function normTeam(name) {
  const lower = name.toLowerCase().trim();
  return FR_TO_EN[lower] || lower;
}

let oddsLookup = null;

function registerFixture(homeTeam, awayTeam, dateStr, homeDecimal, drawDecimal, awayDecimal) {
  const dt = new Date(dateStr); // converts to user's local timezone (CEST for French users)
  const suffix = `${dt.getDate()}-${dt.getHours()}-${dt.getMinutes()}`;
  const invH = 1 / homeDecimal, invD = 1 / drawDecimal, invA = 1 / awayDecimal;
  const total = invH + invD + invA;
  const fixture = {
    homeTeam,
    awayTeam,
    probs: [invH / total, invD / total, invA / total],
  };
  oddsLookup[`${normTeam(homeTeam)}-${suffix}`] = fixture;
  oddsLookup[`${normTeam(awayTeam)}-${suffix}`] = fixture;
}

async function fetchLiveOdds() {
  const stored = await chrome.storage.local.get("odds_cache");
  if (stored.odds_cache) {
    const { ts, events } = stored.odds_cache;
    if (Date.now() - ts < ODDS_CACHE_TTL_MS) return events;
  }
  const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const allEvents = await resp.json();
  const cutoff = Date.now() + ODDS_FETCH_DAYS * 86_400_000;
  const events = allEvents.filter(e => new Date(e.commence_time).getTime() <= cutoff);
  await chrome.storage.local.set({ odds_cache: { ts: Date.now(), events } });
  return events;
}

function loadFromLiveEvents(events) {
  for (const event of events) {
    const best = {};
    for (const bk of event.bookmakers) {
      const h2h = bk.markets.find(m => m.key === "h2h");
      if (!h2h) continue;
      for (const o of h2h.outcomes) {
        if (!best[o.name] || o.price > best[o.name]) best[o.name] = o.price;
      }
    }
    const hp = best[event.home_team], dp = best["Draw"], ap = best[event.away_team];
    if (!hp || !dp || !ap) continue;
    registerFixture(event.home_team, event.away_team, event.commence_time, hp, dp, ap);
  }
}

function loadFromLocalJson(data) {
  for (const match of data) {
    if (!match.odds.home?.bookmakers?.length) continue;
    const best = side => Math.max(...match.odds[side].bookmakers.map(b => b.decimal));
    registerFixture(match.home_team, match.away_team, match.date, best("home"), best("draw"), best("away"));
  }
}

async function initOdds() {
  oddsLookup = {};

  // Always seed from local JSON first, then overwrite with live odds where available.
  const url = chrome.runtime.getURL("world_cup_2026_pool_odds.json");
  const data = await fetch(url).then(r => r.json());
  loadFromLocalJson(data);

  if (ODDS_API_KEY) {
    const events = await fetchLiveOdds().catch(() => null);
    if (events?.length) loadFromLiveEvents(events);
  }
}

let cachedDateHeaders = null;

function getDateHeaders() {
  if (cachedDateHeaders) return cachedDateHeaders;
  cachedDateHeaders = Array.from(document.querySelectorAll("div")).filter(el => {
    const t = el.textContent.trim();
    return t.length < 35 && /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d+/i.test(t);
  });
  return cachedDateHeaders;
}

function findDay(container, headers) {
  let last = null;
  for (const h of headers) {
    if (h.compareDocumentPosition(container) & 4) last = h;
  }
  if (!last) return null;
  const m = last.textContent.match(/\b(\d+)/);
  return m ? +m[1] : null;
}

function getMatchInfo(container, headers) {
  let node = container;
  let timeHour = null, timeMin = null, teamFR = null;

  for (let i = 0; i < 12; i++) {
    node = node.parentElement;
    if (!node) break;
    const text = node.textContent;
    if (!timeHour) {
      const t = text.match(/(\d{1,2})h(00|30)/);
      if (t) { timeHour = +t[1]; timeMin = +t[2]; }
    }
    if (!teamFR) {
      const t = text.match(/\d+e\s*(.+?)\s*J\./);
      if (t) teamFR = t[1].trim();
    }
    if (timeHour !== null && teamFR) break;
  }

  if (timeHour === null || !teamFR) return null;
  const day = findDay(container, headers);
  if (!day) return null;
  return { teamEN: normTeam(teamFR), hour: timeHour, min: timeMin, day };
}

function getOutcomeEV(outcomeEl) {
  if (outcomeEl.children.length !== 2) return null;
  const pct = outcomeEl.children[1].textContent.trim();
  if (!/^\d+%$/.test(pct)) return null;
  const inner = outcomeEl.children[0].querySelector("div");
  if (!inner || !/^\d+$/.test(inner.textContent.trim())) return null;
  return parseFloat(inner.textContent.trim());
}

function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(Math.max(lambda, 1e-10));
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function matchProbs(lam, mu, maxG = 8) {
  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = poissonPMF(h, lam) * poissonPMF(a, mu);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  return { homeWin, draw, awayWin };
}

function solveExpG(pH, pD, pA, totalGoals) {
  // Constrain search to lam+mu = totalGoals so the fit is preserved after normalisation.
  let bestLam = totalGoals * 0.65, bestErr = Infinity;
  for (let lam = 0.05; lam < totalGoals - 0.05; lam += 0.02) {
    const mu = totalGoals - lam;
    const { homeWin, draw, awayWin } = matchProbs(lam, mu);
    const err = (homeWin - pH) ** 2 + (draw - pD) ** 2 + (awayWin - pA) ** 2;
    if (err < bestErr) { bestErr = err; bestLam = lam; }
  }
  return { lam: bestLam, mu: totalGoals - bestLam };
}

function tierInfo(humanPct) {
  if (humanPct > 30) return { label: "Easy", pts: 20, cls: "mpp-score-tier-easy" };
  if (humanPct > 20) return { label: "Rare", pts: 30, cls: "mpp-score-tier-rare" };
  if (humanPct > 5)  return { label: "Très rare", pts: 50, cls: "mpp-score-tier-vrare" };
  if (humanPct > 0.5) return { label: "Mega rare", pts: 70, cls: "mpp-score-tier-mrare" };
  return { label: "Ultra rare", pts: 100, cls: "mpp-score-tier-ultra" };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Probability of seeing this event at least once across remaining matches (finite-horizon discount)
function finiteHorizonFactor(p) {
  return 1 - Math.pow(Math.max(0, 1 - p), TOURNAMENT_MATCHES);
}

function getScoreOutcomeIdx(score) {
  if (score.h > score.a) return 0;
  if (score.h === score.a) return 1;
  return 2;
}

function crowdScoreBiasMultiplier(score, pH, pA) {
  const favIdx = pH >= pA ? 0 : 2;
  const favProb = Math.max(pH, pA);
  const favoriteStrength = clamp((favProb - 0.55) / 0.3, 0, 1);
  const outcomeIdx = getScoreOutcomeIdx(score);
  const favGoals = favIdx === 0 ? score.h : score.a;
  const dogGoals = favIdx === 0 ? score.a : score.h;
  let multiplier = 1;

  if (outcomeIdx === favIdx) {
    if (dogGoals === 0 && (favGoals === 2 || favGoals === 3)) {
      multiplier *= 1 + 1.15 * favoriteStrength;
    } else if (dogGoals === 1 && favGoals === 2) {
      multiplier *= 1 + 0.65 * favoriteStrength;
    } else if (dogGoals === 0 && favGoals === 4) {
      multiplier *= 1 + 0.45 * favoriteStrength;
    } else if (dogGoals === 0 && favGoals === 1) {
      multiplier *= 1 + 0.25 * (1 - favoriteStrength) - 0.2 * favoriteStrength;
    }

    if (favGoals - dogGoals >= 5) {
      multiplier *= 1 - 0.35 * favoriteStrength;
    }
  } else if (outcomeIdx === 1) {
    if (score.h === 1) multiplier *= 1.35;
    else if (score.h === 0) multiplier *= 1.2;
  } else {
    if (Math.abs(score.h - score.a) === 1) multiplier *= 1.25;
    if (Math.max(score.h, score.a) >= 3) multiplier *= 0.8;
  }

  return Math.max(0.25, multiplier);
}

const scoreScoresCache = new Map(); // keyed by probs, cleared on reload

function buildScoreScores(fixture) {
  const cacheKey = fixture.probs.join(",");
  if (scoreScoresCache.has(cacheKey)) return scoreScoresCache.get(cacheKey);

  const [pH, pD, pA] = fixture.probs;
  const { lam, mu } = solveExpG(pH, pD, pA, SCORE_EV_TOTAL_GOALS);
  const favIsHome = pH >= pA;
  const lamHumanRaw = Math.max(0.1, lam + (favIsHome ? SCORE_EV_FAV_BIAS : -SCORE_EV_DOG_BIAS));
  const muHumanRaw = Math.max(0.05, mu + (favIsHome ? -SCORE_EV_DOG_BIAS : SCORE_EV_FAV_BIAS));
  const humanScale = SCORE_EV_TOTAL_GOALS / (lamHumanRaw + muHumanRaw);
  const lamHuman = lamHumanRaw * humanScale;
  const muHuman = muHumanRaw * humanScale;

  const scores = [];
  for (let h = 0; h <= SCORE_EV_MAX_GOALS; h++) {
    for (let a = 0; a <= SCORE_EV_MAX_GOALS; a++) {
      scores.push({
        h,
        a,
        pTrue: poissonPMF(h, lam) * poissonPMF(a, mu),
        pHuman: poissonPMF(h, lamHuman) * poissonPMF(a, muHuman) * crowdScoreBiasMultiplier({ h, a }, pH, pA),
      });
    }
  }

  const homeScores = scores.filter(s => s.h > s.a);
  const drawScores = scores.filter(s => s.h === s.a);
  const awayScores = scores.filter(s => s.h < s.a);
  const humanHomeTotal = homeScores.reduce((sum, s) => sum + s.pHuman, 0);
  const humanDrawTotal = drawScores.reduce((sum, s) => sum + s.pHuman, 0);
  const humanAwayTotal = awayScores.reduce((sum, s) => sum + s.pHuman, 0);

  const result = scores
    .map(s => {
      const groupTotal = s.h > s.a ? humanHomeTotal : s.h === s.a ? humanDrawTotal : humanAwayTotal;
      const humanPct = groupTotal > 0 ? (s.pHuman / groupTotal) * 100 : 0;
      const tier = tierInfo(humanPct);
      return {
        ...s,
        humanPct,
        tier,
        ev: s.pTrue * tier.pts,
      };
    });
  scoreScoresCache.set(cacheKey, result);
  return result;
}

function buildBestScorePerOutcome(fixture) {
  const best = [null, null, null];
  buildScoreScores(fixture).forEach(score => {
    const idx = getScoreOutcomeIdx(score);
    const adjEv = score.ev * finiteHorizonFactor(score.pTrue);
    if (!best[idx] || adjEv > best[idx].adjEv) best[idx] = { ...score, adjEv };
  });
  return best;
}

function buildBestScoreOutcomeEVs(fixture, outcomePoints) {
  const best = [null, null, null];

  buildScoreScores(fixture).forEach(score => {
    const idx = getScoreOutcomeIdx(score);
    const adjBonus = score.pTrue * score.tier.pts * finiteHorizonFactor(score.pTrue);
    const combinedEV = outcomePoints[idx] * fixture.probs[idx] + adjBonus;
    const candidate = { ...score, adjBonus, combinedEV };
    if (!best[idx] || candidate.combinedEV > best[idx].combinedEV) best[idx] = candidate;
  });

  return best;
}

function injectScoreEV(container, fixture) {
  if (container.hasAttribute(SCORE_EV_ATTR)) return;

  const panel = document.createElement("div");
  panel.className = "mpp-score-ev";

  const title = document.createElement("div");
  title.className = "mpp-score-ev-title";
  title.textContent = "Score EV";
  panel.appendChild(title);

  const table = document.createElement("table");
  table.className = "mpp-score-ev-table";
  table.innerHTML = `
    <thead>
      <tr><th>Outcome</th><th>Score</th><th>Rarity</th><th>Adj. Bonus</th></tr>
    </thead>
    <tbody></tbody>
  `;

  const outcomeLabels = [fixture.homeTeam, "Draw", fixture.awayTeam];
  const tbody = table.querySelector("tbody");
  buildBestScorePerOutcome(fixture).forEach((row, i) => {
    if (!row) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mpp-score-outcome-label">${outcomeLabels[i]}</td>
      <td class="mpp-score-cell">${row.h}-${row.a}</td>
      <td><span class="mpp-score-tier ${row.tier.cls}">${row.tier.label}</span></td>
      <td class="mpp-score-ev-value">${row.adjEv.toFixed(2)}</td>
    `;
    const rawEv = row.ev.toFixed(2);
    const fhf = finiteHorizonFactor(row.pTrue);
    tr.title = `${(row.pTrue * 100).toFixed(1)}% true prob; ${row.humanPct.toFixed(1)}% est. pick share; raw bonus EV ${rawEv} × finite-horizon factor ${fhf.toFixed(2)} (chance of hitting in ${TOURNAMENT_MATCHES} matches).`;
    tbody.appendChild(tr);
  });

  panel.appendChild(table);

  // DOM structure (confirmed via inspection):
  //   container → p1 → outcomesCol (124px) → flagsRow (372px) → cardBody (388px, flex-col)
  // Insert after flagsRow inside cardBody so Score EV is full-width below the flags.
  const p1 = container.parentElement;
  const outcomesCol = p1?.parentElement;
  const flagsRow = outcomesCol?.parentElement;
  const cardBody = flagsRow?.parentElement;

  if (cardBody && flagsRow) {
    cardBody.insertBefore(panel, flagsRow.nextElementSibling);
  } else if (flagsRow) {
    flagsRow.style.flexWrap = "wrap";
    panel.style.flex = "0 0 100%";
    flagsRow.appendChild(panel);
  } else {
    (outcomesCol || p1 || container).appendChild(panel);
  }
  container.setAttribute(SCORE_EV_ATTR, "1");
}


function injectScoreOutcomeEV(container, fixture, outcomePoints) {
  if (container.hasAttribute(SCORE_OUTCOME_EV_ATTR)) return;

  buildBestScoreOutcomeEVs(fixture, outcomePoints).forEach((best, i) => {
    if (!best) return;
    const evEl = document.createElement("div");
    evEl.className = i === 0 ? "mpp-score-outcome-ev mpp-score-outcome-ev-first" : "mpp-score-outcome-ev";
    evEl.textContent = best.combinedEV.toFixed(1);
    const outcomeEV = outcomePoints[i] * fixture.probs[i];
    evEl.title = `Best score+outcome EV: ${best.h}-${best.a}. ${outcomeEV.toFixed(1)} outcome EV + ${best.adjBonus.toFixed(2)} adj. score bonus (raw ${best.ev.toFixed(2)} × finite-horizon factor ${finiteHorizonFactor(best.pTrue).toFixed(2)}).`;
    container.children[i].appendChild(evEl);
  });

  container.setAttribute(SCORE_OUTCOME_EV_ATTR, "1");
}

function processMatches() {
  if (!oddsLookup) return;

  const headers = getDateHeaders();

  document.querySelectorAll("div").forEach(container => {
    if (container.children.length !== 3) return;
    const points = container.hasAttribute(EV_ATTR)
      ? null
      : Array.from(container.children).map(getOutcomeEV);
    if (points && !points.every(v => v !== null)) return;

    const info = getMatchInfo(container, headers);
    let fixture = null;
    if (info) {
      const key = `${info.teamEN}-${info.day}-${info.hour}-${info.min}`;
      fixture = oddsLookup[key];
      if (fixture) injectScoreEV(container, fixture);
    }

    if (container.hasAttribute(EV_ATTR)) return;

    if (!fixture) return;

    const probs = fixture.probs;
    const evs = points.map((pts, i) => pts * probs[i]);

    Array.from(container.children).forEach((outcome, i) => {
      const evEl = document.createElement("div");
      evEl.className = i === 0 ? "mpp-ev mpp-ev-first" : "mpp-ev";
      evEl.textContent = evs[i].toFixed(1);
      outcome.appendChild(evEl);
    });

    injectScoreOutcomeEV(container, fixture, points);

    // X2 ranking: best EV among non-chalk outcomes
    const chalkIdx = probs.indexOf(Math.max(...probs));
    let contrarianIdx = -1, contrarianEV = 0;
    evs.forEach((ev, i) => { if (i !== chalkIdx && ev > contrarianEV) { contrarianEV = ev; contrarianIdx = i; } });
    container.setAttribute(CONTRARIAN_EV_ATTR, `${contrarianEV.toFixed(2)},${contrarianIdx}`);

    container.setAttribute(EV_ATTR, "1");
  });

  updateX2Badge();
}

let pageObserver = null;
let processDebounceTimer = null;

function scheduleProcessMatches() {
  if (processDebounceTimer) return;
  processDebounceTimer = setTimeout(() => {
    processDebounceTimer = null;
    cachedDateHeaders = null;
    processMatches();
  }, 150);
}

function updateX2Badge() {
  // Disconnect observer before mutating DOM to avoid re-triggering processMatches
  if (pageObserver) pageObserver.disconnect();

  document.querySelectorAll(".mpp-x2-flag").forEach(el => el.remove());

  let bestContainer = null, bestVal = 0;
  document.querySelectorAll(`[${CONTRARIAN_EV_ATTR}]`).forEach(container => {
    const [rawVal] = container.getAttribute(CONTRARIAN_EV_ATTR).split(",");
    const val = parseFloat(rawVal);
    if (val > bestVal) { bestVal = val; bestContainer = container; }
  });

  if (bestContainer) {
    const [, rawIdx] = bestContainer.getAttribute(CONTRARIAN_EV_ATTR).split(",");
    const evEls = bestContainer.querySelectorAll(".mpp-ev");
    const target = evEls[+rawIdx] ?? evEls[evEls.length - 1];
    if (target) {
      const x2El = document.createElement("div");
      x2El.className = "mpp-x2-flag";
      x2El.textContent = "★ X2?";
      x2El.title = `Best X2 candidate on this page — highest contrarian EV (${bestVal.toFixed(1)} pts). Only deploy if you also have conviction + low ownership + plausible rare score.`;
      target.parentElement.appendChild(x2El);
    }
  }

  if (pageObserver) pageObserver.observe(document.body, { childList: true, subtree: true });
}

initOdds().then(() => {
  processMatches();
  pageObserver = new MutationObserver(scheduleProcessMatches);
  pageObserver.observe(document.body, { childList: true, subtree: true });
});
