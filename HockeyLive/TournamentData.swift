import Foundation

/// The tournament's Statistics page: goal scorers and cards.
struct TournamentStats {
    var scorers: [ScorerRow] = []
    var scorersTotal: ScorerTotals?
    var scorersNote: String?            // "Day 5 after 10 games played - October 23"
    var cards: [CardTallyRow] = []
    var cardsTotal: CardTotals?
    var cardsNote: String?
}

struct ScorerRow: Identifiable {
    let id = UUID()
    let team: String
    let teamCode: String?
    let shirt: String
    let player: String
    let fieldGoals: Int
    let penaltyCorners: Int
    let penaltyStrokes: Int
    let goals: Int
}

struct ScorerTotals {
    let fieldGoals: Int, penaltyCorners: Int, penaltyStrokes: Int, goals: Int
}

struct CardTallyRow: Identifiable {
    let id = UUID()
    let team: String
    let teamCode: String?
    let shirt: String
    let player: String
    let red: Int
    let yellow: Int
    let green: Int
}

struct CardTotals {
    let red: Int, yellow: Int, green: Int
}

/// One pool's table on the Pool Standings page.
struct PoolStanding: Identifiable {
    var id: String { pool }
    let pool: String                    // "RR", "Pool A", ...
    let notes: [String]                 // "Day 5 after 10 games played...", "Points awarded for Wins: 3, ..."
    let rows: [StandingRow]
}

struct StandingRow: Identifiable {
    var id: String { team }
    let rank: String
    let team: String
    let played: Int, wins: Int, draws: Int, losses: Int
    let goalsFor: Int, goalsAgainst: Int, goalDifference: Int, points: Int

    var teamCode: String? { Countries.code(forName: team) }
}

enum TournamentDataService {
    static func statsURL(_ id: Int) -> URL {
        URL(string: "https://fih.altiusrt.com/competitions/\(id)/statistics")!
    }

    static func standingsURL(_ id: Int) -> URL {
        URL(string: "https://fih.altiusrt.com/competitions/\(id)/pools")!
    }

    static func standings(competitionID: Int) async throws -> [PoolStanding] {
        let html = try await MatchService.fetchHTML(standingsURL(competitionID))
        return StandingsParser.parse(html)
    }

    static func stats(competitionID: Int) async throws -> TournamentStats {
        let html = try await MatchService.fetchHTML(statsURL(competitionID))
        return TournamentStatsParser.parse(html)
    }
}

enum TournamentStatsParser {
    static func parse(_ html: String) -> TournamentStats {
        var stats = TournamentStats()

        let scorers = section(html, caption: "Goal Scorers", until: #"class="caption">Cards"#)
        stats.scorersNote = note(scorers)
        for row in rows(scorers) {
            let tds = cells(row)
            if row.contains(#"class="total""#) {
                let t = totals(row)
                if t.count >= 4 { stats.scorersTotal = ScorerTotals(fieldGoals: t[0], penaltyCorners: t[1], penaltyStrokes: t[2], goals: t[3]) }
                continue
            }
            guard tds.count >= 7 else { continue }
            stats.scorers.append(ScorerRow(
                team: HTML.clean(tds[0]), teamCode: flagCode(tds[0]),
                shirt: HTML.clean(tds[1]), player: HTML.clean(tds[2]),
                fieldGoals: int(tds[3]), penaltyCorners: int(tds[4]), penaltyStrokes: int(tds[5]), goals: int(tds[6])))
        }

        let cards = section(html, caption: "Cards", until: nil)
        stats.cardsNote = note(cards)
        for row in rows(cards) {
            let tds = cells(row)
            if row.contains(#"class="total""#) {
                let t = totals(row)
                if t.count >= 3 { stats.cardsTotal = CardTotals(red: t[0], yellow: t[1], green: t[2]) }
                continue
            }
            guard tds.count >= 6 else { continue }
            stats.cards.append(CardTallyRow(
                team: HTML.clean(tds[0]), teamCode: flagCode(tds[0]),
                shirt: HTML.clean(tds[1]), player: HTML.clean(tds[2]),
                red: int(tds[3]), yellow: int(tds[4]), green: int(tds[5])))
        }
        return stats
    }

    /// HTML from a portlet caption (e.g. "Goal Scorers") to the end of its table.
    private static func section(_ html: String, caption: String, until end: String?) -> String {
        guard let start = html.range(of: #"class="caption">"# + caption) else { return "" }
        var rest = html[start.upperBound...]
        if let end, let stop = rest.range(of: end) { rest = rest[..<stop.lowerBound] }
        if let tableEnd = rest.range(of: "</table>") { rest = rest[..<tableEnd.lowerBound] }
        return String(rest)
    }

    private static func note(_ html: String) -> String? {
        HTML.firstMatch(#"<caption>(.*?)<(?:BR|br|/caption)"#, in: html).map(HTML.clean)
    }

    private static func rows(_ html: String) -> [String] {
        Array(html.components(separatedBy: "<tr").dropFirst())
    }

    private static func cells(_ row: String) -> [String] {
        HTML.allMatches(#"<td[^>]*>(.*?)</td>"#, in: row, caseInsensitive: true).map { $0[0] }
    }

    private static func totals(_ row: String) -> [Int] {
        HTML.allMatches(#"<th[^>]*>(.*?)</th>"#, in: row, caseInsensitive: true).map { int($0[0]) }
    }

    private static func flagCode(_ cell: String) -> String? {
        HTML.firstMatch(#"flags/round/(\w+)\.png"#, in: cell)
    }

    private static func int(_ s: String) -> Int { Int(HTML.clean(s)) ?? 0 }
}

enum StandingsParser {
    static func parse(_ html: String) -> [PoolStanding] {
        guard let start = html.range(of: #"class="caption">Pool Standings"#) else { return [] }
        var body = html[start.upperBound...]
        if let footer = body.range(of: "BEGIN FOOTER") { body = body[..<footer.lowerBound] }

        return body.components(separatedBy: "<h4>").dropFirst().compactMap { chunk -> PoolStanding? in
            let pool = HTML.clean(String(chunk[..<(chunk.range(of: "</h4>")?.lowerBound ?? chunk.endIndex)]))
            let notes = (HTML.firstMatch(#"<caption>(.*?)</caption>"#, in: chunk) ?? "")
                .components(separatedBy: "<BR>").flatMap { $0.components(separatedBy: "<br>") }
                .map(HTML.clean).filter { !$0.isEmpty }
            let rows: [StandingRow] = chunk.components(separatedBy: "<tr").dropFirst().compactMap { row in
                let tds = HTML.allMatches(#"<td[^>]*>(.*?)</td>"#, in: row, caseInsensitive: true).map { HTML.clean($0[0]) }
                guard tds.count >= 10 else { return nil }
                let n = tds[2...9].map { Int($0) ?? 0 }
                return StandingRow(rank: tds[0], team: tds[1], played: n[0], wins: n[1], draws: n[2], losses: n[3],
                                   goalsFor: n[4], goalsAgainst: n[5], goalDifference: n[6], points: n[7])
            }
            return rows.isEmpty ? nil : PoolStanding(pool: pool, notes: notes, rows: rows)
        }
    }
}
