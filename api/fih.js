// Fetches pages from the Altius competition sites for the web app.
// Browsers can't read another site's pages directly, so the app asks this
// function instead. Only the two known sites, and only the handful of page
// types the app uses, are allowed.

const SITES = {
  // International (FIH)
  fih: {
    base: "https://fih.altiusrt.com",
    stats: (id) => `https://tms.fih.ch/rt/matches/${id}?embeds=statistics`,
  },
  // India domestic (Hockey India). Its match statistics service isn't known yet.
  hi: {
    base: "https://hockeyindia.altiusrt.com",
    stats: null,
  },
};

const ALLOWED_PATHS = [
  /^\/competitions\?view=all&page=\d{1,4}$/,               // tournament list
  /^\/competitions\/\d{1,6}\/(matches|pools|statistics)$/,  // tournament pages
  /^\/matches\/\d{1,8}$/,                                   // match page
];

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
        "User-Agent": "HockeyLive fan web app",
        Accept: stats ? "application/json" : "text/html",
      },
    });
    const body = await upstream.text();
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
    // Short shared cache: live scores stay fresh, and the source site isn't hit for every visitor.
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).send("Couldn't reach the competition site.");
  }
}
