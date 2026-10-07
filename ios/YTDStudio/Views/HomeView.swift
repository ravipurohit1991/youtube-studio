import SwiftUI
import UIKit

struct HomeView: View {
    @EnvironmentObject private var downloads: DownloadManager
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: PlayerModel
    @EnvironmentObject private var router: Router
    @AppStorage("defaultQuality") private var defaultQuality = 1080

    enum Phase {
        case idle
        case loading
        case loaded(VideoInfo)
        case failed(String)
    }

    @State private var link = ""
    @State private var phase: Phase = .idle
    @State private var toast: String?
    @State private var showAllQualities = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    linkBar
                    content
                    continueWatching
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("YTD Studio")
            .toast($toast)
        }
        .onChange(of: router.incomingLink) { incoming in
            guard let incoming else { return }
            router.incomingLink = nil
            link = incoming
            resolve()
        }
    }

    private var header: some View {
        Text("Paste a YouTube link to watch it without ads or save it to your phone.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    private var linkBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "link").foregroundStyle(.secondary)
                TextField("youtube.com/watch?v=… or youtu.be/…", text: $link)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .focused($linkFocused)
                    .onSubmit(resolve)
                if !link.isEmpty {
                    Button {
                        link = ""
                        phase = .idle
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .padding(12)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

            HStack(spacing: 10) {
                PasteButton(payloadType: String.self) { strings in
                    guard let text = strings.first else { return }
                    Task { @MainActor in
                        link = text
                        resolve()
                    }
                }
                .labelStyle(.titleAndIcon)
                .buttonBorderShape(.capsule)
                .tint(Brand.crimson)

                Button(action: resolve) {
                    Label("Open", systemImage: "arrow.right.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            tips
        case .loading:
            HStack(spacing: 10) {
                ProgressView()
                Text("Getting the video…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 30)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        case .loaded(let info):
            videoCard(info)
        }
    }

    private var tips: some View {
        VStack(alignment: .leading, spacing: 12) {
            tip("play.tv", "Watch now", "Streams the video in the app: no ads, picture-in-picture, AirPlay.")
            tip("arrow.down.circle", "Save video or audio", "Up to 1080p MP4, or M4A audio that keeps playing with the screen off.")
            tip("folder", "Yours in the Files app", "Everything you save is in Files > On My iPhone > YTD Studio.")
            tip("square.and.arrow.up", "From the YouTube app", "Share > Copy link, then tap Paste here.")
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func tip(_ icon: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Brand.crimson)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func videoCard(_ info: VideoInfo) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .bottomTrailing) {
                Thumbnail(videoID: info.id, remoteURL: info.thumbnailURL)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                DurationBadge(seconds: info.duration)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(info.title).font(.headline).lineLimit(3)
                if !info.author.isEmpty {
                    Text(info.author).font(.subheadline).foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 10) {
                Button {
                    watch(info)
                } label: {
                    Label("Watch now", systemImage: "play.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(info.playbackURLs.isEmpty)

                Button {
                    listen(info)
                } label: {
                    Label("Listen", systemImage: "headphones").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(info.audioURL == nil)
            }
            .controlSize(.large)

            HStack(spacing: 10) {
                if let video = info.preferredVideo(maxHeight: defaultQuality) {
                    quickButton(info, video, icon: "film", title: "Video " + video.label)
                }
                if let audio = info.audioOption {
                    quickButton(info, audio, icon: "music.note", title: "Audio")
                }
            }

            DisclosureGroup("All qualities", isExpanded: $showAllQualities) {
                VStack(spacing: 0) {
                    ForEach(info.options) { option in
                        Button {
                            save(info, option)
                        } label: {
                            HStack {
                                Image(systemName: option.kind == .audio ? "music.note" : "film")
                                    .frame(width: 24)
                                Text(option.label).fontWeight(.semibold)
                                Spacer()
                                Text(option.detail).font(.footnote).foregroundStyle(.secondary)
                                Image(systemName: "arrow.down.circle")
                            }
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                .padding(.top, 6)
            }
            .tint(.primary)
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func quickButton(_ info: VideoInfo, _ option: DownloadOption, icon: String, title: String) -> some View {
        Button {
            save(info, option)
        } label: {
            VStack(spacing: 2) {
                Label(title, systemImage: icon).font(.subheadline.weight(.semibold))
                if let bytes = option.estimatedBytes {
                    Text(Format.bytes(bytes)).font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.bordered)
        .tint(Brand.crimson)
    }

    @ViewBuilder
    private var continueWatching: some View {
        let items = library.items.filter(\.isInProgress).prefix(10)
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Continue watching").font(.title3.weight(.bold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(Array(items)) { item in
                            Button {
                                player.playLibraryItem(item)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    ZStack(alignment: .bottom) {
                                        Thumbnail(videoID: item.videoID, kind: item.kind)
                                        if let duration = item.duration, duration > 0 {
                                            GeometryReader { geo in
                                                Rectangle()
                                                    .fill(Brand.crimson)
                                                    .frame(width: geo.size.width * min(1, item.position / duration), height: 3)
                                                    .frame(maxHeight: .infinity, alignment: .bottom)
                                            }
                                        }
                                    }
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    Text(item.title).font(.footnote.weight(.semibold)).lineLimit(2)
                                }
                                .frame(width: 200)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func resolve() {
        linkFocused = false
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let videoID = YouTubeLink.videoID(in: text) else {
            let error: ServiceError = YouTubeLink.isPlaylistOnly(text) ? .playlistNotSupported : .notAVideoLink
            phase = .failed(error.localizedDescription)
            return
        }
        phase = .loading
        showAllQualities = false
        Task {
            do {
                let info = try await YouTubeService.resolve(videoID: videoID)
                phase = .loaded(info)
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    private func watch(_ info: VideoInfo) {
        player.play(PlayerModel.Session(
            title: info.title,
            subtitle: info.author,
            sources: info.playbackURLs.map { .remote($0) },
            artwork: nil,
            libraryItemID: nil,
            startAt: 0
        ))
    }

    private func listen(_ info: VideoInfo) {
        guard let audio = info.audioURL else { return }
        player.play(PlayerModel.Session(
            title: info.title,
            subtitle: info.author,
            sources: [.remote(audio)] + info.playbackURLs.map { .remote($0) },
            artwork: nil,
            libraryItemID: nil,
            startAt: 0
        ))
    }

    private func save(_ info: VideoInfo, _ option: DownloadOption) {
        downloads.enqueue(info, option: option)
        toast = (option.kind == .audio ? "Audio" : option.label) + " added to Downloads"
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}
