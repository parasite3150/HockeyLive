import Foundation

enum MatchState {
    case upcoming, live, finished
}

/// One row of the "Match Listing" table on fih.altiusrt.com/competitions/{id}/matches.
struct Match: Identifiable, Hashable {
    let id: Int                 // from the link .../matches/23091
    let number: String          // "Match #" column
    let start: Date             // kick-off as an absolute instant
    let timeZone: TimeZone      // the venue's time zone, e.g. Asia/Kuala_Lumpur (used to read the site's times)
    let homeCode: String        // "JPN"
    let awayCode: String        // "PAK"
    let stage: String?          // "RR" from "JPN v PAK (RR)"
    let homeScore: Int?
    let awayScore: Int?
    let scoreNote: String?      // anything after the score, e.g. a shootout "(3 - 2)"
    let status: String          // "Official", "Upcoming", ...
    let venue: String?
    let competition: String     // tournament name
    let competitionID: Int      // tournament number, e.g. 1926

    var tournamentRoute: TournamentRoute { TournamentRoute(id: competitionID, name: competition) }

    var homeName: String { Countries.name(for: homeCode) }
    var awayName: String { Countries.name(for: awayCode) }
    var homeFlag: URL? { Countries.flagURL(for: homeCode) }
    var awayFlag: URL? { Countries.flagURL(for: awayCode) }

    var hasScore: Bool { homeScore != nil && awayScore != nil }

    var state: MatchState { Match.state(for: status) }

    static func state(for status: String) -> MatchState {
        let s = status.lowercased()
        // "Official" (also catches "Unofficial") = result is in.
        if ["official", "final", "finished", "complete", "result", "ended", "abandoned"].contains(where: s.contains) {
            return .finished
        }
        if s.isEmpty || ["upcoming", "fixture", "scheduled", "postponed"].contains(where: s.contains) {
            return .upcoming
        }
        // Any other status ("Live", "In Progress", "Half Time", ...) means the match is on.
        return .live
    }

    /// The match's calendar day in the phone's time zone, e.g. "2026-10-23".
    var dayKey: String { DayKey.from(start) }

    /// Kick-off time in the phone's time zone and 12/24-hour setting, e.g. "14:35" or "2:35 PM".
    var localTimeText: String {
        Match.timeFormatter.timeZone = .current
        return Match.timeFormatter.string(from: start)
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()
}

/// One tournament from the site's competition list.
struct Tournament: Identifiable, Hashable {
    let id: Int                 // from .../competitions/1926
    let name: String
    let startKey: String        // first day, e.g. "2026-10-17" (venue dates)
    let endKey: String          // last day
    let location: String?
    let category: String?       // "Under 21 Mens Outdoor"

    var dayKeys: [String] { DayKey.range(from: startKey, to: endKey) }

    /// Whether the tournament plays on `key`. One day of slack either side,
    /// because the phone's time zone can move a match to the day before or after.
    func covers(_ key: String) -> Bool {
        DayKey.add(-1, to: startKey) <= key && key <= DayKey.add(1, to: endKey)
    }
}

/// Matches of one tournament on one day.
struct TournamentSection: Identifiable {
    let id: String              // tournament name
    let matches: [Match]

    var route: TournamentRoute? { matches.first?.tournamentRoute }
}

/// Navigation target for a tournament's own screen.
struct TournamentRoute: Hashable {
    let id: Int
    let name: String
}

/// Days are identified by "yyyy-MM-dd" strings, which sort in date order.
enum DayKey {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// The day `date` falls on, in the phone's time zone.
    static func from(_ date: Date) -> String {
        formatter.timeZone = .current
        return formatter.string(from: date)
    }

    static func today() -> String { from(Date()) }

    static func make(_ year: Int, _ month: Int, _ day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Midday on that day in the phone's time zone (safe for titles and date maths).
    static func date(_ key: String) -> Date? {
        formatter.timeZone = .current
        return formatter.date(from: key).map { $0.addingTimeInterval(12 * 3600) }
    }

    static func add(_ days: Int, to key: String) -> String {
        guard let d = date(key), let moved = Calendar.current.date(byAdding: .day, value: days, to: d)
        else { return key }
        return from(moved)
    }

    /// Every day from `start` to `end` inclusive (capped at 120 days as a safety net).
    static func range(from start: String, to end: String) -> [String] {
        var keys: [String] = []
        var key = start
        while key <= end && keys.count < 120 {
            keys.append(key)
            key = add(1, to: key)
        }
        return keys
    }

    /// "Saturday 24 October", with the year added when it isn't this year.
    static func title(_ key: String) -> String {
        guard let d = date(key) else { return key }
        let f = DateFormatter()
        let sameYear = Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year)
        f.setLocalizedDateFormatFromTemplate(sameYear ? "EEEEdMMMM" : "EEEEdMMMMyyyy")
        return f.string(from: d)
    }
}

/// Flags come from the same CDN the website uses; names cover the usual hockey nations.
enum Countries {
    static func flagURL(for code: String) -> URL? {
        URL(string: "https://hockey-cdn.altius.live/resources/flags/round/\(code).png")
    }

    static func name(for code: String) -> String { names[code] ?? code }

    /// "Malaysia" → "MAS" (for pages that show only the team name).
    static func code(forName name: String) -> String? {
        names.first { $0.value.caseInsensitiveCompare(name) == .orderedSame }?.key
    }

    private static let names: [String: String] = [
        "ARG": "Argentina", "AUS": "Australia", "AUT": "Austria", "BEL": "Belgium",
        "CAN": "Canada", "CHI": "Chile", "CHN": "China", "ENG": "England", "ESP": "Spain",
        "FRA": "France", "GER": "Germany", "GHA": "Ghana", "IND": "India", "IRL": "Ireland",
        "ITA": "Italy", "JPN": "Japan", "KOR": "Korea", "MAS": "Malaysia", "NAM": "Namibia",
        "NED": "Netherlands", "NZL": "New Zealand", "PAK": "Pakistan", "POL": "Poland",
        "RSA": "South Africa", "SCO": "Scotland", "SUI": "Switzerland", "TPE": "Chinese Taipei",
        "UKR": "Ukraine", "URU": "Uruguay", "USA": "USA", "WAL": "Wales", "EGY": "Egypt",
        "NGR": "Nigeria", "KEN": "Kenya", "ZIM": "Zimbabwe", "OMA": "Oman", "BAN": "Bangladesh",
        "SRI": "Sri Lanka", "SGP": "Singapore", "THA": "Thailand", "INA": "Indonesia",
        "BRA": "Brazil", "MEX": "Mexico", "TTO": "Trinidad & Tobago", "CZE": "Czechia",
        "NCA": "Nicaragua", "GUA": "Guatemala", "CRC": "Costa Rica", "PAN": "Panama",
        "ESA": "El Salvador", "HON": "Honduras", "PER": "Peru", "PAR": "Paraguay",
        "VAN": "Vanuatu", "FIJ": "Fiji", "SAM": "Samoa", "TGA": "Tonga", "PNG": "Papua New Guinea",
        "HKG": "Hong Kong", "UZB": "Uzbekistan", "KAZ": "Kazakhstan", "IRI": "Iran", "QAT": "Qatar",
    ]
}
