// Fetches pages from the FIH competition site for the web app.
// Browsers can't read another site's pages directly, so the app asks this
// function instead. Only the handful of page types the app uses are allowed.

const SITE = "https://fih.altiusrt.com";

const ALLOWED_PATHS = [
  /^\/competitions\?view=all&page=\d{1,4}$/,               // tournament list
  /^\/competitions\/\d{1,6}\/(matches|pools|statistics)$/,  // tournament pages
  /^\/matches\/\d{1,8}$/,                                   // match page
];

export default async function handler(req, res) {
  const { path, stats } = req.query;

  let url;
  if (typeof stats === "string" && /^\d{1,8}$/.test(stats)) {
    url = `https://tms.fih.ch/rt/matches/${stats}?embeds=statistics`;   // match statistics (JSON)
  } else if (typeof path === "string" && ALLOWED_PATHS.some((re) => re.test(path))) {
    url = SITE + path;
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
    // Short shared cache: live scores stay fresh, and the FIH site isn't hit for every visitor.
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    res.status(upstream.status).send(body);
  } catch {
    res.status(502).send("Couldn't reach the FIH site.");
  }
}
