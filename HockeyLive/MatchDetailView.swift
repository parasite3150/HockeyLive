import SwiftUI

@MainActor
final class MatchDetailModel: ObservableObject {
    let matchID: Int
    @Published private(set) var detail: MatchDetail?
    @Published private(set) var stats: [StatTable]?
    @Published private(set) var detailError: String?
    @Published private(set) var statsError: String?

    init(matchID: Int) { self.matchID = matchID }

    func load() async {
        async let page: Void = loadDetail()
        async let numbers: Void = loadStats()
        _ = await (page, numbers)
    }

    private func loadDetail() async {
        do {
            detail = try await MatchDetailService.detail(matchID: matchID)
            detailError = nil
        } catch is CancellationError {
        } catch {
            detailError = error.localizedDescription
        }
    }

    private func loadStats() async {
        do {
            stats = try await MatchDetailService.stats(matchID: matchID)
            statsError = nil
        } catch is CancellationError {
        } catch {
            statsError = error.localizedDescription
        }
    }
}

@MainActor
struct MatchDetailView: View {
    let match: Match
    @StateObject private var model: MatchDetailModel
    @State private var tab: DetailTab = .lineups

    enum DetailTab: String, CaseIterable, Identifiable {
        case lineups = "Lineups", goals = "Goals", cards = "Cards", stats = "Stats", h2h = "H2H"
        var id: String { rawValue }
    }

    init(match: Match) {
        self.match = match
        _model = StateObject(wrappedValue: MatchDetailModel(matchID: match.id))
    }

    private var status: String { model.detail?.status ?? match.status }
    private var state: MatchState { Match.state(for: status) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Picker("Section", selection: $tab) {
                ForEach(DetailTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.bottom, 8)

            List { content }
                .listStyle(.insetGrouped)
                .refreshable { await model.load() }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(match.number.isEmpty ? "Match" : "Match \(match.number)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { HomeButton() } }
        .task {
            await model.load()
            // Keep a live match up to date while this screen is open.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if state == .live { await model.load() }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 6) {
            NavigationLink(value: match.tournamentRoute) {
                Text(tournamentLine)
                    .font(.caption.bold())
                    .lineLimit(1)
            }
            HStack(alignment: .center) {
                teamBadge(flag: match.homeFlag, name: match.homeName)
                VStack(spacing: 4) {
                    if state == .upcoming {
                        Text(match.localTimeText).font(.title2.bold())
                    } else {
                        Text(model.detail?.scoreline ?? scoreText)
                            .font(.largeTitle.bold().monospacedDigit())
                            .foregroundColor(state == .live ? .red : .primary)
                    }
                    Text(statusLine)
                        .font(.caption.bold())
                        .foregroundColor(state == .live ? .red : .secondary)
                    if let note = match.scoreNote {
                        Text(note).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .frame(minWidth: 100)
                teamBadge(flag: match.awayFlag, name: match.awayName)
            }
            Text(dateLine)
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding()
    }

    private var tournamentLine: String {
        guard let stage = match.stage else { return match.competition }
        return match.competition + " · " + stage
    }

    private var dateLine: String {
        let date = match.start.formatted(date: .abbreviated, time: .shortened)
        guard let venue = match.venue else { return date }
        return date + " · " + venue
    }

    private var statusLine: String {
        state == .live ? "LIVE · " + status : status
    }

    private var scoreText: String {
        guard let h = match.homeScore, let a = match.awayScore else { return "–" }
        return "\(h) - \(a)"
    }

    private func teamBadge(flag: URL?, name: String) -> some View {
        VStack(spacing: 6) {
            AsyncImage(url: flag) { $0.resizable().scaledToFit() } placeholder: {
                Circle().fill(Color.secondary.opacity(0.2))
            }
            .frame(width: 48, height: 48)
            Text(name).font(.subheadline.bold()).multilineTextAlignment(.center).lineLimit(2)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Tabs

    @ViewBuilder
    private var content: some View {
        if tab == .stats {
            statsTab
        } else if let detail = model.detail {
            switch tab {
            case .lineups: lineupsTab(detail.lineups)
            case .goals: goalsTab(detail.goals)
            case .cards: cardsTab(detail.cards)
            case .h2h: headToHeadTab(detail.headToHead)
            case .stats: EmptyView()
            }
        } else if let error = model.detailError {
            message("Couldn't load this match: \(error)")
        } else {
            loadingRow
        }
    }

    @ViewBuilder
    private func lineupsTab(_ lineups: [TeamLineup]) -> some View {
        if lineups.allSatisfy({ $0.players.isEmpty }) {
            message("Lineups haven't been published yet.")
        } else {
            ForEach(lineups) { team in
                TeamLineupSections(team: team)
            }
        }
    }

    @ViewBuilder
    private func goalsTab(_ goals: [GoalEvent]) -> some View {
        if goals.isEmpty {
            message(state == .upcoming ? "The match hasn't started yet." : "No goals.")
        } else {
            Section {
                ForEach(goals) { goal in
                    GoalRow(goal: goal)
                }
            }
        }
    }

    @ViewBuilder
    private func cardsTab(_ cards: [CardEvent]) -> some View {
        if cards.isEmpty {
            message(state == .upcoming ? "The match hasn't started yet." : "No cards.")
        } else {
            Section {
                ForEach(cards) { card in
                    CardRow(card: card)
                }
            } footer: {
                Text("Green = 2 min suspension, yellow = 5–10 min, red = sent off.")
            }
        }
    }

    @ViewBuilder
    private var statsTab: some View {
        if let tables = model.stats {
            if tables.isEmpty {
                message("No statistics for this match yet.")
            }
            ForEach(tables) { table in
                StatTableSection(table: table, homeCode: match.homeCode, awayCode: match.awayCode)
            }
        } else if let error = model.statsError {
            message("Couldn't load statistics: \(error)")
        } else {
            loadingRow
        }
    }

    @ViewBuilder
    private func headToHeadTab(_ groups: [HeadToHeadGroup]) -> some View {
        if groups.isEmpty {
            message("These teams haven't met before.")
        } else {
            ForEach(groups) { group in
                Section(header: Text(group.category)) {
                    ForEach(group.matches) { h2h in
                        HeadToHeadRow(h2h: h2h)
                    }
                }
            }
        }
    }

    // MARK: Helpers

    private var loadingRow: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text("Loading…").foregroundStyle(.secondary)
        }
    }

    private func message(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12)
    }
}

/// One team's lineup: starters, substitutes and staff, each as its own list section.
private struct TeamLineupSections: View {
    let team: TeamLineup

    var body: some View {
        Section(header: Text(team.team + " · Starting XI")) {
            ForEach(team.starters) { player in
                PlayerRow(player: player)
            }
        }
        if !team.substitutes.isEmpty {
            Section(header: Text(team.team + " · Substitutes")) {
                ForEach(team.substitutes) { player in
                    PlayerRow(player: player)
                }
            }
        }
        if !team.staff.isEmpty {
            Section(header: Text(team.team + " · Staff")) {
                ForEach(team.staff) { member in
                    StaffRow(member: member)
                }
            }
        }
    }
}

private struct StaffRow: View {
    let member: StaffMember

    var body: some View {
        HStack {
            Text(member.role.capitalized)
                .foregroundStyle(.secondary)
                .frame(width: 90, alignment: .leading)
            Text(member.name)
        }
    }
}

private struct PlayerRow: View {
    let player: Player

    var body: some View {
        HStack(spacing: 10) {
            Text(player.number)
                .font(.subheadline.monospacedDigit().bold())
                .frame(width: 28, alignment: .trailing)
            Text(player.name).font(.subheadline).lineLimit(1)
            if player.isGoalkeeper { Tag(text: "GK") }
            if player.isCaptain { Tag(text: "C") }
            Spacer()
            ForEach(player.events) { event in
                EventBadge(event: event)
            }
        }
    }
}

/// A goal (dot) or card (coloured card) with its minute.
private struct EventBadge: View {
    let event: PlayerEvent

    var body: some View {
        HStack(spacing: 3) {
            if event.isCard {
                CardShape(kind: event.kind)
            } else {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8))
                    .foregroundColor(.primary)
            }
            Text(event.minute + "'")
                .font(.caption.monospacedDigit())
        }
    }
}

private struct Tag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2.bold())
            .padding(.horizontal, 4).padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.secondary))
            .foregroundStyle(.secondary)
    }
}

/// A small coloured card: green, yellow or red.
struct CardShape: View {
    let kind: String
    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(color)
            .frame(width: 10, height: 14)
            .accessibilityLabel(label)
    }
    private var color: Color {
        switch kind.uppercased() {
        case "G": return .green
        case "Y": return .yellow
        default: return .red
        }
    }
    private var label: String {
        switch kind.uppercased() {
        case "G": return "Green card"
        case "Y": return "Yellow card"
        default: return "Red card"
        }
    }
}

// MARK: - Rows (kept small so the compiler type-checks them quickly)

private struct GoalRow: View {
    let goal: GoalEvent

    var body: some View {
        HStack(spacing: 12) {
            Text(goal.minute + "'")
                .font(.subheadline.monospacedDigit().bold())
                .frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text("#" + goal.shirt + " " + goal.player)
                    .font(.subheadline)
                Text(goal.team + " · " + goal.action)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(goal.score)
                .font(.subheadline.monospacedDigit().bold())
        }
    }
}

private struct CardRow: View {
    let card: CardEvent

    private var detail: String {
        card.umpire.isEmpty ? card.team : card.team + " · Umpire: " + card.umpire
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(card.minute + "'")
                .font(.subheadline.monospacedDigit().bold())
                .frame(width: 40, alignment: .leading)
            CardShape(kind: card.type)
            VStack(alignment: .leading, spacing: 2) {
                Text("#" + card.shirt + " " + card.player)
                    .font(.subheadline)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct StatTableSection: View {
    let table: StatTable
    let homeCode: String
    let awayCode: String

    var body: some View {
        Section(header: Text(table.title)) {
            HStack {
                Text(homeCode).bold().frame(width: 60, alignment: .leading)
                Spacer()
                Text(awayCode).bold().frame(width: 60, alignment: .trailing)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            ForEach(table.rows) { row in
                StatLine(row: row)
            }
        }
    }
}

private struct StatLine: View {
    let row: StatRow

    var body: some View {
        HStack {
            Text(row.home)
                .font(.body.monospacedDigit().bold())
                .frame(width: 60, alignment: .leading)
            Spacer()
            Text(row.label)
                .font(.subheadline)
                .multilineTextAlignment(.center)
            Spacer()
            Text(row.away)
                .font(.body.monospacedDigit().bold())
                .frame(width: 60, alignment: .trailing)
        }
    }
}

private struct HeadToHeadRow: View {
    let h2h: HeadToHeadMatch

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(h2h.teams).font(.subheadline.bold())
                Spacer()
                Text(h2h.scoreline).font(.subheadline.monospacedDigit().bold())
            }
            Text(h2h.competition + " · " + h2h.date)
                .font(.caption)
                .foregroundStyle(.secondary)
            if h2h.isThisMatch {
                Text("This match")
                    .font(.caption2.bold())
                    .foregroundColor(.accentColor)
            }
        }
        .padding(.vertical, 2)
    }
}
