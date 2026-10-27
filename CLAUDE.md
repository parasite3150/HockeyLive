# Working on this repository

- **Small changes** (colours, wording, tab order, small fixes): commit and push straight to `main`. Vercel deploys `main` automatically.
- **Larger changes** (new features or screens): use a branch, test, then ask before merging into `main`.
- The live app is the web version (`public/`, `api/`), hosted on Vercel. The iOS app (`HockeyLive/`) builds with Xcode 14.2 / iOS 16 and is behind the web version.
- Data comes through `api/fih.js` from two Altius sites: fih.altiusrt.com (International; match statistics JSON from tms.fih.ch) and hockeyindia.altiusrt.com (India Domestic; `#/hi/...` links). Keep the data credit for the current site visible on every screen.
- Run `npm test` after changing `public/parse.js`; add a saved page to `tests/fixtures/` when a new page type is read. `npm run check-live` reads the live sites (GitHub runs it daily).
- Goal alerts: `api/push.js` (Upstash Redis via `api/_store.js`, web-push), called every minute by an external timer at `/api/push?action=check`; `public/sw.js` shows the notifications.
