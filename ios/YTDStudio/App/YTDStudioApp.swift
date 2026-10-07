import AVFoundation
import SwiftUI

enum AppTab: Hashable {
    case home
    case downloads
    case library
    case settings
}

/// Tab selection and links handed to the app (ytdstudio:// from Shortcuts or the share sheet).
@MainActor
final class Router: ObservableObject {
    @Published var tab: AppTab = .home
    @Published var incomingLink: String?

    func open(_ url: URL) {
        guard let link = YouTubeLink.link(fromOpenedURL: url) else { return }
        tab = .home
        incomingLink = link
    }
}

@main
struct YTDStudioApp: App {
    @StateObject private var library: Library
    @StateObject private var downloads: DownloadManager
    @StateObject private var player: PlayerModel
    @StateObject private var router = Router()

    init() {
        let library = Library()
        let player = PlayerModel()
        player.attach(library)
        _library = StateObject(wrappedValue: library)
        _downloads = StateObject(wrappedValue: DownloadManager(library: library))
        _player = StateObject(wrappedValue: player)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(library)
                .environmentObject(downloads)
                .environmentObject(player)
                .environmentObject(router)
                .tint(Brand.accent)
                .onOpenURL { router.open($0) }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var router: Router
    @EnvironmentObject private var downloads: DownloadManager
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: PlayerModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $router.tab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(AppTab.home)
            DownloadsView()
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle.fill") }
                .badge(downloads.activeCount)
                .tag(AppTab.downloads)
            LibraryView()
                .tabItem { Label("Library", systemImage: "play.square.stack.fill") }
                .tag(AppTab.library)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(AppTab.settings)
        }
        .fullScreenCover(item: $player.session) { _ in
            PlayerScreen()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { library.prune() }
        }
    }
}
