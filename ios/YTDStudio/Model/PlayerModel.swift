import AVFoundation
import AVKit
import Foundation
import MediaPlayer
import UIKit

/// One shared player for streams and saved files. Remembers where you stopped in saved items.
@MainActor
final class PlayerModel: ObservableObject {
    struct Session: Identifiable {
        let id = UUID()
        let title: String
        let subtitle: String
        /// Tried in order until one plays.
        let sources: [Source]
        let artwork: URL?
        let libraryItemID: UUID?
        let startAt: Double
    }

    enum Source {
        case remote(URL)
        case file(URL)
    }

    @Published var session: Session?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isLoading = false

    let player = AVPlayer()
    private weak var library: Library?
    private var sourceIndex = 0
    private var didSeek = false
    private var statusObservation: NSKeyValueObservation?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    init() {
        player.allowsExternalPlayback = true
    }

    func attach(_ library: Library) {
        self.library = library
    }

    func play(_ session: Session) {
        stop()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        self.session = session
        sourceIndex = 0
        errorMessage = nil
        load()
    }

    func playLibraryItem(_ item: LibraryItem) {
        guard let library else { return }
        play(Session(
            title: item.title,
            subtitle: item.author,
            sources: [.file(library.fileURL(for: item))],
            artwork: Library.thumbnailFile(for: item.videoID),
            libraryItemID: item.id,
            startAt: item.isInProgress ? item.position : 0
        ))
    }

    func close() {
        stop()
        session = nil
    }

    private func load() {
        guard let session else { return }
        guard sourceIndex < session.sources.count else {
            isLoading = false
            errorMessage = "This video could not be played. Try downloading it instead."
            return
        }
        isLoading = true
        didSeek = false
        let item: AVPlayerItem
        switch session.sources[sourceIndex] {
        case .remote(let url): item = YouTubeService.remoteItem(url)
        case .file(let url): item = AVPlayerItem(url: url)
        }
        item.externalMetadata = metadata(for: session)
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] observed, _ in
            let status = observed.status
            Task { @MainActor in self?.statusChanged(status) }
        }
        player.replaceCurrentItem(with: item)
        player.play()

        if timeObserver == nil {
            timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 5, preferredTimescale: 1), queue: .main) { [weak self] _ in
                Task { @MainActor in self?.savePosition() }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.finished() }
        }
    }

    private func statusChanged(_ status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            isLoading = false
            if !didSeek, let start = session?.startAt, start > 0 {
                didSeek = true
                player.seek(to: CMTime(seconds: start, preferredTimescale: 600))
            }
        case .failed:
            sourceIndex += 1
            load()
        default:
            break
        }
    }

    private func savePosition() {
        guard let id = session?.libraryItemID, let library else { return }
        let seconds = CMTimeGetSeconds(player.currentTime())
        guard seconds.isFinite, seconds > 0 else { return }
        library.update(id) { $0.position = seconds }
    }

    private func finished() {
        guard let id = session?.libraryItemID, let library else { return }
        library.update(id) {
            $0.position = 0
            $0.watched = true
        }
    }

    private func stop() {
        savePosition()
        player.pause()
        player.replaceCurrentItem(with: nil)
        statusObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        isLoading = false
    }

    /// Title, channel and artwork for the lock screen, Control Center and AirPlay.
    private func metadata(for session: Session) -> [AVMetadataItem] {
        var items: [AVMetadataItem] = [
            metadataItem(.commonIdentifierTitle, value: session.title as NSString),
            metadataItem(.commonIdentifierArtist, value: session.subtitle as NSString),
        ]
        if let artwork = session.artwork, artwork.isFileURL, let data = try? Data(contentsOf: artwork) {
            items.append(metadataItem(.commonIdentifierArtwork, value: data as NSData))
        }
        return items
    }

    private func metadataItem(_ identifier: AVMetadataIdentifier, value: NSCopying & NSObjectProtocol) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value
        item.extendedLanguageTag = "und"
        return item
    }
}
