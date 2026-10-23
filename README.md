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
