# Working on this repository

- **Small changes** (colours, wording, tab order, small fixes): commit and push straight to `main`. Vercel deploys `main` automatically.
- **Larger changes** (new features or screens): use a branch, test, then ask before merging into `main`.
- The live app is the web version (`public/`, `api/`), hosted on Vercel. The iOS app (`HockeyLive/`) builds with Xcode 14.2 / iOS 16 and is behind the web version.
- Data comes through `api/fih.js` from Altius sites listed in `api/_sites.js` and `SITES` in `public/app.js`: fih.altiusrt.com (International; match statistics JSON from tms.fih.ch), eurohockey.altiusrt.com (International; clubs and national teams, so flags fall back to code badges) and domestic sites (hockeyindia, hockeyaustralia, hockeynz, fhc, saha, dhu). The order of `SITE_KEYS` (same in both files) is part of the IDs in links: add sites at the end, never reorder. Keep the data credit for the sites on screen visible on every screen.
- Run `npm test` after changing `public/parse.js`; add a saved page to `tests/fixtures/` when a new page type is read. `npm run check-live` reads the live sites (GitHub runs it daily).
- Goal alerts: `api/push.js` (Upstash Redis via `api/_store.js`, web-push), called every minute by an external timer at `/api/push?action=check`; `public/sw.js` shows the notifications.
