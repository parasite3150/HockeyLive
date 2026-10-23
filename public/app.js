import * as P from "./parse.js";

// =================================================================== Helpers

/** Builds an element. Children are text or nodes; text is never parsed as HTML. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const ICONS = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
function icon(name, size = 22) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];   // fixed strings above, never site data
  return svg;
}

function flag(code, large = false) {
  const url = P.flagURL(code);
  if (!url) return h("span", { class: `flag${large ? " lg" : ""}` });
  return h("img", { class: `flag${large ? " lg" : ""}`, src: url, alt: "", loading: "lazy", onerror: (e) => { e.target.style.visibility = "hidden"; } });
}

const timeText = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayTitle(key) {
  const d = P.keyToDate(key);
  const opts = { weekday: "long", day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}
function relativeLabel(key) {
  const t = P.today();
  if (key === t) return "Today";
  if (key === P.addDays(t, -1)) return "Yesterday";
  if (key === P.addDays(t, 1)) return "Tomorrow";
  return null;
}
const spinnerRow = (label = "Loading…") => h("div", { class: "message" }, h("span", { class: "spinner" }), label);

// =================================================================== Data access (through /api/fih)

async function fetchDoc(path) {
  const res = await fetch(`/api/fih?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`The FIH site answered with error ${res.status}.`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}
async function fetchMatchStats(id) {
  const res = await fetch(`/api/fih?stats=${id}`);
  if (!res.ok) throw new Error(`The statistics service answered with error ${res.status}.`);
  return res.json();
}

// =================================================================== State

const S = {
  tournaments: new Map(),   // id → tournament from the competition list
  matchCache: new Map(),    // tournament id → its matches
  matchIndex: new Map(),    // match id → match (for the match screen header)
  loading: new Set(),
  failed: new Set(),
  nextPage: 1,
  hasMore: true,
  loadingCatalog: false,
  catalogError: null,
  jumping: false,
  pinned: new Set([P.today()]),   // days shown even with nothing on: today, dates jumped to
  days: [P.today()],
  selected: P.today(),
  lastUpdated: null,
  matchDetails: new Map(),  // match id → { detail, stats, detailError, statsError }
  tournamentData: new Map(),// tournament id → { standings, stats, standingsError, statsError }
};

let renderQueued = false;
function changed() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function covering(key) {
  return [...S.tournaments.values()]
    .filter((t) => P.addDays(t.startKey, -1) <= key && key <= P.addDays(t.endKey, 1))   // ±1 day for time zones
    .sort((a, b) => a.startKey.localeCompare(b.startKey));
}

function rebuildDays() {
  const keys = new Set(S.pinned);
  for (const t of S.tournaments.values()) P.dayRange(t.startKey, t.endKey).forEach((k) => keys.add(k));
  for (const list of S.matchCache.values()) list.forEach((m) => keys.add(P.dayKey(m.start)));
  S.days = [...keys].sort();
}

async function loadCatalogPage(page) {
  S.loadingCatalog = true;
  try {
    const { tournaments, hasMore } = P.parseCatalog(await fetchDoc(`/competitions?view=all&page=${page}`));
    tournaments.forEach((t) => S.tournaments.set(t.id, t));
    if (page === S.nextPage) { S.nextPage += 1; S.hasMore = hasMore; }
    S.catalogError = null;
    S.lastUpdated = new Date();
    rebuildDays();
  } catch (e) {
    S.catalogError = e.message;
  } finally {
    S.loadingCatalog = false;
    changed();
  }
}
async function loadNextCatalogPage() {
  if (!S.hasMore || S.loadingCatalog) return;
  await loadCatalogPage(S.nextPage);
}

async function loadMatches(id, force = false) {
  if (S.loading.has(id) || (!force && S.matchCache.has(id))) return;
  S.loading.add(id);
  changed();
  try {
    const matches = P.parseMatchListing(await fetchDoc(`/competitions/${id}/matches`), id);
    S.matchCache.set(id, matches);
    matches.forEach((m) => S.matchIndex.set(m.id, m));
    S.failed.delete(id);
    rebuildDays();
  } catch {
    S.failed.add(id);
  } finally {
    S.loading.delete(id);
    changed();
  }
}

/** Load what a day (and the days either side) needs; fetch older tournaments near the start. */
async function ensureDay(key) {
  const i = S.days.indexOf(key);
  if (i >= 0 && i <= 3 && S.hasMore) await loadNextCatalogPage();
  const ids = new Set([key, P.addDays(key, -1), P.addDays(key, 1)].flatMap((k) => covering(k)).map((t) => t.id));
  await Promise.all([...ids].map((id) => loadMatches(id)));
}

function selectDay(key) {
  S.selected = key;
  changed();
  ensureDay(key);
}
function move(step) {
  const i = S.days.indexOf(S.selected);
  const next = S.days[i + step];
  if (next) selectDay(next);
}
async function jumpTo(key) {
  if (!key) return;
  S.pinned.add(key);
  S.jumping = true;
  changed();
  const oldest = () => [...S.tournaments.values()].map((t) => t.startKey).sort()[0] ?? "9999";
  while (S.hasMore && oldest() > key) {
    if (S.loadingCatalog) await new Promise((r) => setTimeout(r, 200));
    else { await loadNextCatalogPage(); if (S.catalogError) break; }
  }
  S.jumping = false;
  rebuildDays();
  selectDay(key);
}

function sectionsFor(key) {
  const dayMatches = [...S.matchCache.values()].flat()
    .filter((m) => P.dayKey(m.start) === key)
    .sort((a, b) => a.start - b.start);
  const groups = new Map();
  for (const m of dayMatches) {
    if (!groups.has(m.competitionID)) groups.set(m.competitionID, { id: m.competitionID, name: m.competition, matches: [] });
    groups.get(m.competitionID).matches.push(m);
  }
  return [...groups.values()];
}
const isLoadingDay = (key) => covering(key).some((t) => S.loading.has(t.id) || (!S.matchCache.has(t.id) && !S.failed.has(t.id)));
const hasFailures = (key) => covering(key).some((t) => S.failed.has(t.id));

async function refreshHome() {
  await loadCatalogPage(1);
  const ids = new Set([...covering(S.selected), ...covering(P.today())].map((t) => t.id));
  await Promise.all([...ids].map((id) => loadMatches(id, true)));
  S.lastUpdated = new Date();
  changed();
}

async function loadMatchDetail(id) {
  const entry = S.matchDetails.get(id) ?? {};
  S.matchDetails.set(id, entry);
  await Promise.all([
    fetchDoc(`/matches/${id}`)
      .then((doc) => { entry.detail = P.parseMatchPage(doc); entry.detailError = null; })
      .catch((e) => { entry.detailError = e.message; })
      .finally(changed),
    fetchMatchStats(id)
      .then((json) => { entry.stats = P.parseMatchStats(json); entry.statsError = null; })
      .catch((e) => { entry.statsError = e.message; })
      .finally(changed),
  ]);
}

async function loadTournament(id) {
  const entry = S.tournamentData.get(id) ?? {};
  S.tournamentData.set(id, entry);
  await Promise.all([
    loadMatches(id, true),
    fetchDoc(`/competitions/${id}/pools`)
      .then((doc) => { entry.standings = P.parseStandings(doc); entry.standingsError = null; })
      .catch((e) => { entry.standingsError = e.message; })
      .finally(changed),
    fetchDoc(`/competitions/${id}/statistics`)
      .then((doc) => { entry.stats = P.parseTournamentStats(doc); entry.statsError = null; })
      .catch((e) => { entry.statsError = e.message; })
      .finally(changed),
  ]);
}

// =================================================================== Routing
// #/            day list
// #/m/123/goals match screen (tab optional)
// #/t/1926/standings tournament screen (tab optional)

function route() {
  const [name, id, tab] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "home", id: Number(id), tab };
}
function setTab(tab) {
  const r = route();
  history.replaceState(null, "", `#/${r.name}/${r.id}/${tab}`);
  render();
}
let inAppSteps = 0;
function goBack() {
  if (inAppSteps > 0) history.back();
  else location.hash = "#/";
}
function goHome() { location.hash = "#/"; }

window.addEventListener("hashchange", () => {
  inAppSteps = route().name === "home" ? 0 : inAppSteps + 1;
  window.scrollTo(0, 0);
  onRoute();
});

function onRoute() {
  const r = route();
  render();
  if (r.name === "m" && r.id) loadMatchDetail(r.id);
  if (r.name === "t" && r.id) loadTournament(r.id);
}

// =================================================================== Rendering

const topbar = document.getElementById("topbar");
const view = document.getElementById("view");

function render() {
  const r = route();
  if (r.name === "m" && r.id) renderMatch(r.id, r.tab);
  else if (r.name === "t" && r.id) renderTournament(r.id, r.tab);
  else renderHome();
}

function subBar(title, sub) {
  return h("div", { class: "bar" },
    h("button", { class: "icon-btn", onclick: goBack, "aria-label": "Back" }, icon("left")),
    h("div", { class: "bar-title" }, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null),
    h("button", { class: "icon-btn", onclick: goHome, "aria-label": "Home" }, icon("home")));
}

function segmented(tabs, current) {
  return h("div", { class: "seg", role: "tablist" },
    tabs.map(([key, label]) => h("button", {
      role: "tab", "aria-selected": String(key === current), onclick: () => setTab(key),
    }, label)));
}

function section(head, body, foot) {
  return h("section", { class: "section" },
    head ? h("div", { class: "section-head" }, head) : null,
    h("div", { class: "list" }, body),
    foot ? h("div", { class: "section-foot" }, foot) : null);
}

function message(title, detail, action) {
  return h("div", { class: "message" }, title ? h("strong", {}, title) : null, detail, action);
}

// ---------- Match row (used on the day list and the tournament screen)

function matchRow(m, { showCompetition = false } = {}) {
  const state = P.matchState(m.status);
  const showScore = state !== "upcoming";
  const team = (code, score) => h("div", { class: "team" },
    flag(code), h("span", { class: "name" }, P.countryName(code)),
    showScore && score != null ? h("span", { class: "score num" }, score) : null);
  const caption = [showCompetition ? m.competition : null, m.number ? `Match ${m.number}` : null, m.stage, m.venue]
    .filter(Boolean).join(" · ");
  return h("a", { class: `row ${state}`, href: `#/m/${m.id}` },
    h("div", { class: "time" },
      h("span", { class: "t num" }, timeText(m.start)),
      state === "live" ? h("span", { class: "badge-live" }, "LIVE") : null,
      state === "finished" ? h("span", { class: "badge-ft" }, "FT") : null,
      state === "finished" && m.scoreNote ? h("span", { class: "caption" }, m.scoreNote) : null),
    h("div", { class: "teams" }, team(m.home, m.homeScore), team(m.away, m.awayScore), h("div", { class: "caption" }, caption)),
    h("span", { class: "chev" }, icon("right", 16)));
}

// ---------- Day list

function renderHome() {
  const key = S.selected;
  const i = S.days.indexOf(key);
  const rel = relativeLabel(key);

  const dateInput = h("input", {
    type: "date", value: key, "aria-label": "Choose a date",
    onchange: (e) => jumpTo(e.target.value),
  });
  topbar.replaceChildren(
    h("div", { class: "bar" },
      h("button", { class: "icon-btn", onclick: () => move(-1), disabled: i <= 0, "aria-label": "Previous day" }, icon("left")),
      h("div", { class: "bar-title" }, h("h1", {}, dayTitle(key)), h("div", { class: "sub" }, rel ?? " ")),
      h("button", { class: "icon-btn", onclick: () => move(1), disabled: i < 0 || i >= S.days.length - 1, "aria-label": "Next day" }, icon("right"))),
    h("div", { class: "tools" },
      h("button", { class: "pill", onclick: () => selectDay(P.today()), disabled: key === P.today() }, "Today"),
      h("label", { class: "pill" }, icon("calendar", 15), "Choose date", dateInput)));

  const parts = [];
  if (S.jumping) parts.push(section(null, spinnerRow("Loading older tournaments…")));

  for (const sec of sectionsFor(key)) {
    parts.push(section(
      h("a", { href: `#/t/${sec.id}` }, sec.name, " ›"),
      sec.matches.map((m) => matchRow(m))));
  }

  const loading = isLoadingDay(key) || (S.loadingCatalog && !S.tournaments.size);
  if (loading) {
    parts.push(section(null, spinnerRow("Loading matches…")));
  } else if (!sectionsFor(key).length) {
    const title = key === P.today() ? "No matches today" : "No matches on this day";
    parts.push(section(null, S.catalogError && !S.tournaments.size
      ? message(title, `Couldn't load tournaments: ${S.catalogError}`,
          h("div", {}, h("button", { class: "pill", onclick: refreshHome, style: "margin-top:10px" }, "Try again")))
      : message(title, "Swipe or use the arrows to see other days.")));
  }
  if (hasFailures(key)) {
    parts.push(section(null, message(null, "Some tournaments couldn't be loaded. ",
      h("button", { class: "pill", onclick: refreshHome }, "Try again"))));
  }
  parts.push(h("div", { class: "section-foot" },
    "Times are shown in your time zone. Swipe left or right to change day.",
    S.lastUpdated ? `\nUpdated ${S.lastUpdated.toLocaleTimeString()}` : ""));
  view.replaceChildren(...parts);
}

// Swipe left/right on the day list.
let touchStart = null;
view.addEventListener("touchstart", (e) => {
  if (route().name !== "home" || e.touches.length !== 1) return;
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
view.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
});
document.addEventListener("keydown", (e) => {
  if (route().name !== "home" || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") move(-1);
  if (e.key === "ArrowRight") move(1);
});

// ---------- Match screen

const MATCH_TABS = [["lineups", "Lineups"], ["goals", "Goals"], ["cards", "Cards"], ["stats", "Stats"], ["h2h", "H2H"]];

function renderMatch(id, tab = "lineups") {
  if (!MATCH_TABS.some(([k]) => k === tab)) tab = "lineups";
  const base = S.matchIndex.get(id);
  const entry = S.matchDetails.get(id) ?? {};
  const d = entry.detail;

  topbar.replaceChildren(subBar(base?.number ? `Match ${base.number}` : "Match", null));

  const status = d?.status || base?.status || "";
  const state = P.matchState(status);
  const homeCode = base?.home ?? d?.home?.code;
  const awayCode = base?.away ?? d?.away?.code;
  const homeName = base ? P.countryName(base.home) : d?.home?.name ?? "";
  const awayName = base ? P.countryName(base.away) : d?.away?.name ?? "";
  const competition = base?.competition ?? d?.competition;
  const stage = base?.stage ?? d?.stage;
  const score = d?.scoreline || (base && base.homeScore != null ? `${base.homeScore} - ${base.awayScore}` : "–");

  const compLine = [competition, stage].filter(Boolean).join(" · ");
  const head = h("div", { class: "match-head" },
    base?.competitionID ? h("a", { class: "comp", href: `#/t/${base.competitionID}` }, compLine, " ›") : h("div", { class: "comp" }, compLine),
    h("div", { class: "sides" },
      h("div", { class: "side" }, flag(homeCode, true), homeName),
      h("div", {},
        h("div", { class: `big num${state === "live" ? " live" : ""}` }, state === "upcoming" && base ? timeText(base.start) : score),
        h("div", { class: `status${state === "live" ? " live" : ""}` }, state === "live" ? `LIVE · ${status}` : status),
        base?.scoreNote ? h("div", { class: "meta" }, base.scoreNote) : null),
      h("div", { class: "side" }, flag(awayCode, true), awayName)),
    base ? h("div", { class: "meta" },
      [base.start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), base.venue].filter(Boolean).join(" · ")) : null);

  let body;
  if (tab === "stats") body = matchStatsTab(entry, homeCode, awayCode);
  else if (d) body = { lineups: lineupsTab, goals: goalsTab, cards: cardsTab, h2h: h2hTab }[tab](d, state);
  else if (entry.detailError) body = section(null, message(null, `Couldn't load this match: ${entry.detailError}`));
  else body = section(null, spinnerRow());

  view.replaceChildren(...[head, segmented(MATCH_TABS, tab), body].flat(Infinity).filter(Boolean));
}

function lineupsTab(d) {
  if (d.lineups.every((t) => !t.players.length)) return section(null, message(null, "Lineups haven't been published yet."));
  const playerRow = (p) => h("div", { class: "row" },
    h("span", { class: "shirt num" }, p.number),
    h("span", { class: "grow" }, p.name, " ", p.gk ? h("span", { class: "tag" }, "GK") : null, " ", p.captain ? h("span", { class: "tag" }, "C") : null),
    p.events.length ? h("span", { class: "events num" }, p.events.map((e) => h("span", {},
      ["G", "Y", "R"].includes(e.kind) ? h("span", { class: `card-chip card-${e.kind}`, title: "Card" }) : h("span", { class: "dot", title: "Goal" }),
      `${e.minute}'`))) : null);
  return d.lineups.flatMap((team) => [
    section(`${team.team} · Starting XI`, team.players.filter((p) => p.started).map(playerRow)),
    team.players.some((p) => !p.started) ? section(`${team.team} · Substitutes`, team.players.filter((p) => !p.started).map(playerRow)) : null,
    team.staff.length ? section(`${team.team} · Staff`, team.staff.map((s) => h("div", { class: "row" },
      h("span", { style: "width:90px;color:var(--muted)" }, s.role.charAt(0) + s.role.slice(1).toLowerCase()), s.name))) : null,
  ]);
}

function goalsTab(d, state) {
  if (!d.goals.length) return section(null, message(null, state === "upcoming" ? "The match hasn't started yet." : "No goals."));
  return section(null, d.goals.map((g) => h("div", { class: "row" },
    h("span", { class: "minute num" }, `${g.minute}'`),
    h("div", { class: "grow" }, h("div", {}, `#${g.shirt} ${g.player}`), h("div", { class: "caption" }, `${g.team} · ${g.action}`)),
    h("strong", { class: "num" }, g.score))));
}

function cardsTab(d, state) {
  if (!d.cards.length) return section(null, message(null, state === "upcoming" ? "The match hasn't started yet." : "No cards."));
  return section(null, d.cards.map((c) => h("div", { class: "row" },
    h("span", { class: "minute num" }, `${c.minute}'`),
    h("span", { class: `card-chip card-${c.type.toUpperCase()}` }),
    h("div", { class: "grow" }, h("div", {}, `#${c.shirt} ${c.player}`),
      h("div", { class: "caption" }, [c.team, c.umpire ? `Umpire: ${c.umpire}` : null].filter(Boolean).join(" · "))))),
    "Green = 2 min suspension, yellow = 5–10 min, red = sent off.");
}

function matchStatsTab(entry, homeCode, awayCode) {
  if (!entry.stats) {
    return entry.statsError ? section(null, message(null, `Couldn't load statistics: ${entry.statsError}`)) : section(null, spinnerRow());
  }
  if (!entry.stats.length) return section(null, message(null, "No statistics for this match yet."));
  return entry.stats.map((table) => section(table.title, [
    h("div", { class: "versus head" }, h("span", { class: "h" }, homeCode ?? ""), h("span"), h("span", { class: "a" }, awayCode ?? "")),
    ...table.rows.map((r) => h("div", { class: "versus num" },
      h("span", { class: "h" }, r.home), h("span", { class: "label" }, r.label), h("span", { class: "a" }, r.away))),
  ]));
}

function h2hTab(d) {
  if (!d.headToHead.length) return section(null, message(null, "These teams haven't met before."));
  return d.headToHead.map((g) => section(g.category, g.matches.map((m) =>
    h("a", { class: "row", href: `#/m/${m.id}` },
      h("div", { class: "grow" },
        h("div", { style: "display:flex;justify-content:space-between;gap:8px" }, h("strong", {}, m.teams), h("strong", { class: "num" }, m.scoreline)),
        h("div", { class: "caption" }, `${m.competition} · ${m.date}`),
        m.isThisMatch ? h("div", { class: "this-match" }, "This match") : null)))));
}

// ---------- Tournament screen

const TOURNAMENT_TABS = [["matches", "Matches"], ["standings", "Standings"], ["statistics", "Statistics"]];

function renderTournament(id, tab = "matches") {
  if (!TOURNAMENT_TABS.some(([k]) => k === tab)) tab = "matches";
  const matches = S.matchCache.get(id);
  const info = S.tournaments.get(id);
  const name = info?.name ?? matches?.[0]?.competition ?? "Tournament";
  const sub = info ? [info.category, info.location].filter(Boolean).join(" · ") : null;
  topbar.replaceChildren(subBar(name, sub));

  const entry = S.tournamentData.get(id) ?? {};
  let body;
  if (tab === "matches") body = tournamentMatches(id, matches);
  else if (tab === "standings") body = standingsTab(entry);
  else body = tournamentStatsTab(entry);
  view.replaceChildren(...[segmented(TOURNAMENT_TABS, tab), body].flat(Infinity).filter(Boolean));
}

function tournamentMatches(id, matches) {
  if (!matches) {
    return S.failed.has(id) ? section(null, message(null, "Couldn't load matches.")) : section(null, spinnerRow());
  }
  if (!matches.length) return section(null, message(null, "No matches published yet."));
  const byDay = new Map();
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    const k = P.dayKey(m.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  return [...byDay].map(([k, list]) =>
    section([dayTitle(k), k === P.today() ? h("span", { style: "color:var(--accent)" }, " · Today") : null], list.map((m) => matchRow(m))));
}

function standingsTab(entry) {
  if (!entry.standings) {
    return entry.standingsError ? section(null, message(null, `Couldn't load standings: ${entry.standingsError}`)) : section(null, spinnerRow());
  }
  if (!entry.standings.length) return section(null, message(null, "No standings yet."));
  const cols = ["P", "W", "D", "L", "GF", "GA", "GD", "Pts"];
  return entry.standings.map((pool) => section(pool.pool,
    h("div", { class: "scroll-x" }, h("table", { class: "tbl num" },
      h("thead", {}, h("tr", {}, h("th", { class: "left" }, "#"), h("th", { class: "left" }, "Team"), cols.map((c) => h("th", {}, c)))),
      h("tbody", {}, pool.rows.map((r) => h("tr", {},
        h("td", { class: "left strong" }, r.rank),
        h("td", { class: "left" }, h("span", { class: "who" }, flag(P.countryCode(r.team)), h("span", {}, r.team))),
        r.values.map((v, i) => h("td", { class: i === 7 ? "strong" : "" }, i === 6 && v > 0 ? `+${v}` : v))))))),
    [...pool.notes, "P played · W won · D drawn · L lost · GF/GA goals for/against · GD goal difference"].join("\n")));
}

function tournamentStatsTab(entry) {
  if (!entry.stats) {
    return entry.statsError ? section(null, message(null, `Couldn't load statistics: ${entry.statsError}`)) : section(null, spinnerRow());
  }
  const { scorers, cards } = entry.stats;
  const playerCell = (r) => h("td", { class: "left player" },
    h("span", { class: "who" }, flag(r.code), h("span", {}, r.player, h("small", {}, `#${r.shirt} · ${r.team}`))));
  const table = (heads, rows, total, boldLast) => h("div", { class: "scroll-x" }, h("table", { class: "tbl num" },
    h("thead", {}, h("tr", {}, h("th", { class: "left" }, "Player"), heads.map((x) => h("th", {}, x)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, playerCell(r), r.values.map((v, i) =>
      h("td", { class: boldLast && i === r.values.length - 1 ? "strong" : v === 0 ? "zero" : "" }, v))))),
    total ? h("tfoot", {}, h("tr", {}, h("td", { class: "left" }, "Total"), total.map((v) => h("td", {}, v)))) : null));
  const chip = (k, label) => h("span", { class: `card-chip card-${k}`, title: label, "aria-label": label });

  return [
    section("Goal scorers",
      scorers.rows.length ? table(["FG", "PC", "PS", "Goals"], scorers.rows, scorers.total, true) : message(null, "No goals yet."),
      [scorers.note, "FG field goal · PC penalty corner · PS penalty stroke"].filter(Boolean).join("\n")),
    section("Cards",
      cards.rows.length ? table([chip("R", "Red"), chip("Y", "Yellow"), chip("G", "Green")], cards.rows, cards.total, false) : message(null, "No cards yet."),
      cards.note),
  ];
}

// =================================================================== Live updates

setInterval(() => {
  if (document.hidden) return;
  const r = route();
  if (r.name === "home") {
    const liveToday = sectionsFor(P.today()).some((s) => s.matches.some((m) => P.matchState(m.status) === "live"));
    if (liveToday) covering(P.today()).forEach((t) => loadMatches(t.id, true));
  } else if (r.name === "m") {
    const status = S.matchDetails.get(r.id)?.detail?.status ?? S.matchIndex.get(r.id)?.status;
    if (P.matchState(status) === "live") loadMatchDetail(r.id);
  } else if (r.name === "t") {
    if ((S.matchCache.get(r.id) ?? []).some((m) => P.matchState(m.status) === "live")) loadMatches(r.id, true);
  }
}, 30_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const r = route();
  if (r.name === "home") refreshHome();
  else if (r.name === "m") loadMatchDetail(r.id);
  else if (r.name === "t") loadTournament(r.id);
});

// =================================================================== Start

rebuildDays();
onRoute();
loadCatalogPage(1).then(() => ensureDay(S.selected));
