// Reads the FIH competition site's pages (fih.altiusrt.com) into plain objects.
// Every function takes a parsed HTML Document, so nothing from the site is ever
// inserted into the page as HTML.

export const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const num = (el) => parseInt(text(el), 10) || 0;
const cells = (tr) => [...tr.children].filter((c) => c.tagName === "TD");
const flagCode = (el) => el?.querySelector('img[src*="/flags/"]')?.getAttribute("src")?.match(/\/(\w+)\.png/)?.[1] ?? null;

/** The .portlet box whose caption reads exactly `caption` (e.g. "Match Listing"). */
function portlet(doc, caption) {
  return [...doc.querySelectorAll(".portlet")].find((p) => text(p.querySelector(".caption")) === caption) ?? null;
}

/** Lines of a <caption>, split at <br>. */
function captionLines(caption) {
  if (!caption) return [];
  const lines = [];
  let current = "";
  for (const node of caption.childNodes) {
    if (node.nodeName === "BR") { lines.push(current); current = ""; } else { current += node.textContent; }
  }
  lines.push(current);
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ---------------------------------------------------------------- Days & times

/** "yyyy-mm-dd" for a date in the viewer's time zone. Keys sort in date order. */
export function dayKey(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
export const today = () => dayKey(new Date());
export function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);   // midday avoids daylight-saving edges
}
export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function dayRange(start, end) {
  const keys = [];
  for (let k = start; k <= end && keys.length < 120; k = addDays(k, 1)) keys.push(k);
  return keys;
}

function tzOffsetMs(ms, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}

/** Wall-clock time at the venue ("2026-10-23 17:05:00", "Asia/Kuala_Lumpur") → Date. */
export function venueTimeToDate(local, timeZone) {
  const m = local.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    let t = guess - tzOffsetMs(guess, timeZone);
    t = guess - tzOffsetMs(t, timeZone);   // second pass settles daylight-saving changes
    return new Date(t);
  } catch {
    return new Date(guess);                 // unknown zone: treat as UTC
  }
}

// ---------------------------------------------------------------- Match state

export function matchState(status) {
  const s = (status || "").toLowerCase();
  if (["official", "final", "finished", "complete", "result", "ended", "abandoned"].some((w) => s.includes(w))) return "finished";
  if (!s || ["upcoming", "fixture", "scheduled", "postponed"].some((w) => s.includes(w))) return "upcoming";
  return "live";   // "Live", "In Progress", "2nd Quarter", "Half Time", ...
}

// ---------------------------------------------------------------- Tournament list

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const month = (s) => { const i = MONTHS.indexOf(String(s).slice(0, 3).toLowerCase()); return i < 0 ? null : i + 1; };
const key3 = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "20 - 28 Nov 2026", "27 Oct - 5 Nov 2026", "28 Dec 2025 - 3 Jan 2026", "5 Oct 2026". */
export function parseDateRange(t) {
  const parts = t.split(" - ").map((s) => s.trim());
  const right = parts[parts.length - 1].split(" ");
  if (right.length !== 3) return null;
  const [rd, rm, ry] = [+right[0], month(right[1]), +right[2]];
  if (!rd || !rm || !ry) return null;
  let [ld, lm, ly] = [rd, rm, ry];
  if (parts.length === 2) {
    const left = parts[0].split(" ");
    ld = +left[0];
    if (!ld) return null;
    if (left.length >= 2 && month(left[1])) lm = month(left[1]);
    if (left.length >= 3 && +left[2]) ly = +left[2]; else if (lm > rm) ly = ry - 1;
  }
  return { start: key3(ly, lm, ld), end: key3(ry, rm, rd) };
}

export function parseCatalog(doc) {
  const box = doc.querySelector("#admin_list_of_competitions") ?? doc;
  const tournaments = [];
  for (const tr of box.querySelectorAll("table tr")) {
    const td = cells(tr);
    const link = td[0]?.querySelector('a[href*="/competitions/"]');
    const id = link?.getAttribute("href").match(/\/competitions\/(\d+)/)?.[1];
    const dates = td[1] && parseDateRange(text(td[1]));
    if (!id || !dates) continue;
    tournaments.push({
      id: +id, name: text(link), startKey: dates.start, endKey: dates.end,
      location: text(td[2]) || null, category: text(td[3]) || null,
    });
  }
  return { tournaments, hasMore: !!doc.querySelector('a[rel="next"]') };
}

// ---------------------------------------------------------------- Match listing

export function parseMatchListing(doc, competitionID) {
  const competition = text(doc.querySelector(".competition_header h1") ?? doc.querySelector("h1")) || "FIH";
  const table = portlet(doc, "Match Listing")?.querySelector("table");
  if (!table) return [];
  const matches = [];
  for (const tr of table.querySelectorAll("tr")) {
    const td = cells(tr);
    if (td.length < 6) continue;
    const when = tr.querySelector("[data-datetimelocal__notimechange]");
    const link = td[2].querySelector('a[href*="/matches/"]');
    const id = link?.getAttribute("href").match(/\/matches\/(\d+)/)?.[1];
    if (!when || !id) continue;
    const timeZone = when.getAttribute("data-timezone") || "UTC";
    const start = venueTimeToDate(when.getAttribute("data-datetimelocal__notimechange"), timeZone);
    if (!start) continue;

    // "JPN v PAK (RR)" → JPN, PAK, RR
    let details = text(link), stage = null;
    const st = details.match(/^(.*)\(([^()]*)\)$/);
    if (st) { details = st[1].trim(); stage = st[2].trim(); }
    const teams = details.split(" v ");
    if (teams.length !== 2) continue;

    // "8 - 3", "2 - 2 (3 - 2)" or "-"
    const sc = text(td[3]).match(/^(\d+)\s*-\s*(\d+)(.*)$/);
    matches.push({
      id: +id, number: text(td[0]), start, timeZone,
      home: teams[0].trim(), away: teams[1].trim(), stage,
      homeScore: sc ? +sc[1] : null, awayScore: sc ? +sc[2] : null,
      scoreNote: sc && sc[3].trim() ? sc[3].trim() : null,
      status: text(td[4]), venue: text(td[5]) || null,
      competition, competitionID,
    });
  }
  return matches;
}

// ---------------------------------------------------------------- Match page

export function parseMatchPage(doc) {
  const header = doc.querySelector(".match_header");
  const teamHeads = header ? [...header.querySelectorAll(".col-md-4 h2")] : [];
  const detail = {
    competition: text(header?.querySelector("h2.text-center")) || null,
    stage: text(header?.querySelector("h3.text-center")) || null,
    home: teamHeads[0] ? { name: text(teamHeads[0]), code: flagCode(teamHeads[0]) } : null,
    away: teamHeads[1] ? { name: text(teamHeads[1]), code: flagCode(teamHeads[1]) } : null,
    scoreline: text(doc.querySelector(".match_scoreline")) || null,
    status: text(doc.querySelector(".match_status")) || null,
    live: parseLiveClock(doc),
    lineups: [], goals: [], cards: [], headToHead: [],
  };

  // Lineups: one .portlet per team.
  const lineupPane = doc.querySelector('[id^="lineups"]');
  for (const box of lineupPane?.querySelectorAll(".portlet") ?? []) {
    const team = { team: text(box.querySelector(".caption")), players: [], staff: [] };
    for (const tr of box.querySelectorAll("tr")) {
      const td = cells(tr);
      if (td.length < 2) continue;
      const first = text(td[0]);
      let name = text(td[1]);
      if (/^\d+$/.test(first) && td.length >= 3) {
        const events = [...tr.querySelectorAll("span.badge")].map((b) => ({
          minute: text(b),
          kind: [...b.classList].find((c) => c.startsWith("type_"))?.slice(5) ?? "",
        }));
        team.players.push({
          number: first,
          name: name.replace("(GK)", "").replace("(C)", "").trim(),
          gk: name.includes("(GK)"), captain: name.includes("(C)"),
          started: text(td[2]).toUpperCase() === "X",
          events,
        });
      } else if (first && name) {
        team.staff.push({ role: first, name });
      }
    }
    detail.lineups.push(team);
  }

  for (const tr of doc.querySelectorAll("#goals tr")) {
    const t = cells(tr).map(text);
    if (t.length >= 6) detail.goals.push({ team: t[0], minute: t[1], shirt: t[2], player: t[3], action: t[4], score: t[5] });
  }
  for (const tr of doc.querySelectorAll("#cards tr")) {
    const t = cells(tr).map(text);
    if (t.length >= 6) detail.cards.push({ team: t[0], minute: t[1], shirt: t[2], player: t[3], type: t[4], umpire: t[5] });
  }

  // Head to head: an <h5> category followed by its table.
  for (const h5 of doc.querySelectorAll("#preview h5")) {
    let el = h5.nextElementSibling;
    while (el && el.tagName !== "TABLE" && !el.querySelector?.("table")) el = el.nextElementSibling;
    const table = el?.tagName === "TABLE" ? el : el?.querySelector("table");
    const matches = [];
    for (const tr of table?.querySelectorAll("tr") ?? []) {
      const td = cells(tr);
      const id = td[3]?.querySelector('a[href*="/matches/"]')?.getAttribute("href").match(/\/matches\/(\d+)/)?.[1];
      if (td.length < 7 || !id) continue;
      matches.push({
        id: +id, competition: text(td[0]), date: text(td[2]), teams: text(td[3]),
        status: text(td[5]), scoreline: text(td[6]), isThisMatch: tr.classList.contains("info"),
      });
    }
    if (matches.length) detail.headToHead.push({ category: text(h5), matches });
  }
  return detail;
}

/**
 * The match clock the site keeps for its own live updates
 * (the data-pusher-realtime attribute on the match page).
 */
export function parseLiveClock(doc) {
  const raw = doc.querySelector("[data-pusher-realtime]")?.getAttribute("data-pusher-realtime");
  if (!raw) return null;
  try {
    const m = JSON.parse(raw)?.data?.match;
    if (!m) return null;
    const period = m.ladder?.[m.status] ?? {};
    return {
      status: m.status ?? null,                 // "2nd Quarter", "Half Time", ...
      short: period.short ?? null,              // "Q2", "HT", ...
      scoreline: m.scoreline ?? null,
      seconds: Number(m.seconds) || 0,          // match time elapsed, in seconds
      periodEnd: Number(period.finish) || null, // minute the current period ends at
      running: m.clockstatus === "running",
    };
  } catch {
    return null;
  }
}

/** Minute of play for a clock read at `fetchedAt`, counting on while it runs. */
export function liveMinute(clock, fetchedAt, now = Date.now()) {
  let seconds = clock.seconds;
  if (clock.running) seconds += Math.max(0, (now - fetchedAt) / 1000);
  let minute = Math.max(1, Math.ceil(seconds / 60));
  if (clock.periodEnd) minute = Math.min(minute, clock.periodEnd);   // don't run past the end of the quarter
  return minute;
}

// ---------------------------------------------------------------- Match statistics (JSON)

export function parseMatchStats(json) {
  const s = json?.statistics;
  if (!s) return [];
  const value = (path) => {
    let node = s;
    for (const k of path) node = node?.[k];
    const n = typeof node === "string" ? parseInt(node, 10) : node;
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  // `path` uses "TEAM" where "home"/"away" goes.
  const row = (label, path, { hideIfZero = false, suffix = "" } = {}) => {
    const h = value(path.map((k) => (k === "TEAM" ? "home" : k)));
    const a = value(path.map((k) => (k === "TEAM" ? "away" : k)));
    if (h === null && a === null) return null;
    if (hideIfZero && !h && !a) return null;   // not recorded for this match
    return { label, home: `${h ?? 0}${suffix}`, away: `${a ?? 0}${suffix}` };
  };
  const summary = [
    row("Goals", ["goal", "TEAM", "match", "all"]),
    row("Field goals", ["goal", "TEAM", "match", "FG"]),
    row("Penalty corner goals", ["goal", "TEAM", "match", "PC"]),
    row("Penalty stroke goals", ["goal", "TEAM", "match", "PS"]),
    row("Penalty corners", ["pc", "TEAM", "match", "all"]),
    row("Penalty strokes", ["ps", "TEAM", "match", "all"]),
    row("Circle entries", ["circle", "TEAM", "match", "all"], { hideIfZero: true }),
    row("Shots", ["shot", "TEAM", "match", "all"], { hideIfZero: true }),
    row("Possession", ["poss", "percentage", "TEAM", "match"], { hideIfZero: true, suffix: "%" }),
    row("Green cards", ["card", "TEAM", "match", "G"]),
    row("Yellow cards", ["card", "TEAM", "match", "Y"]),
    row("Red cards", ["card", "TEAM", "match", "R"]),
  ].filter(Boolean);
  const byQuarter = (title, stat, hideIfZero = false) => {
    const rows = [1, 2, 3, 4].map((q) => row(`Q${q}`, [stat, "TEAM", `P${q}`, "all"])).filter(Boolean);
    if (!rows.length || (hideIfZero && rows.every((r) => r.home === "0" && r.away === "0"))) return null;
    return { title, rows };
  };
  return [
    summary.length ? { title: "Summary", rows: summary } : null,
    byQuarter("Goals by quarter", "goal"),
    byQuarter("Penalty corners by quarter", "pc"),
    byQuarter("Circle entries by quarter", "circle", true),
  ].filter(Boolean);
}

// ---------------------------------------------------------------- Tournament statistics & standings

export function parseTournamentStats(doc) {
  const read = (caption, columns) => {
    const table = portlet(doc, caption)?.querySelector("table");
    const out = { rows: [], total: null, note: captionLines(table?.querySelector("caption"))[0] ?? null };
    for (const tr of table?.querySelectorAll("tr") ?? []) {
      if (tr.classList.contains("total")) {
        out.total = [...tr.querySelectorAll("th")].map(num);
        continue;
      }
      const td = cells(tr);
      if (td.length < 3 + columns) continue;
      out.rows.push({
        team: text(td[0]), code: flagCode(td[0]), shirt: text(td[1]), player: text(td[2]),
        values: td.slice(3, 3 + columns).map(num),
      });
    }
    return out;
  };
  return { scorers: read("Goal Scorers", 4), cards: read("Cards", 3) };
}

// Standings columns, matched by heading (FIH: "Played", Hockey India: "GP" with title="Played").
export const STANDING_COLUMNS = ["P", "W", "D", "L", "GF", "GA", "GD", "Pts"];
const COLUMN_NAMES = {
  P: ["played", "gp", "p"], W: ["wins", "w", "won"], D: ["draws", "d", "drawn"], L: ["losses", "l", "lost"],
  GF: ["goals for", "gf"], GA: ["goals against", "ga"], GD: ["goal difference", "gd"], Pts: ["points", "pts", "pt"],
};

/** Every standings table on the page: one per pool, with whichever columns it has. */
export function parseStandings(doc) {
  const pools = [];
  for (const table of doc.querySelectorAll("table")) {
    const heads = [...(table.querySelector("thead tr") ?? table.querySelector("tr"))?.children ?? []];
    const labels = heads.map((th) => (th.getAttribute("title") || text(th)).toLowerCase());
    const teamCol = labels.findIndex((l) => l === "team");
    // "P" alone is ambiguous (FIH-style "P" = played isn't used; Hockey India uses "P" for points),
    // so read Points from its title first, then fall back to the last column.
    const col = {};
    for (const key of STANDING_COLUMNS) {
      const names = COLUMN_NAMES[key];
      let i = labels.findIndex((l) => names.includes(l) && !(key === "P" && l === "p"));
      if (key === "Pts" && i < 0) i = labels.length - 1;
      if (i >= 0 && i !== teamCol) col[key] = i;
    }
    if (teamCol < 0 || col.Pts == null || col.W == null) continue;
    const rankCol = labels.findIndex((l) => ["rank", "r", "#"].includes(l));

    const rows = [];
    for (const tr of table.querySelectorAll("tr")) {
      const td = cells(tr);
      if (td.length <= Math.max(teamCol, col.Pts)) continue;
      const values = STANDING_COLUMNS.map((k) => (col[k] == null ? null : parseInt(text(td[col[k]]), 10)));
      if (!text(td[teamCol]) || Number.isNaN(values[STANDING_COLUMNS.indexOf("Pts")])) continue;
      rows.push({ rank: rankCol >= 0 ? text(td[rankCol]) : String(rows.length + 1), team: text(td[teamCol]), values });
    }
    if (!rows.length) continue;

    // Pool name: the <h4> before the table (FIH), or the tab that shows it (Hockey India).
    let pool = null;
    const pane = table.closest(".tab-pane[id]");
    if (pane) pool = text(doc.querySelector(`a[href="#${pane.id}"]`));
    if (!pool) {
      let el = table.closest(".table-responsive") ?? table;
      while (el && !pool) { el = el.previousElementSibling; if (el?.tagName === "H4") pool = text(el); }
    }
    pools.push({ pool: pool || "Standings", notes: captionLines(table.querySelector("caption")), rows });
  }
  return pools;
}

/** Team codes and names from a tournament's summary page ("Teams" box): HAP → HOCKEY ANDHRA PRADESH. */
export function parseTeamCodes(doc) {
  const names = new Map();
  for (const tr of portlet(doc, "Teams")?.querySelectorAll("tr") ?? []) {
    const td = cells(tr);
    if (td.length >= 2 && text(td[0]) && /^[\p{Lu}0-9]{2,20}$/u.test(text(td[1]))) names.set(text(td[1]), text(td[0]));
  }
  return names;
}

/** "HOCKEY ANDHRA PRADESH" → "Hockey Andhra Pradesh"; "BIHAR (BSSA)" → "Bihar (BSSA)". Mixed case is left alone. */
export function niceTeamName(name) {
  if (!name || name !== name.toUpperCase()) return name;
  return name.split(" ").map((w) => (/^\(.*\)$|^&$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
}

// ---------------------------------------------------------------- Countries

const NAMES = {
  ARG: "Argentina", AUS: "Australia", AUT: "Austria", BEL: "Belgium", CAN: "Canada", CHI: "Chile",
  CHN: "China", ENG: "England", ESP: "Spain", FRA: "France", GER: "Germany", GHA: "Ghana", IND: "India",
  IRL: "Ireland", ITA: "Italy", JPN: "Japan", KOR: "Korea", MAS: "Malaysia", NAM: "Namibia",
  NED: "Netherlands", NZL: "New Zealand", PAK: "Pakistan", POL: "Poland", RSA: "South Africa",
  SCO: "Scotland", SUI: "Switzerland", TPE: "Chinese Taipei", UKR: "Ukraine", URU: "Uruguay", USA: "USA",
  WAL: "Wales", EGY: "Egypt", NGR: "Nigeria", KEN: "Kenya", ZIM: "Zimbabwe", OMA: "Oman",
  BAN: "Bangladesh", SRI: "Sri Lanka", SGP: "Singapore", THA: "Thailand", INA: "Indonesia", BRA: "Brazil",
  MEX: "Mexico", TTO: "Trinidad & Tobago", CZE: "Czechia", NCA: "Nicaragua", GUA: "Guatemala",
  CRC: "Costa Rica", PAN: "Panama", ESA: "El Salvador", HON: "Honduras", PER: "Peru", PAR: "Paraguay",
  VAN: "Vanuatu", FIJ: "Fiji", SAM: "Samoa", TGA: "Tonga", PNG: "Papua New Guinea", HKG: "Hong Kong",
  UZB: "Uzbekistan", KAZ: "Kazakhstan", IRI: "Iran", QAT: "Qatar",
};
export const countryName = (code) => NAMES[code] ?? code;
export const countryCode = (name) =>
  Object.keys(NAMES).find((k) => NAMES[k].toLowerCase() === String(name).toLowerCase()) ?? (NAMES[name] ? name : null);
export const flagURL = (code) => (code ? `https://hockey-cdn.altius.live/resources/flags/round/${code}.png` : null);
