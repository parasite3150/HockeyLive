import { SITES, USER_AGENT } from "./_sites.js";

// Fetches pages from the Altius competition sites for the web app.
// Browsers can't read another site's pages directly, so the app asks this
// function instead. Only the two known sites, and only the handful of page
// types the app uses, are allowed.

const ALLOWED_PATHS = [
  /^\/competitions\?view=all&page=\d{1,4}$/,               // tournament list
  /^\/competitions\/\d{1,6}(\/(matches|pools|statistics))?$/, // tournament pages (summary page has team names)
  /^\/matches\/\d{1,8}$/,                                   // match page
];

/**
 * How long Vercel may keep a copy. Anything that can change during a match stays at 20 seconds
 * so live scores are fresh; pages that can't change any more are kept much longer, which makes
 * the app faster and spares the source sites.
 */
function cacheSeconds(path, stats, body, ok) {
  if (!ok) return 20;
  if (stats) return /"status"\s*:\s*"Official"/.test(body) ? 86400 : 20;          // match statistics
  if (/^\/matches\//.test(path)) return /class="match_status">\s*Official/.test(body) ? 86400 : 20;  // finished match
  const page = Number(path.match(/[?&]page=(\d+)/)?.[1] ?? 0);
  if (page > 1) return 3600;                                                 // older tournaments
  if (page === 1) return 60;                                                 // newest tournaments
  return 20;                                                                 // tournament matches, standings, statistics
}

export default async function handler(req, res) {
  const { path, stats } = req.query;
  const site = SITES[typeof req.query.site === "string" ? req.query.site : "fih"];
  if (!site) {
    res.status(400).send("Unknown site.");
    return;
  }

  let url;
  if (typeof stats === "string" && /^\d{1,8}$/.test(stats)) {
    if (!site.stats) {
      res.status(404).send("Match statistics aren't available for this site.");
      return;
    }
    url = site.stats(stats);
  } else if (typeof path === "string" && ALLOWED_PATHS.some((re) => re.test(path))) {
    url = site.base + path;
  } else {
    res.status(400).send("That page isn't available through this app.");
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: stats ? "application/json" : "text/html",
      },
    });
    const body = await upstream.text();
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds(path, stats, body, upstream.ok)}, stale-while-revalidate=60`);
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).send("Couldn't reach the competition site.");
  }
}
