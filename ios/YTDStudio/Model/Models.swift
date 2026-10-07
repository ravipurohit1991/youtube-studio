import Foundation

enum MediaKind: String, Codable, Hashable {
    case video
    case audio
}

/// One way to save a video: a single file (audio, or video with sound built in), or a video-only and an
/// audio-only stream that are joined into one MP4 after downloading.
struct DownloadOption: Identifiable, Hashable {
    let id: String
    let kind: MediaKind
    /// "1080p" or "Audio"
    let label: String
    /// "H.264 · 245 MB"
    let detail: String
    let resolution: Int?
    let parts: [URL]
    let estimatedBytes: Int64?
    let fileExtension: String
}

/// A resolved YouTube video: what to show and every way to watch or save it.
struct VideoInfo: Identifiable, Hashable {
    let id: String
    let title: String
    let author: String
    let thumbnailURL: URL?
    let duration: Double?
    let options: [DownloadOption]
    /// Tried in order by the player: HLS (adaptive quality) first, then a single-file stream.
    let playbackURLs: [URL]
    let audioURL: URL?

    var videoOptions: [DownloadOption] { options.filter { $0.kind == .video } }
    var audioOption: DownloadOption? { options.first { $0.kind == .audio } }

    /// The best video option at or below the preferred height (0 = best available).
    func preferredVideo(maxHeight: Int) -> DownloadOption? {
        let videos = videoOptions
        if maxHeight <= 0 { return videos.first }
        return videos.first { ($0.resolution ?? 0) <= maxHeight } ?? videos.last
    }
}

enum JobStatus: String, Codable {
    case queued
    case resolving
    case downloading
    case merging
    case completed
    case failed
    case canceled

    var isActive: Bool { self == .queued || self == .resolving || self == .downloading || self == .merging }
}

struct DownloadJob: Identifiable, Codable, Hashable {
    let id: UUID
    let videoID: String
    var title: String
    var author: String
    var thumbnailURL: URL?
    let kind: MediaKind
    var quality: String
    var status: JobStatus
    var progress: Double
    var bytesDone: Int64
    var bytesTotal: Int64
    var error: String?
    var libraryItemID: UUID?
    let createdAt: Date

    var stageText: String {
        switch status {
        case .queued: return "Waiting"
        case .resolving: return "Getting the video…"
        case .downloading: return "Downloading"
        case .merging: return "Joining video and audio…"
        case .completed: return "Done"
        case .failed: return error ?? "Failed"
        case .canceled: return "Canceled"
        }
    }
}

struct LibraryItem: Identifiable, Codable, Hashable {
    let id: UUID
    let videoID: String
    var title: String
    var author: String
    let kind: MediaKind
    var quality: String
    /// Path relative to the app's Documents folder (what the Files app shows).
    var fileName: String
    var duration: Double?
    var sizeBytes: Int64
    let addedAt: Date
    var position: Double
    var watched: Bool
    var favorite: Bool

    var isInProgress: Bool {
        guard !watched, position > 10 else { return false }
        if let duration { return position < duration - 10 }
        return true
    }
}
