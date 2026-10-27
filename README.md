# Hockey Live (iOS)

A SwiftUI app for FIH hockey matches, using data from fih.altiusrt.com.

## Features
- **Day view:** swipe between match days, or use the arrows, the Today button and the calendar. Matches are grouped under tournament headers, and times are shown in the phone's time zone.
- **All tournaments:** reads the site's full competition list (previous, in progress and upcoming), one page at a time as needed.
- **Live scores:** refreshed every 30 seconds while a match is live; pull down to refresh at any time.
- **Match screen:** Lineups, Goals, Cards, Stats and Head-to-head tabs.
- **Tournament screen:** Matches, Standings and Statistics (goal scorers, then cards).
- **Home button** to return to the day view from any screen.

## Build
Requires Xcode 14.2 or later and iOS 16.

1. In Xcode, go to File > New > Project > iOS App. Name it `HockeyLive`, set Interface to SwiftUI and the minimum iOS version to 16.
2. Delete the generated `ContentView.swift` and `HockeyLiveApp.swift`.
3. Add all the files from the `HockeyLive/` folder.
4. Press Run.

Alternatively, run `xcodegen` with the included `project.yml`.

## Data sources
| Data | Page |
|---|---|
| Tournament list | `fih.altiusrt.com/competitions?view=all&page=N` |
| Matches | `fih.altiusrt.com/competitions/{id}/matches` |
| Standings | `fih.altiusrt.com/competitions/{id}/pools` |
| Tournament stats | `fih.altiusrt.com/competitions/{id}/statistics` |
| Match page | `fih.altiusrt.com/matches/{id}` |
| Match stats (JSON) | `tms.fih.ch/rt/matches/{id}?embeds=statistics` |

## Web version
The same app as a website (`public/`) for any phone or computer. On iPhone, open it in Safari and choose **Share → Add to Home Screen**.

- `public/`: the web app (plain HTML, CSS and JavaScript, no build step).
- `api/fih.js`: a small helper that fetches pages for the app, because browsers can't read another site's pages directly. Only the known sites (`api/_sites.js`) and the page types the app needs are allowed.

The web version reads several Altius competition sites, which all share the page layout above:

| View | Sites |
|---|---|
| International | FIH (fih.altiusrt.com) |
| Domestic (choose a country) | India (hockeyindia), Australia (hockeyaustralia), New Zealand (hockeynz), Canada (fhc), South Africa (saha), Denmark (dhu) — all `.altiusrt.com` |

The switch at the top offers **All** (every site, international tournaments first), **International** and **Domestic** (with a row of country chips). Tournaments can be starred (☆ on the tournament screen) to keep their matches at the top of the day list. Match and tournament IDs in app links carry their site (site position × 100,000,000 + the site's own ID; FIH IDs are unchanged).

### Deploy on Vercel (free)
1. Sign in at vercel.com with GitHub, then **Add New → Project** and import this repository.
2. Keep the defaults (Framework: Other) and click **Deploy**.
3. Every push to `main` redeploys automatically.

Every screen shows a credit naming the association(s) and Altius site(s) the data on screen comes from, and that this is an unofficial fan app.

## Tests
- `npm test` checks the page readers against saved copies of real FIH and Hockey India pages (`tests/fixtures/`).
- `npm run check-live` reads the live sites and fails if FIH or Hockey India can no longer be read (other sites only print warnings).
- GitHub runs both: the saved-page tests on every push, and the live-site check daily (GitHub emails you if it fails).

## Goal alerts
Notifications for favourite teams: kick-off, each goal (with the scorer) and full time. They are handled by `api/push.js` and `public/sw.js`.

To set them up:
1. **Storage:** in Vercel, open the project, go to **Storage → Create / Connect → Upstash (Redis)**, use the free plan and connect it to this project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` settings. Then redeploy.
2. **Timer:** at cron-job.org (free), create a job that opens `https://<your-app>.vercel.app/api/push?action=check` every minute.

The push keys are created automatically on first use. On iPhone, alerts need the app added to the Home Screen and iOS 16.4 or later.
