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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5v10h14V11h-1"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
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

function flag(code, large = false, site = "fih") {
  // Club and state teams have no flags: show their code in a small badge instead.
  const badge = () => h("span", { class: `flag mono${large ? " lg" : ""}`, "aria-hidden": "true" }, (code ?? "").slice(0, 3));
  const mode = SITES[site]?.flags;
  if (!mode) return badge();
  const url = P.flagURL(code);
  if (!url) return h("span", { class: `flag${large ? " lg" : ""}` });
  // "try": national teams have flags, clubs don't (Euro Hockey), so fall back to the badge.
  return h("img", { class: `flag${large ? " lg" : ""}`, src: url, alt: "", loading: "lazy",
    onerror: (e) => { if (mode === "try") e.target.replaceWith(badge()); else e.target.style.visibility = "hidden"; } });
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

// =================================================================== Sites and views

/**
 * Every Altius competition site the app reads. The order is fixed: a site's position is part of
 * its tournament and match IDs (see cid), so add new sites at the end and never reorder.
 */
const SITE_KEYS = ["fih", "hi", "ehf", "ha", "nz", "fhc", "saha", "dhu"];
const SITES = {
  fih: { group: "intl", short: "FIH", label: "International", owner: "FIH", host: "fih.altiusrt.com", flags: true },
  ehf: { group: "intl", short: "Euro Hockey", label: "Euro Hockey", owner: "European Hockey Federation", host: "eurohockey.altiusrt.com", flags: "try" },
  hi: { group: "dom", short: "India", label: "India", owner: "Hockey India", host: "hockeyindia.altiusrt.com" },
  ha: { group: "dom", short: "Australia", label: "Australia", owner: "Hockey Australia", host: "hockeyaustralia.altiusrt.com" },
  nz: { group: "dom", short: "New Zealand", label: "New Zealand", owner: "Hockey New Zealand", host: "hockeynz.altiusrt.com" },
  fhc: { group: "dom", short: "Canada", label: "Canada", owner: "Field Hockey Canada", host: "fhc.altiusrt.com" },
  saha: { group: "dom", short: "South Africa", label: "South Africa", owner: "South African Hockey Association", host: "saha.altiusrt.com" },
  dhu: { group: "dom", short: "Denmark", label: "Denmark", owner: "Dansk Hockey Union", host: "dhu.altiusrt.com" },
};
const siteList = () => SITE_KEYS.filter((k) => SITES[k]);
const intlSites = () => siteList().filter((k) => SITES[k].group === "intl");
const domSites = () => siteList().filter((k) => SITES[k].group === "dom");

/** IDs that are unique across sites: FIH IDs are unchanged (so old links still work), others are offset. */
const ID_SPAN = 1e8;
const cid = (site, raw) => SITE_KEYS.indexOf(site) * ID_SPAN + Number(raw);
const siteOf = (id) => SITE_KEYS[Math.floor(id / ID_SPAN)] ?? "fih";
const rawId = (id) => id % ID_SPAN;

// The view chosen with the switch: All, International, or one Domestic league.
function readPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function writePref(key, value) { try { localStorage.setItem(key, value); } catch { /* not saved */ } }
// Every visit opens on International; if nothing international is live, it moves to All (see Start).
let VIEW = "intl";
let viewChosen = false;   // set once the viewer picks a view, so the start-up move never overrides them
let LEAGUE = readPref("hockeylive.league", "all");   // "all" = every domestic league
if (LEAGUE !== "all" && SITES[LEAGUE]?.group !== "dom") LEAGUE = "all";

/** Sites shown in the current view. */
const activeSites = () => (VIEW === "all" ? siteList() : VIEW === "intl" ? intlSites() : LEAGUE === "all" ? domSites() : [LEAGUE]);
const isActive = (site) => activeSites().includes(site);

/** In-app link: link("m/123") → "#/m/123". */
const link = (path = "") => `#/${path}`;

function setView(view, league = LEAGUE) {
  VIEW = view; LEAGUE = league;
  writePref("hockeylive.league", league);
  applyTheme();
  rebuildDays();
  if (!S.days.includes(S.selected)) S.selected = P.today();
  changed();
  startSites();
}

/** Domestic leagues are blue, International and All are green (see style.css). */
function applyTheme(blue = VIEW === "dom") {
  document.documentElement.dataset.source = blue ? "hi" : "fih";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", blue ? "#1d4f9e" : "#0e5a3a");
  document.title = VIEW === "dom" ? `Hockey Live · ${LEAGUE === "all" ? "Domestic" : SITES[LEAGUE].label}` : "Hockey Live";
}

/** "India Domestic", "Euro Hockey"; nothing for FIH. */
const siteTag = (site) => (!site || site === "fih" || !SITES[site] ? null
  : SITES[site].group === "dom" ? `${SITES[site].label} Domestic` : SITES[site].label);

/** Data credit for the sites on screen (one site on match/tournament/team pages, else the view). */
function renderCredit(sites = activeSites()) {
  const credit = document.getElementById("credit");
  const a = (k, text) => h("a", { href: `https://${SITES[k].host}`, target: "_blank", rel: "noopener" }, text);
  if (sites.length === 1) {
    const k = sites[0];
    credit.replaceChildren(`Data from the ${SITES[k].owner} / Altius competition website (`, a(k, SITES[k].host),
      `). Unofficial fan app, not affiliated with ${SITES[k].owner} or Altius.`);
    return;
  }
  // Several sites: each association's name links to its site, to keep the footer short.
  credit.replaceChildren("Data from the Altius competition websites of ",
    ...sites.flatMap((k, i) => [i ? (i === sites.length - 1 ? " and " : ", ") : "", a(k, SITES[k].owner)]),
    ". Unofficial fan app, not affiliated with these associations or Altius.");
}

// =================================================================== Data access (through /api/fih)

async function fetchDoc(site, path) {
  const res = await fetch(`/api/fih?site=${site}&path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`The ${SITES[site].owner} site answered with error ${res.status}.`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}
async function fetchMatchStats(id) {
  const res = await fetch(`/api/fih?site=${siteOf(id)}&stats=${rawId(id)}`);
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
  catalogs: {},             // site → { nextPage, hasMore, loading, error } for its tournament list
  jumping: false,
  pinned: new Set([P.today()]),   // days shown even with nothing on: today, dates jumped to
  days: [P.today()],
  selected: P.today(),
  lastUpdated: null,
  matchDetails: new Map(),  // match id → { detail, stats, detailError, statsError }
  tournamentData: new Map(),// tournament id → { standings, stats, standingsError, statsError }
  menuOpen: false,
  clocks: new Map(),        // match id → { clock, fetchedAt } for live matches
  clockLoading: new Set(),
  favourites: loadFavourites(),   // teams as "site:code", e.g. "fih:IND", kept in this browser
  favTournaments: loadFavTournaments(),   // tournament id → saved summary
  team: null,               // { code, category, cutoff, ids, busy } for the team page being viewed
  teamNames: new Map(),     // "site:code" → full name (hi:HAP → HOCKEY ANDHRA PRADESH), for sites without country codes
  namesLoaded: new Set(),   // tournaments whose team names have been read
  teamCategory: new Map(),  // "site:code" → the category it was last opened with (for the toggle)
};

// ---------- Favourite teams (stored in this browser only)

// Function declarations (not consts) because S is created above and calls these at start-up.
function readList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function loadFavourites() {
  const saved = readList("hockeylive.favteams");
  if (saved.length || localStorage.getItem?.("hockeylive.favteams")) return new Set(saved.filter((c) => typeof c === "string"));
  // First run after the update: bring over the old per-mode lists.
  return new Set([...readList("hockeylive.favourites").map((c) => `fih:${c}`), ...readList("hockeylive.favourites.hi").map((c) => `hi:${c}`)]);
}
/** Favourite tournaments: id → { id, name, site, startKey, endKey, category } (kept so the menu can list them before they load). */
function loadFavTournaments() {
  return new Map(readList("hockeylive.favtournaments").filter((t) => Number.isFinite(t?.id)).map((t) => [t.id, t]));
}
function saveList(key, set) { try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* private mode: keep for this visit */ } }

const teamKey = (site, code) => `${site}:${code}`;
function toggleFavourite(site, code) {
  const k = teamKey(site, code);
  if (S.favourites.has(k)) S.favourites.delete(k); else S.favourites.add(k);
  saveList("hockeylive.favteams", S.favourites);
  syncAlerts();   // keep goal alerts in step with the favourites
  render();
}
function toggleFavTournament(id) {
  if (S.favTournaments.has(id)) S.favTournaments.delete(id);
  else {
    const t = S.tournaments.get(id), m = S.matchCache.get(id)?.[0];
    S.favTournaments.set(id, {
      id, site: siteOf(id), name: t?.name ?? m?.competition ?? "Tournament",
      startKey: t?.startKey ?? null, endKey: t?.endKey ?? null, category: t?.category ?? null,
    });
  }
  saveList("hockeylive.favtournaments", S.favTournaments.values());
  render();
}
const isFavTeam = (site, code) => S.favourites.has(teamKey(site, code));
const isFavouriteMatch = (m) => isFavTeam(m.site, m.home) || isFavTeam(m.site, m.away);

// ---------- Goal alerts (web push) for favourite teams

const alertsSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let alertsBusy = false;

function alertsOn() { try { return localStorage.getItem("hockeylive.alerts") === "on"; } catch { return false; } }
function setAlertsOn(on) { try { localStorage.setItem("hockeylive.alerts", on ? "on" : "off"); } catch { /* not saved */ } }

/** Favourite teams grouped by site, for the alerts service: { fih: ["IND"], hi: ["HAP"] }. */
function allFavourites() {
  const out = {};
  for (const k of S.favourites) { const [site, code] = k.split(":"); (out[site] ??= []).push(code); }
  return out;
}

function keyBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function postAlerts(action, body) {
  const res = await fetch(`/api/push?action=${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function turnOnAlerts() {
  alertsBusy = true; render();
  try {
    if ((await Notification.requestPermission()) !== "granted") {
      toast("Notifications are blocked. Allow them in your phone's settings.");
      return;
    }
    const keyRes = await fetch("/api/push?action=key");
    const key = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok) throw new Error(key.error || "Goal alerts aren't available right now.");
    const reg = await navigator.serviceWorker.ready;
    const subscription = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) }));
    await postAlerts("subscribe", { subscription, favourites: allFavourites() });
    setAlertsOn(true);
    toast("Goal alerts on");
  } catch (e) {
    toast(e.message);
  } finally {
    alertsBusy = false; render();
  }
}

async function turnOffAlerts() {
  alertsBusy = true; render();
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await postAlerts("unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setAlertsOn(false);
    toast("Goal alerts off");
  } finally {
    alertsBusy = false; render();
  }
}

/** Send the current favourites to the alerts service (after a favourite is added or removed). */
async function syncAlerts() {
  if (!alertsSupported || !alertsOn()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await postAlerts("subscribe", { subscription: sub, favourites: allFavourites() });
  } catch { /* tried again on the next change */ }
}

/** The Goal alerts row in the menu. */
function alertsRow() {
  if (!alertsSupported) {
    const text = isIOS && !isInstalled
      ? "To get goal alerts on iPhone, add Hockey Live to your Home Screen (Share → Add to Home Screen), open it from there, then turn alerts on here. Needs iOS 16.4 or later."
      : "This browser can't show goal alerts.";
    return h("div", { class: "row alerts-row" }, h("span", { class: "alert-icon" }, icon("bell", 18)), h("div", { class: "grow caption" }, text));
  }
  const on = alertsOn() && Notification.permission === "granted";
  return h("div", { class: "row alerts-row" },
    h("span", { class: "alert-icon" }, icon("bell", 18)),
    h("div", { class: "grow" },
      h("div", { class: "menu-name" }, "Goal alerts"),
      h("div", { class: "caption" }, on ? "Kick-off, goals and full time for your favourite teams" : "Get notified when your favourite teams play")),
    h("button", {
      class: `pill fav-btn${on ? " on" : ""}`, disabled: alertsBusy, "aria-pressed": String(on),
      onclick: on ? turnOffAlerts : turnOnAlerts,
    }, alertsBusy ? "…" : on ? "On" : "Turn on"));
}

let renderQueued = false;
function changed() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function covering(key) {
  return [...S.tournaments.values()]
    .filter((t) => isActive(t.site) && P.addDays(t.startKey, -1) <= key && key <= P.addDays(t.endKey, 1))   // ±1 day for time zones
    .sort((a, b) => a.startKey.localeCompare(b.startKey));
}

function rebuildDays() {
  const keys = new Set(S.pinned);
  for (const t of S.tournaments.values()) if (isActive(t.site)) P.dayRange(t.startKey, t.endKey).forEach((k) => keys.add(k));
  for (const list of S.matchCache.values()) list.forEach((m) => { if (isActive(m.site)) keys.add(P.dayKey(m.start)); });
  S.days = [...keys].sort();
}

const catalog = (site) => (S.catalogs[site] ??= { nextPage: 1, hasMore: true, loading: false, error: null });
const anyCatalogLoading = () => activeSites().some((k) => catalog(k).loading);
const anyMoreCatalog = () => activeSites().some((k) => catalog(k).hasMore);
const catalogError = () => activeSites().map((k) => catalog(k).error).find(Boolean) ?? null;

async function loadCatalogPage(site, page) {
  const c = catalog(site);
  c.loading = true;
  try {
    const { tournaments, hasMore } = P.parseCatalog(await fetchDoc(site, `/competitions?view=all&page=${page}`));
    for (const t of tournaments) S.tournaments.set(cid(site, t.id), { ...t, id: cid(site, t.id), site });
    if (page === c.nextPage) { c.nextPage += 1; c.hasMore = hasMore; }
    c.error = null;
    S.lastUpdated = new Date();
    rebuildDays();
  } catch (e) {
    c.error = e.message;
  } finally {
    c.loading = false;
    saveSnapshotSoon();
    changed();
  }
}
/** Next (older) page of every active site's tournament list. */
async function loadNextCatalogPage() {
  await Promise.all(activeSites().map((k) => {
    const c = catalog(k);
    return c.hasMore && !c.loading ? loadCatalogPage(k, c.nextPage) : null;
  }));
}

/** First page of each active site's list (once), favourite tournaments still running, then the selected day. */
async function startSites() {
  const fresh = activeSites().filter((k) => catalog(k).nextPage === 1 && !catalog(k).loading);
  await Promise.all([
    // Page 1 can be all future tournaments (Euro Hockey lists years ahead): read on until today is covered.
    ...fresh.map((k) => loadCatalogPage(k, 1).then(() => loadCatalogBackTo(P.today(), [k]))),
    // Long leagues can be further down their site's list than page 1, so fetch these directly.
    ...[...S.favTournaments.values()]
      .filter((f) => isActive(f.site) && (!f.endKey || f.endKey >= P.addDays(P.today(), -7)))
      .map((f) => loadMatches(f.id)),
  ]);
  await ensureDay(S.selected);
}

/** Team name for display: the site's team list, else the country name. */
function teamName(code, site = "fih") {
  const name = S.teamNames.get(teamKey(site, code));
  return name ? P.niceTeamName(name) : P.countryName(code);
}
/** Team code for a full name (standings and statistics only show names). */
function teamCodeFor(name, site = "fih") {
  if (SITES[site]?.flags === true) return P.countryCode(name);
  const wanted = String(name).toLowerCase(), prefix = `${site}:`;
  for (const [k, full] of S.teamNames) if (k.startsWith(prefix) && full.toLowerCase() === wanted) return k.slice(prefix.length);
  return null;
}
const displayTeam = (name, site = "fih") => (SITES[site]?.flags === true ? name : P.niceTeamName(name));

/** Sites without country codes: read a tournament's team codes and names (once). */
async function loadTeamNames(id) {
  const site = siteOf(id);
  if (SITES[site]?.flags === true || S.namesLoaded.has(id)) return;
  S.namesLoaded.add(id);
  try {
    for (const [code, name] of P.parseTeamCodes(await fetchDoc(site, `/competitions/${rawId(id)}`))) S.teamNames.set(teamKey(site, code), name);
    changed();
  } catch {
    S.namesLoaded.delete(id);   // try again next time
  }
}

async function loadMatches(id, force = false) {
  loadTeamNames(id);
  if (S.loading.has(id) || (!force && S.matchCache.has(id))) return;
  S.loading.add(id);
  changed();
  try {
    const site = siteOf(id);
    const matches = P.parseMatchListing(await fetchDoc(site, `/competitions/${rawId(id)}/matches`), id)
      .map((m) => ({ ...m, id: cid(site, m.id), site }));
    S.matchCache.set(id, matches);
    matches.forEach((m) => S.matchIndex.set(m.id, m));
    S.failed.delete(id);
    rebuildDays();
  } catch {
    S.failed.add(id);
  } finally {
    S.loading.delete(id);
    saveSnapshotSoon();
    changed();
  }
}

/** Load what a day (and the days either side) needs; fetch older tournaments near the start. */
async function ensureDay(key) {
  const i = S.days.indexOf(key);
  if (i >= 0 && i <= 3 && anyMoreCatalog()) await loadNextCatalogPage();
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
const oldestStart = (site) => [...S.tournaments.values()].filter((t) => t.site === site).map((t) => t.startKey).sort()[0] ?? "9999";

/** Load older pages of each site's tournament list until it reaches back to `key`. */
async function loadCatalogBackTo(key, sites = activeSites()) {
  await Promise.all(sites.map(async (site) => {
    const c = catalog(site);
    while (c.hasMore && oldestStart(site) > key) {
      if (c.loading) await new Promise((r) => setTimeout(r, 200));
      else { await loadCatalogPage(site, c.nextPage); if (c.error) break; }
    }
  }));
}

async function jumpTo(key) {
  if (!key) return;
  S.pinned.add(key);
  S.jumping = true;
  changed();
  await loadCatalogBackTo(key);
  S.jumping = false;
  rebuildDays();
  selectDay(key);
}

function sectionsFor(key) {
  const dayMatches = [...S.matchCache.values()].flat()
    .filter((m) => isActive(m.site) && P.dayKey(m.start) === key)
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
  await Promise.all(activeSites().map((k) => loadCatalogPage(k, 1)));
  const ids = new Set([...covering(S.selected), ...covering(P.today())].map((t) => t.id));
  await Promise.all([...ids].map((id) => loadMatches(id, true)));
  S.lastUpdated = new Date();
  changed();
}

/** Fetch the live clock for a match (from its match page), at most every 25 seconds. */
async function loadClock(id, force = false) {
  const known = S.clocks.get(id);
  if (S.clockLoading.has(id) || (!force && known && Date.now() - known.fetchedAt < 25_000)) return;
  S.clockLoading.add(id);
  try {
    const clock = P.parseLiveClock(await fetchDoc(siteOf(id), `/matches/${rawId(id)}`));
    if (clock) S.clocks.set(id, { clock, fetchedAt: Date.now() });
  } catch {
    // keep showing the kick-off time
  } finally {
    S.clockLoading.delete(id);
    changed();
  }
}

/** "23'" while playing, or the break's short name ("HT") when the clock is between periods. */
function clockText(id) {
  const entry = S.clocks.get(id);
  if (!entry) return null;
  const { clock, fetchedAt } = entry;
  if (P.matchState(clock.status) !== "live") return null;
  if (!/quarter|half|period|extra|shoot/i.test(clock.status) || /time/i.test(clock.status)) return clock.short ?? clock.status;
  return `${P.liveMinute(clock, fetchedAt)}'`;
}

async function loadMatchDetail(id) {
  const entry = S.matchDetails.get(id) ?? {};
  S.matchDetails.set(id, entry);
  await Promise.all([
    fetchDoc(siteOf(id), `/matches/${rawId(id)}`)
      .then((doc) => {
        entry.detail = P.parseMatchPage(doc);
        entry.detailError = null;
        if (entry.detail.live) S.clocks.set(id, { clock: entry.detail.live, fetchedAt: Date.now() });
      })
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
    fetchDoc(siteOf(id), `/competitions/${rawId(id)}/pools`)
      .then((doc) => { entry.standings = P.parseStandings(doc); entry.standingsError = null; })
      .catch((e) => { entry.standingsError = e.message; })
      .finally(changed),
    fetchDoc(siteOf(id), `/competitions/${rawId(id)}/statistics`)
      .then((doc) => { entry.stats = P.parseTournamentStats(doc); entry.statsError = null; })
      .catch((e) => { entry.statsError = e.message; })
      .finally(changed),
  ]);
}

/** Run `work` over `items`, at most `limit` at a time. */
async function inBatches(items, limit, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}

/**
 * Team page: every tournament from 6 months ago onwards (in the same category,
 * unless "All categories" is chosen), then that team's matches from each.
 */
async function loadTeam(key, category) {
  const [site, code] = splitTeam(key);
  const cutoff = P.addDays(P.today(), -183);
  const team = { key, site, code, category, cutoff, ids: [], busy: true };
  if (category) S.teamCategory.set(key, category);
  S.team = team;
  changed();
  await loadCatalogBackTo(cutoff, [site]);
  if (S.team !== team) return;   // the viewer moved on
  team.ids = [...S.tournaments.values()]
    .filter((t) => t.site === site && t.endKey >= cutoff && (!category || t.category === category))
    .sort((a, b) => b.startKey.localeCompare(a.startKey))
    .map((t) => t.id);
  changed();
  await inBatches(team.ids, 4, (id) => (S.team === team ? loadMatches(id) : null));
  team.busy = false;
  changed();
}

function teamMatches(team) {
  const cutoffDate = P.keyToDate(team.cutoff);
  return team.ids.flatMap((id) => S.matchCache.get(id) ?? [])
    .filter((m) => (m.home === team.code || m.away === team.code) && m.start >= cutoffDate);
}

/** "hi:HAP" → ["hi", "HAP"]. */
const splitTeam = (key) => { const i = key.indexOf(":"); return [key.slice(0, i), key.slice(i + 1)]; };
const teamHref = (site, code, category) =>
  link(`team/${encodeURIComponent(teamKey(site, code))}${category ? `/${encodeURIComponent(category)}` : ""}`);

// =================================================================== Quick start: last data kept on this device

const SNAPSHOT_KEY = "hockeylive.snapshot.v2";
const SNAPSHOT_MAX_AGE = 12 * 3600 * 1000;
let snapshotTimer = null;

/** Keep tournaments around today (±3 days) and their matches, so the next visit opens instantly. */
function saveSnapshotSoon() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    const from = P.addDays(P.today(), -3), to = P.addDays(P.today(), 3);
    const tournaments = [...S.tournaments.values()].filter((t) => t.endKey >= from && t.startKey <= to);
    const matches = {};
    for (const t of tournaments) if (S.matchCache.has(t.id)) matches[t.id] = S.matchCache.get(t.id);
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        savedAt: Date.now(), tournaments, matches, teamNames: [...S.teamNames],
      }));
    } catch { /* storage full or blocked: just skip */ }
  }, 1500);
}

/** Show the last saved data straight away (it is refreshed right after). */
function restoreSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!snap || Date.now() - snap.savedAt > SNAPSHOT_MAX_AGE) return false;
    for (const t of snap.tournaments ?? []) S.tournaments.set(t.id, t);
    for (const [id, list] of Object.entries(snap.matches ?? {})) {
      const matches = list.map((m) => ({ ...m, start: new Date(m.start) }));
      S.matchCache.set(Number(id), matches);
      matches.forEach((m) => S.matchIndex.set(m.id, m));
    }
    for (const [code, name] of snap.teamNames ?? []) S.teamNames.set(code, name);
    S.lastUpdated = new Date(snap.savedAt);
    return S.tournaments.size > 0;
  } catch {
    return false;
  }
}

// =================================================================== Routing
// #/            day list
// #/m/123/goals match screen (tab optional)
// #/t/1926/standings tournament screen (tab optional)
// #/team/fih%3AJPN/Under%2021%20Mens%20Outdoor   team page ("site:code", category optional)
// Match and tournament IDs carry their site (see cid). Older links (#/hi/m/6826, #/team/JPN) still work.

function route() {
  let path = location.hash.replace(/^#\/?/, "");
  const legacy = /^hi(\/|$)/.test(path);
  if (legacy) path = path.replace(/^hi\/?/, "");
  const [name, id, tab] = path.split("/");
  let num = Number(id), raw = decodeURIComponent(id ?? "");
  if (legacy && (name === "m" || name === "t")) num = cid("hi", num);
  if (name === "team" && raw && !raw.includes(":")) raw = teamKey(legacy ? "hi" : "fih", raw);
  return { name: name || "home", id: num, raw, tab: tab && decodeURIComponent(tab) };
}
function setTab(tab) {
  const r = route();
  history.replaceState(null, "", link(`${r.name}/${r.id}/${tab}`));
  render();
}
let inAppSteps = 0;
function goBack() {
  if (inAppSteps > 0) history.back();
  else location.hash = link();
}
function goHome() { location.hash = link(); }

window.addEventListener("hashchange", () => {
  S.menuOpen = false;
  inAppSteps = route().name === "home" ? 0 : inAppSteps + 1;
  window.scrollTo(0, 0);
  onRoute();
});

function onRoute() {
  const r = route();
  render();
  if (r.name === "m" && r.id) loadMatchDetail(r.id);
  if (r.name === "t" && r.id) loadTournament(r.id);
  if (r.name === "team" && r.raw) loadTeam(r.raw, r.tab || null);
}

// =================================================================== Rendering

const topbar = document.getElementById("topbar");
const view = document.getElementById("view");

/** The site a match, tournament or team page belongs to (null on the day list). */
function pageSite(r = route()) {
  if ((r.name === "m" || r.name === "t") && r.id) return siteOf(r.id);
  if (r.name === "team" && r.raw) return splitTeam(r.raw)[0];
  return null;
}

let creditFor = "";
function render() {
  const r = route();
  const site = pageSite(r);
  applyTheme(site ? SITES[site]?.group === "dom" : VIEW === "dom");
  const sites = site && SITES[site] ? [site] : activeSites();
  if (creditFor !== sites.join()) { creditFor = sites.join(); renderCredit(sites); }
  if (r.name === "m" && r.id) renderMatch(r.id, r.tab);
  else if (r.name === "t" && r.id) renderTournament(r.id, r.tab);
  else if (r.name === "team" && r.raw) renderTeam(r.raw, r.tab || null);
  else renderHome();
  renderMenu();
}

const menuButton = () => h("button", {
  class: "icon-btn", onclick: openMenu, "aria-label": "Tournaments menu", "aria-expanded": String(S.menuOpen),
}, icon("menu"));
const spacer = () => h("span", { class: "icon-btn", "aria-hidden": "true" });

function subBar(title, sub, extraButton = null) {
  const tag = siteTag(pageSite());
  if (tag) sub = sub ? `${sub} · ${tag}` : tag;
  return h("div", { class: "bar" },
    h("button", { class: "icon-btn", onclick: goBack, "aria-label": "Back" }, icon("left")),
    menuButton(),
    h("div", { class: "bar-title" }, h("h1", {}, title), sub ? h("div", { class: "sub" }, sub) : null),
    extraButton ?? spacer(),
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

/** Kick-off time, or for a live match the minute of play (ticks via data-clock). */
function liveTime(m, state) {
  if (state !== "live") return h("span", { class: "t num" }, timeText(m.start));
  loadClock(m.id);
  const text = clockText(m.id);
  return text
    ? h("span", { class: "t num clock", "data-clock": m.id }, text)
    : h("span", { class: "t num" }, timeText(m.start));
}

function liveBadge(m) {
  const short = S.clocks.get(m.id)?.clock.short;
  return short && !/^(HT|UP|WU|CO|OF)$/.test(short) ? `LIVE · ${short}` : "LIVE";
}

function matchRow(m, { showCompetition = false, showDate = false } = {}) {
  const state = P.matchState(m.status);
  const showScore = state !== "upcoming";
  const team = (code, score) => h("div", { class: "team" },
    flag(code, false, m.site), h("span", { class: "name" }, teamName(code, m.site),
      isFavTeam(m.site, code) ? h("span", { class: "fav-star", "aria-label": "Favourite" }, " ★") : null),
    showScore && score != null ? h("span", { class: "score num" }, score) : null);
  const caption = [showCompetition ? m.competition : null, m.number ? `Match ${m.number}` : null, m.stage, m.venue]
    .filter(Boolean).join(" · ");
  return h("a", { class: `row ${state}`, href: link(`m/${m.id}`) },
    h("div", { class: "time" },
      showDate ? h("span", { class: "d" }, m.start.toLocaleDateString(undefined, { day: "numeric", month: "short" })) : null,
      liveTime(m, state),
      state === "live" ? h("span", { class: "badge-live" }, liveBadge(m)) : null,
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
  const views = [["all", "All", "src-all"], ["intl", "International", "src-fih"], ["dom", "Domestic", "src-hi"]];
  topbar.replaceChildren(
    h("div", { class: "source-switch seg", role: "tablist", "aria-label": "Competitions" },
      views.map(([v, label, cls]) => h("button", {
        class: cls, role: "tab", "aria-selected": String(v === VIEW), onclick: () => { viewChosen = true; if (v === "dom") setView("dom", "all"); else if (v !== VIEW) setView(v); },   // Domestic always opens on All Domestic
      }, h("span", { class: "src-dot", "aria-hidden": "true" }), label))),
    // Domestic: all leagues, or one country's.
    VIEW === "dom" ? h("div", { class: "league-chips", role: "tablist", "aria-label": "Domestic league" },
      ["all", ...domSites()].map((k) => h("button", {
        class: "chip", role: "tab", "aria-selected": String(k === LEAGUE), onclick: () => { viewChosen = true; if (k !== LEAGUE) setView("dom", k); },
      }, k === "all" ? "All Domestic" : SITES[k].short))) : "",
    h("div", { class: "bar" },
      menuButton(),
      h("button", { class: "icon-btn", onclick: () => move(-1), disabled: i <= 0, "aria-label": "Previous day" }, icon("left")),
      h("div", { class: "bar-title" }, h("h1", {}, dayTitle(key)), h("div", { class: "sub" }, rel ?? " ")),
      h("button", { class: "icon-btn", onclick: () => move(1), disabled: i < 0 || i >= S.days.length - 1, "aria-label": "Next day" }, icon("right")),
      spacer()),
    h("div", { class: "tools" },
      h("button", { class: "pill", onclick: () => selectDay(P.today()), disabled: key === P.today() }, "Today"),
      h("label", { class: "pill" }, icon("calendar", 15), "Choose date", dateInput)));

  const parts = [];
  if (S.jumping) parts.push(section(null, spinnerRow("Loading older tournaments…")));

  // Live matches first (they also appear again under their tournament below).
  const live = sectionsFor(key).flatMap((sec) => sec.matches)
    .filter((m) => P.matchState(m.status) === "live")
    .sort((a, b) => a.start - b.start);
  if (live.length) parts.push(section("Live", live.map((m) => matchRow(m, { showCompetition: true }))));

  // Then the day's matches for favourite teams (also repeated under their tournament).
  const favourites = sectionsFor(key).flatMap((sec) => sec.matches)
    .filter(isFavouriteMatch)
    .sort((a, b) => a.start - b.start);
  if (favourites.length) parts.push(section("★ Favourites", favourites.map((m) => matchRow(m, { showCompetition: true }))));

  // Favourite tournaments first, then tournaments with a favourite team playing,
  // then international before domestic (FIH, Euro Hockey, then each country); otherwise the usual order.
  const intl = (sec) => SITES[siteOf(sec.id)]?.group === "intl";
  const tournamentSections = sectionsFor(key)
    .map((sec, i) => ({ sec, i, favT: S.favTournaments.has(sec.id), fav: sec.matches.some(isFavouriteMatch), intl: intl(sec), site: Math.floor(sec.id / ID_SPAN) }))
    .sort((a, b) => (b.favT - a.favT) || (b.fav - a.fav) || (b.intl - a.intl) || (a.site - b.site) || (a.i - b.i))
    .map((x) => x.sec);
  for (const sec of tournamentSections) {
    const tag = VIEW === "dom" && LEAGUE !== "all" ? null : siteTag(siteOf(sec.id));
    parts.push(section(
      h("a", { href: link(`t/${sec.id}`) },
        S.favTournaments.has(sec.id) ? h("span", { class: "fav-star", "aria-label": "Favourite tournament" }, "★ ") : null,
        sec.name, tag ? h("span", { class: "site-tag" }, tag) : null, " ›"),
      sec.matches.map((m) => matchRow(m))));
  }

  const loading = isLoadingDay(key) || (anyCatalogLoading() && !covering(key).length && !sectionsFor(key).length);
  if (loading) {
    parts.push(section(null, spinnerRow("Loading matches…")));
  } else if (!sectionsFor(key).length) {
    const title = key === P.today() ? "No matches today" : "No matches on this day";
    parts.push(section(null, catalogError() && !covering(key).length
      ? message(title, `Couldn't load tournaments: ${catalogError()}`,
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

const MATCH_TABS = [["goals", "Goals"], ["cards", "Cards"], ["stats", "Stats"], ["lineups", "Lineups"], ["h2h", "H2H"]];

function renderMatch(id, tab = "goals") {
  if (!MATCH_TABS.some(([k]) => k === tab)) tab = "goals";
  const base = S.matchIndex.get(id);
  const entry = S.matchDetails.get(id) ?? {};
  const d = entry.detail;

  const site = siteOf(id);
  topbar.replaceChildren(subBar(base?.number ? `Match ${base.number}` : "Match", null,
    h("button", { class: "icon-btn", onclick: () => shareMatch(id), "aria-label": "Share this match" }, icon("share"))));

  const status = d?.status || base?.status || "";
  const state = P.matchState(status);
  const homeCode = base?.home ?? d?.home?.code;
  const awayCode = base?.away ?? d?.away?.code;
  const homeName = base ? teamName(base.home, site) : displayTeam(d?.home?.name ?? "", site);
  const awayName = base ? teamName(base.away, site) : displayTeam(d?.away?.name ?? "", site);
  const competition = base?.competition ?? d?.competition;
  const stage = base?.stage ?? d?.stage;
  const score = d?.scoreline || (base && base.homeScore != null ? `${base.homeScore} - ${base.awayScore}` : "–");

  const compLine = [competition, stage].filter(Boolean).join(" · ");
  const category = base ? S.tournaments.get(base.competitionID)?.category ?? null : null;
  const head = h("div", { class: "match-head" },
    base?.competitionID ? h("a", { class: "comp", href: link(`t/${base.competitionID}`) }, compLine, " ›") : h("div", { class: "comp" }, compLine),
    h("div", { class: "sides" },
      teamSide(site, homeCode, homeName, category),
      h("div", {},
        h("div", { class: `big num${state === "live" ? " live" : ""}` }, state === "upcoming" && base ? timeText(base.start) : score),
        h("div", { class: `status${state === "live" ? " live" : ""}` },
          state === "live" ? ["LIVE · ", status, clockText(id) && /'$/.test(clockText(id)) ? [" · ", h("span", { "data-clock": id }, clockText(id))] : null] : status),
        base?.scoreNote ? h("div", { class: "meta" }, base.scoreNote) : null),
      teamSide(site, awayCode, awayName, category)),
    state !== "upcoming" && d ? scorersBlock(d.goals, d.home?.name ?? homeName, d.away?.name ?? awayName) : null,
    base ? h("div", { class: "meta" },
      [base.start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), base.venue].filter(Boolean).join(" · ")) : null);

  let body;
  if (tab === "stats") body = matchStatsTab(entry, homeCode, awayCode);
  else if (d) body = { lineups: lineupsTab, goals: goalsTab, cards: cardsTab, h2h: h2hTab }[tab](d, state, site);
  else if (entry.detailError) body = section(null, message(null, `Couldn't load this match: ${entry.detailError}`));
  else body = section(null, spinnerRow());

  view.replaceChildren(...[head, segmented(MATCH_TABS, tab), body].flat(Infinity).filter(Boolean));
}

/** "YAMADA Seia" → "Seia Yamada", "van der BERG Jan" → "Jan van der Berg"; a lone surname ("ADEEL") → "Adeel". */
function displayName(name) {
  const words = name.split(" ").filter(Boolean);
  const isSurname = (w) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  const surname = words.filter(isSurname);
  if (!surname.length) return name;
  const first = words.findIndex(isSurname), lastIdx = words.length - 1 - [...words].reverse().findIndex(isSurname);
  // Given names come after the surname on the FIH site; lowercase words before it are particles ("van der").
  const given = words.slice(lastIdx + 1).filter((w) => !isSurname(w));
  const particles = words.slice(0, first).filter((w) => w === w.toLowerCase());
  const givenBefore = words.slice(0, first).filter((w) => w !== w.toLowerCase());
  const last = [...particles, ...surname.map((w) => w.charAt(0) + w.slice(1).toLowerCase())].join(" ");
  return [...(given.length ? given : givenBefore), last].join(" ");
}

/** Goal scorers under each team: one line per player with all their minutes. */
function scorersBlock(goals, homeName, awayName) {
  if (!goals.length) return null;
  const marker = (action) => (/corner/i.test(action) ? " (PC)" : /stroke/i.test(action) ? " (PS)" : "");
  const lines = (teamName) => {
    // Group by the actual player (full name + shirt), never by the shortened name.
    const byPlayer = new Map();
    for (const g of goals.filter((x) => x.team === teamName)) {
      const key = `${g.shirt}|${g.player}`;
      if (!byPlayer.has(key)) byPlayer.set(key, { player: g.player, minutes: [] });
      byPlayer.get(key).minutes.push(`${g.minute}'${marker(g.action)}`);
    }
    return [...byPlayer.values()].map((p) => h("div", {}, `${displayName(p.player)} ${p.minutes.join(", ")}`));
  };
  const ball = h("span", { class: "ball", "aria-label": "Goals" });
  return h("div", { class: "scorers" },
    h("div", { class: "home num" }, lines(homeName)),
    ball,
    h("div", { class: "away num" }, lines(awayName)));
}

/** Share a match through the phone's share sheet, or copy its link where there isn't one. */
async function shareMatch(id) {
  const base = S.matchIndex.get(id);
  const d = S.matchDetails.get(id)?.detail;
  const site = siteOf(id);
  const home = base ? teamName(base.home, site) : displayTeam(d?.home?.name ?? "", site);
  const away = base ? teamName(base.away, site) : displayTeam(d?.away?.name ?? "", site);
  const state = P.matchState(d?.status ?? base?.status);
  const score = d?.scoreline ?? (base?.homeScore != null ? `${base.homeScore} - ${base.awayScore}` : null);
  const title = state === "upcoming" || !score ? `${home} v ${away}` : `${home} ${score.replace(" - ", "–")} ${away}`;
  const when = base ? base.start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  const text = [title, base?.competition, state === "live" ? "Live now" : state === "upcoming" ? when : "Full time"]
    .filter(Boolean).join(" · ");
  const url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch { /* closed the share sheet */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Link copied");
  } catch {
    toast(url);
  }
}

function toast(text) {
  const el = h("div", { class: "toast", role: "status" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}

/** Flag and team name; the name links to the team page. */
function teamSide(site, code, name, category) {
  if (!code) return h("div", { class: "side" }, flag(null, true, site), name);
  return h("a", { class: "side team-link", href: teamHref(site, code, category) }, flag(code, true, site), h("span", {}, name, " ›"));
}

function lineupsTab(d, state, site) {
  if (d.lineups.every((t) => !t.players.length)) return section(null, message(null, "Lineups haven't been published yet."));
  const playerRow = (p) => h("div", { class: "row" },
    h("span", { class: "shirt num" }, p.number),
    h("span", { class: "grow" }, p.name, " ", p.gk ? h("span", { class: "tag" }, "GK") : null, " ", p.captain ? h("span", { class: "tag" }, "C") : null),
    p.events.length ? h("span", { class: "events num" }, p.events.map((e) => h("span", {},
      ["G", "Y", "R"].includes(e.kind) ? h("span", { class: `card-chip card-${e.kind}`, title: "Card" }) : h("span", { class: "dot", title: "Goal" }),
      `${e.minute}'`))) : null);
  return d.lineups.flatMap((team) => [
    section(`${displayTeam(team.team, site)} · Starting XI`, team.players.filter((p) => p.started).map(playerRow)),
    team.players.some((p) => !p.started) ? section(`${displayTeam(team.team, site)} · Substitutes`, team.players.filter((p) => !p.started).map(playerRow)) : null,
    team.staff.length ? section(`${displayTeam(team.team, site)} · Staff`, team.staff.map((s) => h("div", { class: "row" },
      h("span", { style: "width:90px;color:var(--muted)" }, s.role.charAt(0) + s.role.slice(1).toLowerCase()), s.name))) : null,
  ]);
}

function goalsTab(d, state, site) {
  if (!d.goals.length) return section(null, message(null, state === "upcoming" ? "The match hasn't started yet." : "No goals."));
  return section(null, d.goals.map((g) => h("div", { class: "row" },
    h("span", { class: "minute num" }, `${g.minute}'`),
    h("div", { class: "grow" }, h("div", {}, `#${g.shirt} ${g.player}`), h("div", { class: "caption" }, `${displayTeam(g.team, site)} · ${g.action}`)),
    h("strong", { class: "num" }, g.score))));
}

function cardsTab(d, state, site) {
  if (!d.cards.length) return section(null, message(null, state === "upcoming" ? "The match hasn't started yet." : "No cards."));
  return section(null, d.cards.map((c) => h("div", { class: "row" },
    h("span", { class: "minute num" }, `${c.minute}'`),
    h("span", { class: `card-chip card-${c.type.toUpperCase()}` }),
    h("div", { class: "grow" }, h("div", {}, `#${c.shirt} ${c.player}`),
      h("div", { class: "caption" }, [displayTeam(c.team, site), c.umpire ? `Umpire: ${c.umpire}` : null].filter(Boolean).join(" · "))))),
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

function h2hTab(d, state, site) {
  if (!d.headToHead.length) return section(null, message(null, "These teams haven't met before."));
  return d.headToHead.map((g) => section(g.category, g.matches.map((m) =>
    h("a", { class: "row", href: link(`m/${cid(site, m.id)}`) },
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
  const fav = S.favTournaments.has(id);
  topbar.replaceChildren(subBar(name, sub, h("button", {
    class: `icon-btn fav-toggle${fav ? " on" : ""}`, onclick: () => { toggleFavTournament(id); toast(fav ? "Removed from favourites" : "Added to favourites"); },
    "aria-pressed": String(fav), "aria-label": fav ? "Remove tournament from favourites" : "Add tournament to favourites",
  }, fav ? "★" : "☆")));

  const site = siteOf(id);
  const entry = S.tournamentData.get(id) ?? {};
  let body;
  if (tab === "matches") body = tournamentMatches(id, matches);
  else if (tab === "standings") body = standingsTab(entry, site);
  else body = tournamentStatsTab(entry, site);
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

function standingsTab(entry, site) {
  if (!entry.standings) {
    return entry.standingsError ? section(null, message(null, `Couldn't load standings: ${entry.standingsError}`)) : section(null, spinnerRow());
  }
  if (!entry.standings.length) return section(null, message(null, "No standings yet."));
  const keyText = { P: "P played", W: "W won", D: "D drawn", L: "L lost", GF: "GF goals for", GA: "GA goals against", GD: "GD goal difference" };
  return entry.standings.map((pool) => {
    // Only the columns this tournament publishes (Hockey India often has no GF/GA).
    const shown = P.STANDING_COLUMNS.map((c, i) => [c, i]).filter(([, i]) => pool.rows.some((r) => r.values[i] != null));
    const cell = (c, v) => (v == null ? "–" : c === "GD" && v > 0 ? `+${v}` : v);
    return section(pool.pool,
      h("div", { class: "scroll-x" }, h("table", { class: "tbl num" },
        h("thead", {}, h("tr", {}, h("th", { class: "left" }, "#"), h("th", { class: "left" }, "Team"), shown.map(([c]) => h("th", {}, c)))),
        h("tbody", {}, pool.rows.map((r) => h("tr", {},
          h("td", { class: "left strong" }, r.rank),
          h("td", { class: "left player" }, h("span", { class: "who" }, flag(teamCodeFor(r.team, site), false, site), h("span", {}, displayTeam(r.team, site)))),
          shown.map(([c, i]) => h("td", { class: c === "Pts" ? "strong" : "" }, cell(c, r.values[i])))))))),
      [...pool.notes, shown.filter(([c]) => keyText[c]).map(([c]) => keyText[c]).join(" · ")].join("\n"));
  });
}

function tournamentStatsTab(entry, site) {
  if (!entry.stats) {
    return entry.statsError ? section(null, message(null, `Couldn't load statistics: ${entry.statsError}`)) : section(null, spinnerRow());
  }
  const { scorers, cards } = entry.stats;
  const playerCell = (r) => h("td", { class: "left player" },
    h("span", { class: "who" }, flag(r.code, false, site), h("span", {}, r.player, h("small", {}, `#${r.shirt} · ${displayTeam(r.team, site)}`))));
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
    if (liveToday) {
      covering(P.today()).forEach((t) => loadMatches(t.id, true));
      sectionsFor(P.today()).flatMap((s) => s.matches)
        .filter((m) => P.matchState(m.status) === "live").forEach((m) => loadClock(m.id, true));
    }
  } else if (r.name === "m") {
    const status = S.matchDetails.get(r.id)?.detail?.status ?? S.matchIndex.get(r.id)?.status;
    if (P.matchState(status) === "live") loadMatchDetail(r.id);
  } else if (r.name === "t") {
    const live = (S.matchCache.get(r.id) ?? []).filter((m) => P.matchState(m.status) === "live");
    if (live.length) { loadMatches(r.id, true); live.forEach((m) => loadClock(m.id, true)); }
  }
}, 30_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const r = route();
  if (r.name === "home") refreshHome();
  else if (r.name === "m") loadMatchDetail(r.id);
  else if (r.name === "t") loadTournament(r.id);
});

// ---------- Team page

function renderTeam(key, category) {
  const [site, code] = splitTeam(key);
  const name = teamName(code, site);
  topbar.replaceChildren(subBar(name, category ?? "All categories"));

  const team = S.team;
  const isFav = isFavTeam(site, code);
  const parts = [h("div", { class: "team-head" }, flag(code, true, site),
    h("div", { class: "grow" }, h("strong", {}, name), h("div", { class: "caption" }, "Matches from the last 6 months and upcoming fixtures")),
    h("button", {
      class: `pill fav-btn${isFav ? " on" : ""}`, onclick: () => toggleFavourite(site, code), "aria-pressed": String(isFav),
    }, isFav ? "★ Favourite" : "☆ Add to favourites"))];

  // Same category ↔ every team from this country.
  const lastCategory = category ?? S.teamCategory.get(key) ?? null;
  if (lastCategory) {
    parts.push(h("div", { class: "seg", role: "tablist" },
      h("button", { role: "tab", "aria-selected": String(!!category), onclick: () => location.replace(teamHref(site, code, lastCategory)) }, lastCategory),
      h("button", { role: "tab", "aria-selected": String(!category), onclick: () => location.replace(teamHref(site, code, null)) }, "All categories")));
  }

  if (!team || team.key !== key || team.category !== category) {
    parts.push(section(null, spinnerRow()));
    view.replaceChildren(...parts);
    return;
  }

  const matches = teamMatches(team);
  const results = matches.filter((m) => P.matchState(m.status) !== "upcoming").sort((a, b) => b.start - a.start);
  const fixtures = matches.filter((m) => P.matchState(m.status) === "upcoming").sort((a, b) => a.start - b.start);
  const checked = team.ids.filter((id) => S.matchCache.has(id) || S.failed.has(id)).length;

  if (team.busy) {
    parts.push(section(null, spinnerRow(team.ids.length
      ? `Checking tournaments… ${checked} of ${team.ids.length}`
      : "Finding tournaments from the last 6 months…")));
  }
  if (fixtures.length) parts.push(section("Upcoming", fixtures.map((m) => matchRow(m, { showCompetition: true, showDate: true }))));
  if (results.length) parts.push(section("Results", results.map((m) => matchRow(m, { showCompetition: true, showDate: true }))));
  if (!team.busy && !matches.length) {
    parts.push(section(null, message("No matches found",
      category ? `No ${category} matches for ${name} in the last 6 months. Try "All categories".` : `No matches for ${name} in the last 6 months.`)));
  }
  if (!team.busy && team.ids.some((id) => S.failed.has(id))) {
    parts.push(section(null, message(null, "Some tournaments couldn't be checked. Open this page again to retry.")));
  }
  view.replaceChildren(...parts);
}

// ---------- Tournaments menu

const drawer = h("div", { id: "menu", class: "drawer", hidden: true });
document.body.append(drawer);

function openMenu() {
  S.menuOpen = true;
  render();
  drawer.querySelector("button, a")?.focus();
}
function closeMenu() {
  S.menuOpen = false;
  render();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.menuOpen) closeMenu(); });

function renderMenu() {
  drawer.hidden = !S.menuOpen;
  document.body.classList.toggle("no-scroll", S.menuOpen);
  if (!S.menuOpen) { drawer.replaceChildren(); return; }

  const t = P.today();
  const all = [...S.tournaments.values()].filter((x) => isActive(x.site));
  const groups = [
    ["In progress", all.filter((x) => x.startKey <= t && t <= x.endKey).sort((a, b) => a.startKey.localeCompare(b.startKey))],
    ["Upcoming", all.filter((x) => x.startKey > t).sort((a, b) => a.startKey.localeCompare(b.startKey))],
    ["Recent", all.filter((x) => x.endKey < t).sort((a, b) => b.endKey.localeCompare(a.endKey))],
  ];
  const range = (x) => {
    const f = (k) => P.keyToDate(k).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return x.startKey === x.endKey ? f(x.startKey) : `${f(x.startKey)} – ${f(x.endKey)} ${x.endKey.slice(0, 4)}`;
  };
  const item = (x) => h("a", { class: "row", href: link(`t/${x.id}`) },
    h("div", { class: "grow" },
      h("div", { class: "menu-name" }, x.name),
      h("div", { class: "caption" }, [x.startKey ? range(x) : null, x.category, x.location, siteTag(x.site)].filter(Boolean).join(" · "))),
    h("span", { class: "chev" }, icon("right", 16)));
  const favTournaments = [...S.favTournaments.values()].map((f) => ({ ...f, ...S.tournaments.get(f.id) }))
    .sort((a, b) => String(b.startKey).localeCompare(String(a.startKey)));
  const favTeams = [...S.favourites].map((k) => { const [site, code] = splitTeam(k); return { site, code, name: teamName(code, site) }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = VIEW === "all" ? "All tournaments" : VIEW === "intl" ? "International tournaments" : LEAGUE === "all" ? "Domestic tournaments" : `${SITES[LEAGUE].label} tournaments`;

  drawer.replaceChildren(
    h("div", { class: "drawer-backdrop", onclick: closeMenu }),
    h("nav", { class: "drawer-panel", "aria-label": "Tournaments" },
      h("div", { class: "drawer-head" },
        h("strong", {}, title),
        h("button", { class: "icon-btn", onclick: closeMenu, "aria-label": "Close menu" }, icon("close"))),
      section(null, alertsRow()),
      section("★ Favourite teams", favTeams.length
        ? favTeams.map(({ site, code, name }) =>
            h("a", { class: "row", href: teamHref(site, code, null) }, flag(code, false, site),
              h("span", { class: "grow" }, name, siteTag(site) ? h("span", { class: "site-tag" }, siteTag(site)) : null),
              h("span", { class: "chev" }, icon("right", 16))))
        : message(null, "Open a team page and tap ☆ Add to favourites.")),
      section("★ Favourite tournaments", favTournaments.length
        ? favTournaments.map(item)
        : message(null, "Open a tournament and tap ☆ to keep its matches at the top.")),
      groups.filter(([, list]) => list.length).map(([title, list]) => section(title, list.map(item))),
      !all.length ? section(null, anyCatalogLoading() ? spinnerRow() : message(null, catalogError() ?? "No tournaments loaded yet.")) : null,
      anyMoreCatalog() ? h("button", { class: "pill load-more", onclick: loadNextCatalogPage, disabled: anyCatalogLoading() },
        anyCatalogLoading() ? "Loading…" : "Load older tournaments") : null));
}

// Tick live minutes every second without redrawing the page.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-clock]")) {
    const text = clockText(Number(el.getAttribute("data-clock")));
    if (text && el.textContent !== text) el.textContent = text;
  }
}, 1000);

// =================================================================== Start

applyTheme();

// Background script for goal alerts.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// Show the last saved data at once, then fetch fresh data (today's tournaments are re-read).
const restored = restoreSnapshot();
rebuildDays();
onRoute();
startSites().then(async () => {
  if (restored) await Promise.all(covering(P.today()).map((t) => loadMatches(t.id, true)));
  // No international match live right now: show All instead.
  const liveIntl = sectionsFor(P.today()).some((sec) => sec.matches.some((m) => P.matchState(m.status) === "live"));
  if (!viewChosen && VIEW === "intl" && !liveIntl) setView("all");
});
