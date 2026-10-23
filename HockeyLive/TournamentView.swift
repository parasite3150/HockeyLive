import SwiftUI

@MainActor
final class TournamentModel: ObservableObject {
    let route: TournamentRoute
    @Published private(set) var matches: [Match]?
    @Published private(set) var matchesError: String?
    @Published private(set) var stats: TournamentStats?
    @Published private(set) var statsError: String?
    @Published private(set) var standings: [PoolStanding]?
    @Published private(set) var standingsError: String?

    init(route: TournamentRoute) { self.route = route }

    /// Matches grouped by day (phone's time zone), in date order.
    var days: [(key: String, matches: [Match])] {
        let byDay = Dictionary(grouping: matches ?? [], by: \.dayKey)
        return byDay.keys.sorted().map { ($0, byDay[$0]!.sorted { $0.start < $1.start }) }
    }

    var hasLiveMatch: Bool { (matches ?? []).contains { $0.state == .live } }

    func load() async {
        async let m: Void = loadMatches()
        async let s: Void = loadStats()
        async let t: Void = loadStandings()
        _ = await (m, s, t)
    }

    func loadMatches() async {
        do {
            matches = try await MatchService.matches(competitionID: route.id)
            matchesError = nil
        } catch is CancellationError {
        } catch {
            matchesError = error.localizedDescription
        }
    }

    private func loadStandings() async {
        do {
            standings = try await TournamentDataService.standings(competitionID: route.id)
            standingsError = nil
        } catch is CancellationError {
        } catch {
            standingsError = error.localizedDescription
        }
    }

    private func loadStats() async {
        do {
            stats = try await TournamentDataService.stats(competitionID: route.id)
            statsError = nil
        } catch is CancellationError {
        } catch {
            statsError = error.localizedDescription
        }
    }
}

@MainActor
struct TournamentView: View {
    let route: TournamentRoute
    @StateObject private var model: TournamentModel
    @State private var tab: TournamentTab = .matches

    enum TournamentTab: String, CaseIterable, Identifiable {
        case matches = "Matches", standings = "Standings", statistics = "Statistics"
        var id: String { rawValue }
    }

    init(route: TournamentRoute) {
        self.route = route
        _model = StateObject(wrappedValue: TournamentModel(route: route))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $tab) {
                ForEach(TournamentTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding()

            List { content }
                .listStyle(.insetGrouped)
                .refreshable { await model.load() }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(route.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { HomeButton() } }
        .task {
            await model.load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if model.hasLiveMatch { await model.loadMatches() }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .matches: matchesTab
        case .standings: standingsTab
        case .statistics: statisticsTab
        }
    }

    @ViewBuilder
    private var matchesTab: some View {
        if model.matches != nil {
            if model.days.isEmpty { placeholder("No matches published yet.") }
            ForEach(model.days, id: \.key) { day in
                Section {
                    ForEach(day.matches) { match in
                        NavigationLink(value: match) { MatchRow(match: match) }
                    }
                } header: {
                    HStack {
                        Text(DayKey.title(day.key))
                        if day.key == DayKey.today() { Text("· Today").foregroundColor(.accentColor) }
                    }
                    .font(.subheadline.bold())
                    .textCase(nil)
                }
            }
        } else if let error = model.matchesError {
            placeholder("Couldn't load matches: \(error)")
        } else {
            HStack(spacing: 10) { ProgressView(); Text("Loading…").foregroundStyle(.secondary) }
        }
    }

    // MARK: Standings

    @ViewBuilder
    private var standingsTab: some View {
        if let pools = model.standings {
            if pools.isEmpty { placeholder("No standings yet.") }
            ForEach(pools) { pool in
                Section {
                    StandingsHeader()
                    ForEach(pool.rows) { StandingsRow(row: $0) }
                } header: {
                    Text(pool.pool)
                } footer: {
                    Text(standingsFooter(pool))
                }
            }
        } else if let error = model.standingsError {
            placeholder("Couldn't load standings: \(error)")
        } else {
            HStack(spacing: 10) { ProgressView(); Text("Loading…").foregroundStyle(.secondary) }
        }
    }

    // MARK: Statistics

    @ViewBuilder
    private var statisticsTab: some View {
        if let stats = model.stats {
            Section {
                if stats.scorers.isEmpty {
                    placeholder("No goals yet.")
                } else {
                    StatHeader(columns: ["FG", "PC", "PS", "Goals"])
                    ForEach(stats.scorers) { row in
                        StatPlayerRow(code: row.teamCode, player: row.player, detail: "#\(row.shirt) · \(row.team)",
                                      values: [row.fieldGoals, row.penaltyCorners, row.penaltyStrokes, row.goals])
                    }
                    if let t = stats.scorersTotal {
                        StatTotalRow(values: [t.fieldGoals, t.penaltyCorners, t.penaltyStrokes, t.goals])
                    }
                }
            } header: {
                Text("Goal scorers")
            } footer: {
                Text(scorersFooter(stats))
            }

            Section {
                if stats.cards.isEmpty {
                    placeholder("No cards yet.")
                } else {
                    StatHeader(columns: ["R", "Y", "G"], cardColumns: true)
                    ForEach(stats.cards) { row in
                        StatPlayerRow(code: row.teamCode, player: row.player, detail: "#\(row.shirt) · \(row.team)",
                                      values: [row.red, row.yellow, row.green], emphasizeLast: false)
                    }
                    if let t = stats.cardsTotal {
                        StatTotalRow(values: [t.red, t.yellow, t.green])
                    }
                }
            } header: {
                Text("Cards")
            } footer: {
                if let note = stats.cardsNote { Text(note) }
            }
        } else if let error = model.statsError {
            placeholder("Couldn't load statistics: \(error)")
        } else {
            HStack(spacing: 10) { ProgressView(); Text("Loading…").foregroundStyle(.secondary) }
        }
    }

    private func standingsFooter(_ pool: PoolStanding) -> String {
        let key = "P played · W won · D drawn · L lost · GF/GA goals for/against · GD goal difference"
        return (pool.notes + [key]).joined(separator: "\n")
    }

    private func scorersFooter(_ stats: TournamentStats) -> String {
        let key = "FG field goal · PC penalty corner · PS penalty stroke"
        guard let note = stats.scorersNote else { return key }
        return note + "\n" + key
    }

    private func placeholder(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12)
    }
}

// MARK: - Statistics table pieces

private let statColumnWidth: CGFloat = 34

/// Column headings, right-aligned to sit over the numbers.
private struct StatHeader: View {
    let columns: [String]
    var cardColumns = false

    private func headerWidth(_ column: String) -> CGFloat {
        column == "Goals" ? 48 : statColumnWidth
    }

    var body: some View {
        HStack(spacing: 0) {
            Text("Player").frame(maxWidth: .infinity, alignment: .leading)
            ForEach(columns, id: \.self) { column in
                Group {
                    if cardColumns {
                        CardShape(kind: column)
                    } else {
                        Text(column)
                    }
                }
                .frame(width: headerWidth(column), alignment: .trailing)
            }
        }
        .font(.caption.bold())
        .foregroundStyle(.secondary)
    }
}

private struct StatPlayerRow: View {
    let code: String?
    let player: String
    let detail: String
    let values: [Int]
    var emphasizeLast = true

    private func isEmphasized(_ index: Int) -> Bool {
        emphasizeLast && index == values.count - 1
    }

    private func font(at index: Int) -> Font {
        isEmphasized(index) ? Font.body.monospacedDigit().bold() : Font.subheadline.monospacedDigit()
    }

    private func color(at index: Int) -> Color {
        (values[index] == 0 && !isEmphasized(index)) ? Color.secondary : Color.primary
    }

    private func width(at index: Int) -> CGFloat {
        (index == values.count - 1 && values.count == 4) ? 48 : statColumnWidth
    }

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                AsyncImage(url: code.flatMap(Countries.flagURL)) { $0.resizable().scaledToFit() } placeholder: {
                    Circle().fill(Color.secondary.opacity(0.2))
                }
                .frame(width: 20, height: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player).font(.subheadline).lineLimit(1)
                    Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ForEach(values.indices, id: \.self) { index in
                Text(String(values[index]))
                    .font(font(at: index))
                    .foregroundColor(color(at: index))
                    .frame(width: width(at: index), alignment: .trailing)
            }
        }
    }
}

private struct StatTotalRow: View {
    let values: [Int]

    private func width(at index: Int) -> CGFloat {
        (index == values.count - 1 && values.count == 4) ? 48 : statColumnWidth
    }

    var body: some View {
        HStack(spacing: 0) {
            Text("Total").font(.subheadline.bold()).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(values.indices, id: \.self) { index in
                Text(String(values[index]))
                    .font(.subheadline.monospacedDigit().bold())
                    .frame(width: width(at: index), alignment: .trailing)
            }
        }
    }
}

// MARK: - Standings table pieces

private let standingsColumns = ["P", "W", "D", "L", "GF", "GA", "GD", "Pts"]
private let standingsColumnWidth: CGFloat = 27

private struct StandingsHeader: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("#").frame(width: 20, alignment: .leading)
            Text("Team").frame(maxWidth: .infinity, alignment: .leading)
            ForEach(standingsColumns, id: \.self) {
                Text($0).frame(width: standingsColumnWidth, alignment: .trailing)
            }
        }
        .font(.caption2.bold())
        .foregroundStyle(.secondary)
    }
}

private struct StandingsRow: View {
    let row: StandingRow

    private var values: [Int] {
        [row.played, row.wins, row.draws, row.losses,
         row.goalsFor, row.goalsAgainst, row.goalDifference, row.points]
    }

    /// Goal difference gets a "+" when positive.
    private func text(at index: Int) -> String {
        let value = values[index]
        return (index == 6 && value > 0) ? "+" + String(value) : String(value)
    }

    private func font(at index: Int) -> Font {
        index == 7 ? Font.caption.monospacedDigit().bold() : Font.caption.monospacedDigit()
    }

    var body: some View {
        HStack(spacing: 0) {
            Text(row.rank).font(.caption.monospacedDigit().bold()).frame(width: 20, alignment: .leading)
            HStack(spacing: 6) {
                AsyncImage(url: row.teamCode.flatMap(Countries.flagURL)) { $0.resizable().scaledToFit() } placeholder: {
                    Circle().fill(Color.secondary.opacity(0.2))
                }
                .frame(width: 18, height: 18)
                Text(row.team).font(.subheadline).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            ForEach(values.indices, id: \.self) { index in
                Text(text(at: index))
                    .font(font(at: index))
                    .frame(width: standingsColumnWidth, alignment: .trailing)
            }
        }
    }
}
