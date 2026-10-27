# Working on this repository

- **Small changes** (colours, wording, tab order, small fixes): commit and push straight to `main`. Vercel deploys `main` automatically.
- **Larger changes** (new features or screens): use a branch, test, then ask before merging into `main`.
- The live app is the web version (`public/`, `api/`), hosted on Vercel. The iOS app (`HockeyLive/`) builds with Xcode 14.2 / iOS 16 and is behind the web version.
- Data comes through `api/fih.js` from two Altius sites: fih.altiusrt.com (International; match statistics JSON from tms.fih.ch) and hockeyindia.altiusrt.com (India Domestic; `#/hi/...` links). Keep the data credit for the current site visible on every screen.
