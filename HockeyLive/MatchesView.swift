import SwiftUI

@MainActor
struct MatchesView: View {
    @StateObject private var model = MatchesViewModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingCalendar = false
    @State private var pickedDate = Date()
    @State private var path = NavigationPath()

    /// Polling interval while a match is live.
    private let liveRefresh: Duration = .seconds(30)

    var body: some View {
        NavigationStack(path: $path) {
            // Swipe left/right to change day.
            TabView(selection: $model.selectedDayID) {
                ForEach(model.days, id: \.self) { key in
                    DayPage(dayKey: key, model: model).tag(key)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .background(Color(.systemGroupedBackground))
            .navigationDestination(for: Match.self) { MatchDetailView(match: $0) }
            .navigationDestination(for: TournamentRoute.self) { TournamentView(route: $0) }
            .overlay {
                if model.isLoadingOlder {
                    ProgressView("Loading older tournaments…")
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { dayTitle }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { withAnimation { model.move(by: -1) } } label: {
                        Image(systemName: "chevron.left")
                    }
                    .disabled((model.selectedIndex ?? 0) == 0)
                    .accessibilityLabel("Previous day")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { withAnimation { model.move(by: 1) } } label: {
                        Image(systemName: "chevron.right")
                    }
                    .disabled((model.selectedIndex ?? 0) >= model.days.count - 1)
                    .accessibilityLabel("Next day")
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Today") { withAnimation { model.goToToday() } }
                        .disabled(model.selectedDayID == DayKey.today())
                    Spacer()
                    Button {
                        pickedDate = DayKey.date(model.selectedDayID) ?? Date()
                        showingCalendar = true
                    } label: {
                        Label("Choose date", systemImage: "calendar")
                    }
                }
            }
            .sheet(isPresented: $showingCalendar) { calendarSheet }
        }
        // Lets any screen jump straight back to the day list.
        .environment(\.goHome, { path = NavigationPath() })
        .onChange(of: model.selectedDayID) { _ in
            Task { await model.dayChanged() }
        }
        // Fresh data every time the app is opened or brought back to the foreground.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            if model.tournaments.isEmpty {
                await model.start()       // first launch
            } else {
                await model.refresh()     // back from the background
            }
            // Keep live scores current while the app stays open.
            while !Task.isCancelled {
                try? await Task.sleep(for: liveRefresh)
                if model.hasLiveToday { await model.refreshLive() }
            }
        }
    }

    private var dayTitle: some View {
        VStack(spacing: 0) {
            Text(model.title(for: model.selectedDayID)).font(.headline)
            if let label = model.relativeLabel(for: model.selectedDayID) {
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var calendarSheet: some View {
        NavigationStack {
            DatePicker("Date", selection: $pickedDate, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .padding()
                .navigationTitle("Go to date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showingCalendar = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Go") {
                            showingCalendar = false
                            let date = pickedDate
                            Task { await model.jump(to: date) }
                        }
                    }
                }
            Spacer()
        }
        .presentationDetents([.medium, .large])
    }
}

/// One day's matches, grouped under tournament headers.
struct DayPage: View {
    let dayKey: String
    @ObservedObject var model: MatchesViewModel

    var body: some View {
        let sections = model.sections(for: dayKey)
        let loading = model.isLoading(dayKey)

        List {
            ForEach(sections) { section in
                Section {
                    ForEach(section.matches) { match in
                        NavigationLink(value: match) { MatchRow(match: match) }
                    }
                } header: {
                    TournamentLink(name: section.id, route: section.route)
                }
            }

            if loading {
                Section {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading matches…").foregroundStyle(.secondary)
                    }
                }
            } else if sections.isEmpty {
                Section { emptyMessage }
            }

            if model.hasFailures(dayKey) {
                Section {
                    Label("Some tournaments couldn't be loaded. Pull down to try again.",
                          systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
            } footer: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Times are shown in your time zone. Swipe to change day.")
                    if let updated = model.lastUpdated {
                        Text("Updated \(updated, format: .dateTime.hour().minute().second())")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.refresh() }
    }

    private var emptyMessage: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text(dayKey == DayKey.today() ? "No matches today" : "No matches on this day")
                .font(.headline)
            if let error = model.catalogError, model.tournaments.isEmpty {
                Text("Couldn't load tournaments: \(error)")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Try Again") { Task { await model.refresh() } }
                    .buttonStyle(.borderedProminent)
            } else {
                Text("Swipe or use the arrows to see other days.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

struct MatchRow: View {
    let match: Match

    var body: some View {
        HStack(spacing: 12) {
            timeColumn.frame(width: 72)

            VStack(alignment: .leading, spacing: 6) {
                teamLine(flag: match.homeFlag, name: match.homeName, score: match.homeScore)
                teamLine(flag: match.awayFlag, name: match.awayName, score: match.awayScore)
                Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    /// e.g. "Match 9 · RR · Pitch 1" (the tournament name is in the section header)
    private var caption: String {
        [match.number.isEmpty ? nil : "Match \(match.number)", match.stage, match.venue]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    @ViewBuilder
    private var timeColumn: some View {
        VStack(spacing: 2) {
            Text(match.localTimeText)
                .font(.subheadline.monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            switch match.state {
            case .live:
                Text("LIVE")
                    .font(.caption2.bold())
                    .foregroundColor(.white)
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(Color.red))
            case .finished:
                Text("FT").font(.caption2.bold()).foregroundStyle(.secondary)
                if let note = match.scoreNote {
                    Text(note).font(.caption2).foregroundStyle(.secondary)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            case .upcoming:
                EmptyView()
            }
        }
    }

    private func teamLine(flag: URL?, name: String, score: Int?) -> some View {
        HStack(spacing: 8) {
            AsyncImage(url: flag) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Circle().fill(Color.secondary.opacity(0.2))
            }
            .frame(width: 20, height: 20)

            Text(name).lineLimit(1)
            Spacer()
            // Scores only for matches that have started; upcoming ones show none.
            if match.state != .upcoming, let score {
                Text("\(score)")
                    .font(.body.monospacedDigit().bold())
                    .foregroundColor(match.state == .live ? Color.red : Color.primary)
            }
        }
    }
}


/// A tournament name that opens the tournament's own screen.
struct TournamentLink: View {
    let name: String
    let route: TournamentRoute?

    var body: some View {
        if let route {
            NavigationLink(value: route) {
                HStack(spacing: 4) {
                    Text(name).font(.subheadline.bold())
                    Image(systemName: "chevron.right").font(.caption.bold())
                }
                .foregroundColor(.accentColor)
            }
            .textCase(nil)
        } else {
            Text(name).font(.subheadline.bold()).textCase(nil)
        }
    }
}

/// "Back to the day list" action, provided by MatchesView.
private struct GoHomeKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var goHome: () -> Void {
        get { self[GoHomeKey.self] }
        set { self[GoHomeKey.self] = newValue }
    }
}

/// Toolbar button that returns to the day list from anywhere.
struct HomeButton: View {
    @Environment(\.goHome) private var goHome
    var body: some View {
        Button(action: goHome) { Image(systemName: "house") }
            .accessibilityLabel("Home")
    }
}
