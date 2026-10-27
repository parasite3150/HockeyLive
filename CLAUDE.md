# Working on this repository

- **Small changes** (colours, wording, tab order, small fixes): commit and push straight to `main`. Vercel deploys `main` automatically.
- **Larger changes** (new features or screens): use a branch, test, then ask before merging into `main`.
- The live app is the web version (`public/`, `api/`), hosted on Vercel. The iOS app (`HockeyLive/`) builds with Xcode 14.2 / iOS 16 and is behind the web version.
- Data comes from fih.altiusrt.com (HTML pages) and tms.fih.ch (match statistics JSON) through `api/fih.js`. Keep the FIH / Altius data credit visible on every screen.
