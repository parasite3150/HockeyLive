// The Altius competition sites the app reads. (Files starting with "_" are not API routes.)
// Every site except FIH serves its own match statistics.
const altius = (host) => ({
  base: `https://${host}`,
  stats: (id) => `https://${host}/rt/matches/${id}?embeds=statistics`,
});

export const SITES = {
  // International (FIH): statistics come from tms.fih.ch.
  fih: {
    base: "https://fih.altiusrt.com",
    stats: (id) => `https://tms.fih.ch/rt/matches/${id}?embeds=statistics`,
  },
  ehf: altius("eurohockey.altiusrt.com"),       // European Hockey Federation (International)
  hi: altius("hockeyindia.altiusrt.com"),       // Hockey India
  ha: altius("hockeyaustralia.altiusrt.com"),   // Hockey Australia
  nz: altius("hockeynz.altiusrt.com"),          // Hockey New Zealand
  fhc: altius("fhc.altiusrt.com"),              // Field Hockey Canada
  saha: altius("saha.altiusrt.com"),            // South African Hockey Association
  dhu: altius("dhu.altiusrt.com"),              // Dansk Hockey Union (Denmark)
};

/**
 * Same order as SITE_KEYS in public/app.js: a site's position is part of the IDs in app links
 * (position × 100,000,000 + the site's own ID). Add new sites at the end; never reorder.
 */
export const SITE_KEYS = ["fih", "hi", "ehf", "ha", "nz", "fhc", "saha", "dhu"];
export const appId = (key, id) => SITE_KEYS.indexOf(key) * 1e8 + Number(id);

export const USER_AGENT = "HockeyLive fan web app";
