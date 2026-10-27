// Daily check against the live FIH and Hockey India sites: if their pages change
// so the app can no longer read them, this exits with an error (GitHub emails you).
// Run with: npm run check-live
import { DOMParser } from "linkedom";
import * as P from "../public/parse.js";
import { SITES, USER_AGENT } from "../api/_sites.js";

const problems = [];
const get = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
};
const doc = (html) => new DOMParser().parseFromString(html, "text/html");

for (const [key, site] of Object.entries(SITES)) {
  const fail = (msg) => problems.push(`[${key}] ${msg}`);
  try {
    const { tournaments } = P.parseCatalog(doc(await get(`${site.base}/competitions?view=all&page=1`)));
    if (!tournaments.length) { fail("tournament list: no tournaments read"); continue; }

    // The most recent tournament that has started, so it has finished matches.
    const today = P.today();
    const started = tournaments.filter((t) => t.startKey <= today).sort((a, b) => b.startKey.localeCompare(a.startKey));
    let checkedMatch = false;
    for (const t of started.slice(0, 4)) {
      const matches = P.parseMatchListing(doc(await get(`${site.base}/competitions/${t.id}/matches`)), t.id);
      if (!matches.length) continue;
      if (matches.some((m) => !m.home || !m.away || !m.start)) fail(`tournament ${t.id}: a match is missing teams or time`);
      const done = matches.find((m) => P.matchState(m.status) === "finished");
      if (!done) continue;
      const d = P.parseMatchPage(doc(await get(`${site.base}/matches/${done.id}`)));
      if (!d.scoreline) fail(`match ${done.id}: no score read`);
      if (!d.lineups.some((x) => x.players.length)) fail(`match ${done.id}: no lineups read`);
      if (done.homeScore + done.awayScore > 0 && !d.goals.length) fail(`match ${done.id}: no goals read`);
      if (!d.live) fail(`match ${done.id}: no live clock data read`);
      const stats = P.parseMatchStats(JSON.parse(await get(site.stats(done.id))));
      if (!stats.length) fail(`match ${done.id}: no statistics read`);
      if (!P.parseStandings(doc(await get(`${site.base}/competitions/${t.id}/pools`))).length) fail(`tournament ${t.id}: no standings read`);
      console.log(`[${key}] ok: ${tournaments.length} tournaments, ${t.name}: ${matches.length} matches, match ${done.id} read`);
      checkedMatch = true;
      break;
    }
    if (!checkedMatch) fail("couldn't find a recent tournament with a finished match to check");
  } catch (e) {
    fail(e.message);
  }
}

if (problems.length) {
  console.error("The app may not be able to read these pages any more:\n" + problems.join("\n"));
  process.exit(1);
}
