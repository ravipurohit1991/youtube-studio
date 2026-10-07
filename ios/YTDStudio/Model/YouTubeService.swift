import AVFoundation
import Foundation
import YouTubeKit

enum ServiceError: LocalizedError {
    case notAVideoLink
    case playlistNotSupported
    case nothingToSave
    case message(String)

    var errorDescription: String? {
        switch self {
        case .notAVideoLink: return "That doesn't look like a YouTube video link."
        case .playlistNotSupported: return "Playlists aren't supported on iPhone yet. Open a single video and share or copy its link."
        case .nothingToSave: return "YouTube didn't offer a format this device can save for this video."
        case .message(let text): return text
        }
    }
}

enum YouTubeService {
    static let remoteFallbackKey = "remoteFallback"

    /// Local extraction runs on the device. The optional fallback asks the YouTubeKit server when YouTube
    /// changes something, until the app gets an update.
    static var methods: [YouTube.ExtractionMethod] {
        let fallback = UserDefaults.standard.object(forKey: remoteFallbackKey) as? Bool ?? true
        return fallback ? [.local, .remote] : [.local]
    }

    static func resolve(videoID: String) async throws -> VideoInfo {
        let video = YouTube(videoID: videoID, methods: methods)
        let streams: [YouTubeKit.Stream]
        do {
            streams = try await video.streams
        } catch {
            throw friendly(error)
        }
        let metadata = try? await video.metadata
        let hls = (try? await video.livestreams)?.first?.url
        let oembed = await OEmbed.fetch(videoID: videoID)

        let duration = streams.lazy.compactMap { queryValue("dur", in: $0.url).flatMap(Double.init) }.first
        let options = buildOptions(streams: streams, duration: duration)

        var playback: [URL] = []
        if let hls { playback.append(hls) }
        let progressive = streams.filterVideoAndAudio().filter { $0.isNativelyPlayable }.highestResolutionStream()
        if let progressive { playback.append(progressive.url) }

        let title = metadata?.title.isEmpty == false ? metadata!.title : (oembed?.title ?? "YouTube video")
        return VideoInfo(
            id: videoID,
            title: title,
            author: oembed?.author ?? "",
            thumbnailURL: URL(string: "https://i.ytimg.com/vi/\(videoID)/hqdefault.jpg") ?? metadata?.thumbnail?.url,
            duration: duration,
            options: options,
            playbackURLs: playback,
            audioURL: bestAudio(streams)?.url
        )
    }

    // MARK: - Formats

    private static func isAVC(_ stream: YouTubeKit.Stream) -> Bool {
        if case .some(.avc1) = stream.videoCodec { return true }
        return false
    }

    private static func isAAC(_ stream: YouTubeKit.Stream) -> Bool {
        if case .some(.mp4a) = stream.audioCodec { return true }
        return false
    }

    private static func bitrate(_ stream: YouTubeKit.Stream) -> Int {
        stream.averageBitrate ?? stream.bitrate ?? 0
    }

    private static func bestAudio(_ streams: [YouTubeKit.Stream]) -> YouTubeKit.Stream? {
        streams.filterAudioOnly()
            .filter { isAAC($0) && $0.fileExtension == .m4a }
            .max { bitrate($0) < bitrate($1) }
    }

    /// Exact size from the stream URL (clen), else an estimate from the bitrate.
    private static func size(_ stream: YouTubeKit.Stream, duration: Double?) -> Int64? {
        if let clen = queryValue("clen", in: stream.url).flatMap(Int64.init) { return clen }
        if let duration, bitrate(stream) > 0 { return Int64(Double(bitrate(stream)) * duration / 8) }
        return nil
    }

    /// MP4 joining works without re-encoding for H.264 video and AAC audio, which YouTube serves up to 1080p.
    static func buildOptions(streams: [YouTubeKit.Stream], duration: Double?) -> [DownloadOption] {
        var options: [DownloadOption] = []
        let audio = bestAudio(streams)
        var byHeight: [Int: YouTubeKit.Stream] = [:]
        for stream in streams.filterVideoOnly() where isAVC(stream) && stream.fileExtension == .mp4 {
            guard let height = stream.videoResolution else { continue }
            if let existing = byHeight[height], bitrate(existing) >= bitrate(stream) { continue }
            byHeight[height] = stream
        }
        if let audio {
            for height in byHeight.keys.sorted(by: >) {
                let video = byHeight[height]!
                let bytes = [size(video, duration: duration), size(audio, duration: duration)].compactMap { $0 }.reduce(0, +)
                options.append(DownloadOption(
                    id: "v\(height)",
                    kind: .video,
                    label: "\(height)p",
                    detail: detail(codec: "H.264", bytes: bytes > 0 ? bytes : nil),
                    resolution: height,
                    parts: [video.url, audio.url],
                    estimatedBytes: bytes > 0 ? bytes : nil,
                    fileExtension: "mp4"
                ))
            }
        }
        for stream in streams.filterVideoAndAudio() where stream.isNativelyPlayable && stream.fileExtension == .mp4 {
            guard let height = stream.videoResolution, !options.contains(where: { $0.resolution == height }) else { continue }
            let bytes = size(stream, duration: duration)
            options.append(DownloadOption(
                id: "p\(height)",
                kind: .video,
                label: "\(height)p",
                detail: detail(codec: "single file", bytes: bytes),
                resolution: height,
                parts: [stream.url],
                estimatedBytes: bytes,
                fileExtension: "mp4"
            ))
        }
        options.sort { ($0.resolution ?? 0) > ($1.resolution ?? 0) }
        if let audio {
            let bytes = size(audio, duration: duration)
            let kbps = bitrate(audio) / 1000
            options.append(DownloadOption(
                id: "audio",
                kind: .audio,
                label: "Audio",
                detail: detail(codec: kbps > 0 ? "M4A · \(kbps) kbps" : "M4A", bytes: bytes),
                resolution: nil,
                parts: [audio.url],
                estimatedBytes: bytes,
                fileExtension: "m4a"
            ))
        }
        return options
    }

    private static func detail(codec: String, bytes: Int64?) -> String {
        guard let bytes else { return codec }
        return codec + " · " + Format.bytes(bytes)
    }

    static func queryValue(_ name: String, in url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }

    // MARK: - Playback

    /// Player item for a remote stream, sent with the user agent of the YouTube client that issued it.
    static func remoteItem(_ url: URL) -> AVPlayerItem {
        let headers = ["User-Agent": Fetcher.userAgent(for: url)]
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        return AVPlayerItem(asset: asset)
    }

    // MARK: - Errors

    static func friendly(_ error: Error) -> Error {
        if let ytError = error as? YouTubeKitError {
            switch ytError {
            case .videoPrivate: return ServiceError.message("This video is private.")
            case .videoAgeRestricted: return ServiceError.message("This video is age-restricted and needs a signed-in YouTube account, which the iPhone app doesn't support.")
            case .membersOnly: return ServiceError.message("This video is for channel members only.")
            case .videoRegionBlocked: return ServiceError.message("This video isn't available in your country.")
            case .liveStreamError: return ServiceError.message("Live streams can't be saved. Try again after the stream has ended.")
            case .videoUnavailable: return ServiceError.message("This video is unavailable.")
            default:
                return ServiceError.message("YouTube didn't return this video. Try again in a moment, or turn on the fallback server in Settings.")
            }
        }
        if let urlError = error as? URLError, urlError.code == .notConnectedToInternet {
            return ServiceError.message("You're offline. Connect to the internet and try again.")
        }
        return error
    }
}

/// Channel name and title from YouTube's oEmbed endpoint (the player response has no channel name).
enum OEmbed {
    struct Result: Decodable {
        let title: String?
        let author_name: String?

        var author: String? { author_name }
    }

    static func fetch(videoID: String) async -> Result? {
        var components = URLComponents(string: "https://www.youtube.com/oembed")!
        components.queryItems = [
            URLQueryItem(name: "url", value: YouTubeLink.watchURL(videoID).absoluteString),
            URLQueryItem(name: "format", value: "json"),
        ]
        guard let url = components.url else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(Result.self, from: data)
        } catch {
            return nil
        }
    }
}
