// The two Altius competition sites the app reads. (Files starting with "_" are not API routes.)
export const SITES = {
  // International (FIH)
  fih: {
    base: "https://fih.altiusrt.com",
    stats: (id) => `https://tms.fih.ch/rt/matches/${id}?embeds=statistics`,
  },
  // India domestic (Hockey India); match statistics are served by the site itself.
  hi: {
    base: "https://hockeyindia.altiusrt.com",
    stats: (id) => `https://hockeyindia.altiusrt.com/rt/matches/${id}?embeds=statistics`,
  },
};

export const USER_AGENT = "HockeyLive fan web app";
