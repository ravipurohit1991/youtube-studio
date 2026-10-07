import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var library: Library
    @AppStorage("defaultQuality") private var defaultQuality = 1080
    @AppStorage(YouTubeService.remoteFallbackKey) private var remoteFallback = true
    @State private var confirmDeleteAll = false

    private let qualities = [0, 1080, 720, 480, 360]

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Video quality", selection: $defaultQuality) {
                        ForEach(qualities, id: \.self) { height in
                            Text(height == 0 ? "Best available" : "\(height)p").tag(height)
                        }
                    }
                } header: {
                    Text("Downloads")
                } footer: {
                    Text("Used by the Video button on Home. Every quality is still one tap away under All qualities. Videos are saved as MP4 (H.264, up to 1080p) and audio as M4A.")
                }

                Section {
                    Toggle("Fallback server", isOn: $remoteFallback)
                } header: {
                    Text("When YouTube changes something")
                } footer: {
                    Text("Videos are looked up on your iPhone. If that fails, the fallback asks the YouTubeKit server (youtubekit.dev) for the stream links, so the app keeps working until it gets an update. Only the video ID is sent.")
                }

                Section {
                    LabeledContent("Saved items", value: "\(library.items.count)")
                    LabeledContent("Space used", value: Format.bytes(library.totalBytes))
                    Button("Delete all downloads", role: .destructive) {
                        confirmDeleteAll = true
                    }
                    .disabled(library.items.isEmpty)
                } header: {
                    Text("Storage")
                } footer: {
                    Text("Your files are in the Files app: On My iPhone > YTD Studio. Files you delete there disappear from the Library too.")
                }

                Section("About") {
                    LabeledContent("Version", value: version)
                    Link(destination: URL(string: "https://github.com/ravipurohit1991/youtube-studio")!) {
                        Label("Source code and other apps", systemImage: "chevron.left.forwardslash.chevron.right")
                    }
                    Text("Stream extraction by YouTubeKit (MIT). Use YTD Studio only for videos you have the right to download, and respect YouTube's terms and the creators' rights.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Delete every saved video and audio file?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                Button("Delete all", role: .destructive) { library.removeAll() }
            }
        }
    }
}
