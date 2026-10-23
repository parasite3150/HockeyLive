import Foundation

/// Loads tournaments from the site's full list a page at a time, and each tournament's
/// matches only when a day it covers is being looked at.
@MainActor
final class MatchesViewModel: ObservableObject {
    @Published private(set) var days: [String] = [DayKey.today()]
    @Published var selectedDayID: String = DayKey.today()
    @Published private(set) var isLoadingOlder = false
    @Published private(set) var catalogError: String?
    @Published private(set) var lastUpdated: Date?

    @Published private(set) var tournaments: [Int: Tournament] = [:]
    @Published private(set) var matchCache: [Int: [Match]] = [:]
    @Published private(set) var loadingIDs: Set<Int> = []
    @Published private(set) var failedIDs: Set<Int> = []

    private var nextPage = 1
    private var hasMorePages = true
    private var isLoadingCatalog = false
    /// Days shown even without tournaments: today, and any date jumped to.
    private var pinnedDays: Set<String> = [DayKey.today()]

    // MARK: - What the screen shows

    var selectedIndex: Int? { days.firstIndex(of: selectedDayID) }

    func title(for key: String) -> String { DayKey.title(key) }

    /// "Today", "Yesterday" or "Tomorrow", if the day is one of those.
    func relativeLabel(for key: String) -> String? {
        let today = DayKey.today()
        switch key {
        case today: return "Today"
        case DayKey.add(-1, to: today): return "Yesterday"
        case DayKey.add(1, to: today): return "Tomorrow"
        default: return nil
        }
    }

    /// The day's matches, grouped by tournament (tournament with the earliest match first).
    func sections(for key: String) -> [TournamentSection] {
        let dayMatches = matchCache.values.joined()
            .filter { $0.dayKey == key }
            .sorted { $0.start < $1.start }
        var order: [String] = []
        var byTournament: [String: [Match]] = [:]
        for m in dayMatches {
            if byTournament[m.competition] == nil { order.append(m.competition) }
            byTournament[m.competition, default: []].append(m)
        }
        return order.map { TournamentSection(id: $0, matches: byTournament[$0] ?? []) }
    }

    /// True while a tournament playing that day is still being fetched.
    func isLoading(_ key: String) -> Bool {
        covering(key).contains { loadingIDs.contains($0.id) || (matchCache[$0.id] == nil && !failedIDs.contains($0.id)) }
    }

    func hasFailures(_ key: String) -> Bool {
        covering(key).contains { failedIDs.contains($0.id) }
    }

    var hasLiveToday: Bool {
        sections(for: DayKey.today()).contains { $0.matches.contains { $0.state == .live } }
    }

    // MARK: - Loading

    /// First load when the app opens.
    func start() async {
        if tournaments.isEmpty { await loadNextCatalogPage() }
        await dayChanged()
    }

    /// Called whenever the visible day changes: load what it (and its neighbours) need.
    func dayChanged() async {
        let key = selectedDayID
        // Close to the oldest loaded day: fetch the next (older) page of tournaments.
        if let i = selectedIndex, i <= 3, hasMorePages { await loadNextCatalogPage() }
        let neighbours = [key, DayKey.add(-1, to: key), DayKey.add(1, to: key)]
        let needed = Set(neighbours.flatMap { covering($0) }.map(\.id))
        await withTaskGroup(of: Void.self) { group in
            for id in needed where matchCache[id] == nil {
                group.addTask { await self.loadMatches(id) }
            }
        }
    }

    /// Pull-to-refresh: newest tournaments again, plus today's and this day's matches.
    func refresh() async {
        await loadCatalogPage(1)
        let ids = Set((covering(selectedDayID) + covering(DayKey.today())).map(\.id))
        await withTaskGroup(of: Void.self) { group in
            for id in ids { group.addTask { await self.loadMatches(id, force: true) } }
        }
        lastUpdated = Date()
    }

    /// Re-fetch only the tournaments playing today (used for live scores).
    func refreshLive() async {
        let ids = covering(DayKey.today()).map(\.id)
        await withTaskGroup(of: Void.self) { group in
            for id in ids { group.addTask { await self.loadMatches(id, force: true) } }
        }
        lastUpdated = Date()
    }

    /// Go to any date, loading older pages of tournaments until that date is covered.
    func jump(to date: Date) async {
        let key = DayKey.from(date)
        pinnedDays.insert(key)
        isLoadingOlder = true
        while hasMorePages, (tournaments.values.map(\.startKey).min() ?? "9999") > key {
            if isLoadingCatalog {
                try? await Task.sleep(nanoseconds: 200_000_000)
            } else {
                await loadNextCatalogPage()
                if catalogError != nil { break }
            }
        }
        isLoadingOlder = false
        rebuildDays()
        selectedDayID = key
        await dayChanged()
    }

    func goToToday() {
        selectedDayID = DayKey.today()
    }

    func move(by step: Int) {
        guard let i = selectedIndex, days.indices.contains(i + step) else { return }
        selectedDayID = days[i + step]
    }

    // MARK: - Private

    private func covering(_ key: String) -> [Tournament] {
        tournaments.values.filter { $0.covers(key) }.sorted { $0.startKey < $1.startKey }
    }

    private func loadNextCatalogPage() async {
        guard hasMorePages, !isLoadingCatalog else { return }
        await loadCatalogPage(nextPage)
    }

    private func loadCatalogPage(_ page: Int) async {
        isLoadingCatalog = true
        defer { isLoadingCatalog = false }
        do {
            let result = try await MatchService.catalogPage(page)
            for t in result.tournaments { tournaments[t.id] = t }
            if page == nextPage {
                nextPage += 1
                hasMorePages = result.hasMore
            }
            catalogError = nil
            lastUpdated = Date()
            rebuildDays()
        } catch is CancellationError {
        } catch {
            catalogError = error.localizedDescription
        }
    }

    private func loadMatches(_ id: Int, force: Bool = false) async {
        guard !loadingIDs.contains(id), force || matchCache[id] == nil else { return }
        loadingIDs.insert(id)
        defer { loadingIDs.remove(id) }
        do {
            matchCache[id] = try await MatchService.matches(competitionID: id)
            failedIDs.remove(id)
            rebuildDays()
        } catch is CancellationError {
        } catch {
            failedIDs.insert(id)
        }
    }

    /// Every day with a tournament on, any day a loaded match falls on, plus pinned days.
    private func rebuildDays() {
        var keys = pinnedDays
        for t in tournaments.values { keys.formUnion(t.dayKeys) }
        for list in matchCache.values { keys.formUnion(list.map(\.dayKey)) }
        let sorted = keys.sorted()
        if sorted != days { days = sorted }
    }
}
