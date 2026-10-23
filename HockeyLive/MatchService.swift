import Foundation

enum MatchService {
    /// One page of the site's "All" competitions list (about 12 per page, newest first).
    static func catalogURL(page: Int) -> URL {
        URL(string: "https://fih.altiusrt.com/competitions?view=all&page=\(page)")!
    }

    static func listURL(for competitionID: Int) -> URL {
        URL(string: "https://fih.altiusrt.com/competitions/\(competitionID)/matches")!
    }

    /// Tournaments on one page of the list, and whether there are older pages.
    static func catalogPage(_ page: Int) async throws -> (tournaments: [Tournament], hasMore: Bool) {
        let html = try await fetchHTML(catalogURL(page: page))
        return (CompetitionListParser.parse(html), html.contains(#"rel="next""#))
    }

    /// Every match of one tournament (past, live and upcoming).
    static func matches(competitionID: Int) async throws -> [Match] {
        let html = try await fetchHTML(listURL(for: competitionID))
        return MatchListingParser.parse(html, competitionID: competitionID)
    }

    static func fetchHTML(_ url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData   // always fresh
        request.setValue("text/html", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw ServiceError.badStatus(http.statusCode)
        }
        guard let html = String(data: data, encoding: .utf8) else { throw ServiceError.unreadable }
        return html
    }

    enum ServiceError: LocalizedError {
        case badStatus(Int), unreadable
        var errorDescription: String? {
            switch self {
            case .badStatus(let code): return "The FIH site answered with error \(code)."
            case .unreadable: return "The FIH page couldn't be read."
            }
        }
    }
}

/// Reads the "List of Competitions" table on fih.altiusrt.com/competitions?view=all.
enum CompetitionListParser {
    static func parse(_ html: String) -> [Tournament] {
        guard let body = HTML.tableBody(html) else { return [] }
        return body.components(separatedBy: "<tr>").dropFirst().compactMap(parseRow)
    }

    private static func parseRow(_ row: String) -> Tournament? {
        guard
            let link = HTML.groups(#"/competitions/(\d+)"\s*>([^<]+)</a>"#, in: row),
            let id = Int(link[0]),
            let cells = HTML.groups(#"</a>\s*</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>"#, in: row),
            let dates = parseDates(HTML.clean(cells[0]))
        else { return nil }
        let location = HTML.clean(cells[1]), category = HTML.clean(cells[2])
        return Tournament(id: id, name: HTML.clean(link[1]), startKey: dates.start, endKey: dates.end,
                          location: location.isEmpty ? nil : location,
                          category: category.isEmpty ? nil : category)
    }

    /// "20 - 28 Nov 2026", "27 Oct - 5 Nov 2026", "28 Dec 2025 - 3 Jan 2026" or "5 Oct 2026".
    static func parseDates(_ text: String) -> (start: String, end: String)? {
        let parts = text.components(separatedBy: " - ").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let last = parts.last else { return nil }
        let right = last.split(separator: " ").map(String.init)
        guard right.count == 3, let rd = Int(right[0]), let rm = month(right[1]), let ry = Int(right[2])
        else { return nil }

        var (ld, lm, ly) = (rd, rm, ry)
        if parts.count == 2 {
            let left = parts[0].split(separator: " ").map(String.init)
            guard let d = left.first.flatMap({ Int($0) }) else { return nil }
            ld = d
            if left.count >= 2, let m = month(left[1]) { lm = m }
            if left.count >= 3, let y = Int(left[2]) { ly = y } else if lm > rm { ly = ry - 1 }
        }
        return (DayKey.make(ly, lm, ld), DayKey.make(ry, rm, rd))
    }

    private static func month(_ s: String) -> Int? {
        let names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        return names.firstIndex(of: String(s.lowercased().prefix(3))).map { $0 + 1 }
    }
}

/// Reads the "Match Listing" table out of the competition page's HTML.
enum MatchListingParser {
    static func parse(_ html: String, competitionID: Int) -> [Match] {
        let competition = HTML.firstMatch(#"<h1>\s*(.*?)\s*</h1>"#, in: html).map(HTML.clean) ?? "FIH"
        guard let body = HTML.tableBody(html) else { return [] }
        return body.components(separatedBy: "<tr>").dropFirst().compactMap { row in
            parseRow(row, competition: competition, competitionID: competitionID)
        }
    }

    private static func parseRow(_ row: String, competition: String, competitionID: Int) -> Match? {
        guard
            let localTime = HTML.firstMatch(#"data-datetimelocal__notimechange="([^"]+)""#, in: row),
            let zoneID = HTML.firstMatch(#"data-timezone="([^"]+)""#, in: row),
            let link = HTML.groups(#"/matches/(\d+)">([^<]+)</a>"#, in: row),
            let id = Int(link[0]),
            let cells = HTML.groups(#"white-space:nowrap;">([^<]*)</td>\s*<td>(.*?)</td>\s*<td>([^<]*)</td>"#, in: row)
        else { return nil }

        let zone = TimeZone(identifier: zoneID) ?? .current
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = zone
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let start = f.date(from: localTime) else { return nil }

        // "JPN v PAK (RR)" → JPN, PAK, RR
        var details = HTML.clean(link[1])
        var stage: String?
        if let open = details.lastIndex(of: "("), details.hasSuffix(")") {
            stage = String(details[details.index(after: open)..<details.index(before: details.endIndex)])
            details = String(details[..<open]).trimmingCharacters(in: .whitespaces)
        }
        let teams = details.components(separatedBy: " v ")
        guard teams.count == 2 else { return nil }

        // "8 - 3", "2 - 2 (3 - 2)" or "-"
        let scoreline = HTML.clean(cells[0])
        let numbers = HTML.groups(#"^(\d+)\s*-\s*(\d+)(.*)$"#, in: scoreline)
        let note = numbers.map { HTML.clean($0[2]) }.flatMap { $0.isEmpty ? nil : $0 }
        let venueText = HTML.clean(cells[2])

        return Match(
            id: id,
            number: HTML.firstMatch(#"<td class="text-center">\s*(\d+)\s*</td>"#, in: row) ?? "",
            start: start,
            timeZone: zone,
            homeCode: teams[0].trimmingCharacters(in: .whitespaces),
            awayCode: teams[1].trimmingCharacters(in: .whitespaces),
            stage: stage,
            homeScore: numbers.flatMap { Int($0[0]) },
            awayScore: numbers.flatMap { Int($0[1]) },
            scoreNote: note,
            status: HTML.clean(cells[1]),
            venue: venueText.isEmpty ? nil : venueText,
            competition: competition,
            competitionID: competitionID
        )
    }
}

/// Small helpers for pulling values out of the site's HTML.
enum HTML {
    /// The contents of the first <tbody> on the page.
    static func tableBody(_ html: String) -> String? {
        guard let start = html.range(of: "<tbody>"),
              let end = html.range(of: "</tbody>", range: start.upperBound..<html.endIndex)
        else { return nil }
        return String(html[start.upperBound..<end.lowerBound])
    }

    static func groups(_ pattern: String, in text: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }
        return (1..<m.numberOfRanges).map { i in
            Range(m.range(at: i), in: text).map { String(text[$0]) } ?? ""
        }
    }

    static func firstMatch(_ pattern: String, in text: String) -> String? {
        groups(pattern, in: text)?.first
    }

    /// Strips tags, decodes the few entities the site uses, and tidies whitespace.
    static func clean(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, char) in ["&amp;": "&", "&nbsp;": " ", "&#039;": "'", "&quot;": "\""] {
            t = t.replacingOccurrences(of: entity, with: char)
        }
        return t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
