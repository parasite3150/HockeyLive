// Checks the page readers against saved copies of real FIH and Hockey India pages.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
import * as P from "../public/parse.js";

const page = (name) =>
  new DOMParser().parseFromString(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), "text/html");

test("FIH tournament list", () => {
  const { tournaments, hasMore } = P.parseCatalog(page("fih-catalog.html"));
  assert.equal(tournaments.length, 12);
  assert.ok(hasMore);
  assert.deepEqual(tournaments.find((t) => t.id === 1926), {
    id: 1926, name: "Sultan Of Johor Cup 2026", startKey: "2026-10-17", endKey: "2026-10-24",
    location: "Johor, Malaysia", category: "Under 21 Mens Outdoor",
  });
  // A range across two months: "18 Sep - 3 Oct 2026"
  const asianGames = tournaments.find((t) => t.id === 1916);
  assert.equal(asianGames.startKey, "2026-09-18");
  assert.equal(asianGames.endKey, "2026-10-03");
});

test("date ranges across a year end and single days", () => {
  assert.deepEqual(P.parseDateRange("28 Dec 2025 - 3 Jan 2026"), { start: "2025-12-28", end: "2026-01-03" });
  assert.deepEqual(P.parseDateRange("5 Oct 2026"), { start: "2026-10-05", end: "2026-10-05" });
});

test("FIH match listing", () => {
  const matches = P.parseMatchListing(page("fih-matches-1926.html"), 1926);
  assert.equal(matches.length, 12);
  const m9 = matches.find((m) => m.number === "9");
  assert.equal(m9.id, 23091);
  assert.equal(m9.home, "JPN");
  assert.equal(m9.away, "PAK");
  assert.equal(m9.stage, "RR");
  assert.equal(m9.homeScore, 2);
  assert.equal(m9.awayScore, 2);
  assert.equal(m9.status, "Official");
  assert.equal(m9.competition, "Sultan Of Johor Cup 2026");
  assert.equal(m9.start.toISOString(), "2026-10-23T09:05:00.000Z");   // 17:05 in Kuala Lumpur
  const m12 = matches.find((m) => m.number === "12");
  assert.equal(P.matchState(m12.status), "upcoming");
  assert.equal(m12.homeScore, null);
});

test("FIH match page", () => {
  const d = P.parseMatchPage(page("fih-match-23091.html"));
  assert.equal(d.scoreline, "2 - 2");
  assert.equal(d.status, "Official");
  assert.deepEqual(d.home, { name: "Japan", code: "JPN" });
  assert.equal(d.lineups.length, 2);
  for (const team of d.lineups) {
    assert.equal(team.players.filter((p) => p.started).length, 11);
    assert.equal(team.players.filter((p) => !p.started).length, 7);
  }
  assert.deepEqual(d.goals.map((g) => `${g.minute} ${g.player} ${g.score}`),
    ["18 YAMADA Seia 1 - 0", "34 HAMZA Fayyaz 1 - 1", "42 NAKAI Kazuki 2 - 1", "43 MUSTAFA Ghulam 2 - 2"]);
  assert.equal(d.cards.length, 1);
  assert.equal(d.cards[0].type, "G");
  assert.equal(d.headToHead[0].matches.length, 5);
  assert.ok(d.headToHead[0].matches[0].isThisMatch);
  assert.equal(d.live.status, "Official");
  assert.equal(d.live.seconds, 3600);
});

test("FIH tournament statistics and standings", () => {
  const stats = P.parseTournamentStats(page("fih-statistics-1926.html"));
  assert.equal(stats.scorers.rows.length, 36);
  assert.deepEqual(stats.scorers.total, [39, 22, 2, 63]);
  assert.equal(stats.cards.rows.length, 22);
  assert.deepEqual(stats.cards.total, [1, 6, 18]);

  const [pool] = P.parseStandings(page("fih-pools-1926.html"));
  assert.equal(pool.pool, "RR");
  assert.deepEqual(pool.rows[0], { rank: "1", team: "Malaysia", values: [4, 4, 0, 0, 16, 5, 11, 12] });
  assert.equal(pool.rows.length, 5);
});

test("Hockey India pages", () => {
  const { tournaments } = P.parseCatalog(page("hi-catalog.html"));
  assert.equal(tournaments.length, 12);
  assert.equal(tournaments[0].name, "16th Hockey India Senior Men National Championship 2026 - Division 'C'");

  const matches = P.parseMatchListing(page("hi-matches-240.html"), 240);
  assert.equal(matches.length, 9);
  assert.equal(matches[0].home, "HAP");
  assert.equal(matches[0].stage, "Pool B");
  assert.equal(matches[0].start.toISOString(), "2026-10-10T01:00:00.000Z");   // 06:30 in India

  const names = P.parseTeamCodes(page("hi-summary-240.html"));
  assert.equal(names.get("HAP"), "HOCKEY ANDHRA PRADESH");
  assert.equal(P.niceTeamName(names.get("BIH")), "Bihar (BSSA)");

  const pools = P.parseStandings(page("hi-summary-240.html"));
  assert.deepEqual(pools.map((p) => [p.pool, p.rows.length]), [["Pool A", 3], ["Pool B", 4]]);
  const raj = pools[1].rows[0];
  assert.equal(raj.team, "HOCKEY RAJASTHAN");
  assert.deepEqual(raj.values, [3, 3, 0, 0, null, null, 7, 9]);   // no goals for/against columns

  const d = P.parseMatchPage(page("hi-match-6826.html"));
  assert.equal(d.scoreline, "7 - 2");
  assert.equal(d.home.name, "BIHAR (BSSA)");
  assert.equal(d.goals[0].player, "SIDIK Md");
});

test("live clock counts on while running and stops at the end of the quarter", () => {
  const clock = { seconds: 1340, running: true, periodEnd: 30 };
  assert.equal(P.liveMinute(clock, 0, 0), 23);
  assert.equal(P.liveMinute(clock, 0, 60_000), 24);
  assert.equal(P.liveMinute(clock, 0, 3_600_000), 30);
  assert.equal(P.liveMinute({ ...clock, running: false }, 0, 60_000), 23);
});

test("Euro Hockey club tournament: long team codes and names", () => {
  const names = P.parseTeamCodes(page("ehf-summary-411.html"));
  assert.match(names.get("EDINBURGHUNIMEN"), /^Edinburgh University Men's HC/);
  assert.match(names.get("ARMINEN"), /^SV Arminen/);
  assert.ok(names.has("ORÉE"));
  assert.equal(names.size, 12);

  const matches = P.parseMatchListing(page("ehf-matches-411.html"), 411);
  assert.equal(matches.length, 12);
  assert.ok(matches.every((m) => names.has(m.home) && names.has(m.away)));
});
