import Foundation

// MARK: - Models

/// Everything on a match page (fih.altiusrt.com/matches/{id}) plus its statistics.
struct MatchDetail {
    var scoreline: String?          // "2 - 2"
    var status: String?             // "Official", "2nd Quarter", ...
    var lineups: [TeamLineup] = []
    var goals: [GoalEvent] = []
    var cards: [CardEvent] = []
    var headToHead: [HeadToHeadGroup] = []
}

struct TeamLineup: Identifiable {
    var id: String { team }
    let team: String
    let players: [Player]
    let staff: [StaffMember]

    var starters: [Player] { players.filter(\.started) }
    var substitutes: [Player] { players.filter { !$0.started } }
}

struct Player: Identifiable {
    let id = UUID()
    let number: String
    let name: String
    let isGoalkeeper: Bool
    let isCaptain: Bool
    let started: Bool               // "X" in the Min column = in the starting XI
    let events: [PlayerEvent]
}

struct PlayerEvent: Identifiable {
    let id = UUID()
    let minute: String
    let kind: String                // FG, PC, PS (goals) or G, Y, R (cards)
    var isCard: Bool { ["G", "Y", "R"].contains(kind) }
}

struct StaffMember: Identifiable {
    let id = UUID()
    let role: String                // "COACH", "MANAGER"
    let name: String
}

struct GoalEvent: Identifiable {
    let id = UUID()
    let team: String
    let minute: String
    let shirt: String
    let player: String
    let action: String              // "Field Goal", "Penalty Corner", "Penalty Stroke"
    let score: String               // score after the goal, "1 - 0"
}

struct CardEvent: Identifiable {
    let id = UUID()
    let team: String
    let minute: String
    let shirt: String
    let player: String
    let type: String                // "G", "Y", "R"
    let umpire: String
}

struct HeadToHeadGroup: Identifiable {
    var id: String { category }
    let category: String            // "Under 21 Mens Outdoor"
    let matches: [HeadToHeadMatch]
}

struct HeadToHeadMatch: Identifiable {
    let id: Int
    let competition: String
    let date: String                // "3 Dec 2024 16:30" (venue time, as the site shows it)
    let teams: String               // "JPN v PAK (Semi-Final 1)"
    let status: String
    let scoreline: String
    let isThisMatch: Bool
}

/// One line of the Stats table: label, home value, away value.
struct StatRow: Identifiable {
    var id: String { label }
    let label: String
    let home: String
    let away: String
}

struct StatTable: Identifiable {
    var id: String { title }
    let title: String
    let rows: [StatRow]
}

// MARK: - Loading

enum MatchDetailService {
    static func pageURL(_ matchID: Int) -> URL {
        URL(string: "https://fih.altiusrt.com/matches/\(matchID)")!
    }

    static func statsURL(_ matchID: Int) -> URL {
        URL(string: "https://tms.fih.ch/rt/matches/\(matchID)?embeds=statistics")!
    }

    static func detail(matchID: Int) async throws -> MatchDetail {
        let html = try await fetchText(pageURL(matchID))
        return MatchPageParser.parse(html)
    }

    static func stats(matchID: Int) async throws -> [StatTable] {
        var request = URLRequest(url: statsURL(matchID))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, _) = try await URLSession.shared.data(for: request)
        return StatsParser.parse(data)
    }

    private static func fetchText(_ url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MatchService.ServiceError.badStatus(http.statusCode)
        }
        guard let text = String(data: data, encoding: .utf8) else { throw MatchService.ServiceError.unreadable }
        return text
    }
}

// MARK: - Match page parser

enum MatchPageParser {
    static func parse(_ html: String) -> MatchDetail {
        var detail = MatchDetail()
        detail.scoreline = HTML.firstMatch(#"class="match_scoreline">(.*?)</h3>"#, in: html).map(HTML.clean)
        detail.status = HTML.firstMatch(#"class="match_status">(.*?)</span>"#, in: html).map(HTML.clean)
        detail.lineups = parseLineups(section(html, from: #"id="lineups"#))
        detail.goals = parseGoals(section(html, from: #"id="goals""#))
        detail.cards = parseCards(section(html, from: #"id="cards""#))
        detail.headToHead = parseHeadToHead(section(html, from: #"id="preview""#))
        return detail
    }

    /// The HTML of one tab: from its id to the next tab-pane.
    private static func section(_ html: String, from marker: String) -> String {
        guard let start = html.range(of: marker) else { return "" }
        let rest = html[start.upperBound...]
        let end = rest.range(of: #"class="tab-pane"#)?.lowerBound ?? rest.endIndex
        return String(rest[..<end])
    }

    private static func rows(_ html: String) -> [String] {
        html.components(separatedBy: "<tr").flatMap { $0.components(separatedBy: "<TR") }.dropFirst().map { $0 }
    }

    private static func cells(_ row: String) -> [String] {
        HTML.allMatches(#"<td[^>]*>(.*?)</td>"#, in: row, caseInsensitive: true).map { $0[0] }
    }

    private static func parseLineups(_ html: String) -> [TeamLineup] {
        html.components(separatedBy: #"class="caption">"#).dropFirst().map { chunk in
            let team = HTML.clean(String(chunk.prefix { $0 != "<" }))
            var players: [Player] = []
            var staff: [StaffMember] = []
            for row in rows(chunk) {
                let tds = cells(row)
                guard tds.count >= 2 else { continue }
                let first = HTML.clean(tds[0])
                var name = HTML.clean(tds[1])
                if Int(first) != nil, tds.count >= 3 {
                    let isGK = name.contains("(GK)"), isC = name.contains("(C)")
                    name = name.replacingOccurrences(of: "(GK)", with: "")
                        .replacingOccurrences(of: "(C)", with: "")
                        .trimmingCharacters(in: .whitespaces)
                    let events = HTML.allMatches(#"class="badge type_(\w+)[^"]*"[^>]*>\s*(\d+)"#, in: row)
                        .map { PlayerEvent(minute: $0[1], kind: $0[0]) }
                    players.append(Player(number: first, name: name, isGoalkeeper: isGK, isCaptain: isC,
                                          started: HTML.clean(tds[2]).uppercased() == "X", events: events))
                } else if !first.isEmpty, !name.isEmpty {
                    staff.append(StaffMember(role: first, name: name))
                }
            }
            return TeamLineup(team: team, players: players, staff: staff)
        }
    }

    private static func parseGoals(_ html: String) -> [GoalEvent] {
        rows(html).compactMap { row in
            let t = cells(row).map(HTML.clean)
            guard t.count >= 6 else { return nil }
            return GoalEvent(team: t[0], minute: t[1], shirt: t[2], player: t[3], action: t[4], score: t[5])
        }
    }

    private static func parseCards(_ html: String) -> [CardEvent] {
        rows(html).compactMap { row in
            let t = cells(row).map(HTML.clean)
            guard t.count >= 6 else { return nil }
            return CardEvent(team: t[0], minute: t[1], shirt: t[2], player: t[3], type: t[4], umpire: t[5])
        }
    }

    private static func parseHeadToHead(_ html: String) -> [HeadToHeadGroup] {
        html.components(separatedBy: "<h5>").dropFirst().map { chunk in
            let category = HTML.clean(String(chunk[..<(chunk.range(of: "</h5>")?.lowerBound ?? chunk.endIndex)]))
            let matches: [HeadToHeadMatch] = rows(chunk).compactMap { row in
                let tds = cells(row)
                guard tds.count >= 7,
                      let idText = HTML.firstMatch(#"/matches/(\d+)"#, in: tds[3]), let id = Int(idText)
                else { return nil }
                return HeadToHeadMatch(id: id, competition: HTML.clean(tds[0]), date: HTML.clean(tds[2]),
                                       teams: HTML.clean(tds[3]), status: HTML.clean(tds[5]),
                                       scoreline: HTML.clean(tds[6]),
                                       isThisMatch: row.prefix(40).contains(#"class="info""#))
            }
            return HeadToHeadGroup(category: category, matches: matches)
        }
        .filter { !$0.matches.isEmpty }
    }
}

// MARK: - Statistics (JSON from tms.fih.ch)

enum StatsParser {
    static func parse(_ data: Data) -> [StatTable] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let s = root["statistics"] as? [String: Any] else { return [] }

        func value(_ path: [String]) -> Int? {
            var node: Any? = s
            for key in path { node = (node as? [String: Any])?[key] }
            if let n = node as? Int { return n }
            if let d = node as? Double { return Int(d.rounded()) }
            if let t = node as? String { return Int(t) }
            return nil
        }
        /// `path` uses "TEAM" where "home"/"away" goes, e.g. ["goal", "TEAM", "match", "all"].
        func row(_ label: String, _ path: [String], hideIfZero: Bool = false, suffix: String = "") -> StatRow? {
            let h = value(path.map { $0 == "TEAM" ? "home" : $0 })
            let a = value(path.map { $0 == "TEAM" ? "away" : $0 })
            guard h != nil || a != nil else { return nil }
            if hideIfZero, (h ?? 0) == 0, (a ?? 0) == 0 { return nil }   // not recorded for this match
            return StatRow(label: label, home: "\(h ?? 0)\(suffix)", away: "\(a ?? 0)\(suffix)")
        }

        let summary = [
            row("Goals", ["goal", "TEAM", "match", "all"]),
            row("Field goals", ["goal", "TEAM", "match", "FG"]),
            row("Penalty corner goals", ["goal", "TEAM", "match", "PC"]),
            row("Penalty stroke goals", ["goal", "TEAM", "match", "PS"]),
            row("Penalty corners", ["pc", "TEAM", "match", "all"]),
            row("Penalty strokes", ["ps", "TEAM", "match", "all"]),
            row("Circle entries", ["circle", "TEAM", "match", "all"], hideIfZero: true),
            row("Shots", ["shot", "TEAM", "match", "all"], hideIfZero: true),
            row("Possession", ["poss", "percentage", "TEAM", "match"], hideIfZero: true, suffix: "%"),
            row("Green cards", ["card", "TEAM", "match", "G"]),
            row("Yellow cards", ["card", "TEAM", "match", "Y"]),
            row("Red cards", ["card", "TEAM", "match", "R"]),
        ].compactMap { $0 }

        func byQuarter(_ title: String, _ stat: String, hideIfZero: Bool = false) -> StatTable? {
            let rows = (1...4).compactMap { q in row("Q\(q)", [stat, "TEAM", "P\(q)", "all"]) }
            if rows.isEmpty { return nil }
            if hideIfZero, rows.allSatisfy({ $0.home == "0" && $0.away == "0" }) { return nil }
            return StatTable(title: title, rows: rows)
        }

        return [
            summary.isEmpty ? nil : StatTable(title: "Summary", rows: summary),
            byQuarter("Goals by quarter", "goal"),
            byQuarter("Penalty corners by quarter", "pc"),
            byQuarter("Circle entries by quarter", "circle", hideIfZero: true),
        ].compactMap { $0 }
    }
}

extension HTML {
    /// Every match of `pattern`, as arrays of capture groups.
    static func allMatches(_ pattern: String, in text: String, caseInsensitive: Bool = false) -> [[String]] {
        var options: NSRegularExpression.Options = [.dotMatchesLineSeparators]
        if caseInsensitive { options.insert(.caseInsensitive) }
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        return re.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { m in
            (1..<m.numberOfRanges).map { i in Range(m.range(at: i), in: text).map { String(text[$0]) } ?? "" }
        }
    }
}
