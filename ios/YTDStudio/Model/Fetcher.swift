import AVFoundation
import Foundation

/// Downloads a googlevideo stream in ranged chunks. YouTube throttles a single long request to roughly
/// playback speed; chunks of up to 10 MB are served at full speed (yt-dlp does the same).
enum Fetcher {
    static let chunkSize: Int64 = 8 * 1024 * 1024

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.httpMaximumConnectionsPerHost = 4
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    /// Stream URLs only work with the user agent of the YouTube client that asked for them (the c= parameter).
    static func userAgent(for url: URL) -> String {
        let client = (YouTubeService.queryValue("c", in: url) ?? "").uppercased()
        switch client {
        case "IOS":
            return "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
        case "IOS_MUSIC":
            return "com.google.ios.youtubemusic/5.21 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)"
        case "ANDROID", "ANDROID_EMBEDDED_PLAYER":
            return "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"
        case "ANDROID_MUSIC":
            return "com.google.android.apps.youtube.music/5.16.51 (Linux; U; Android 11) gzip"
        case "ANDROID_VR":
            return "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        case "TVHTML5":
            return "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)"
        default:
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
        }
    }

    /// Downloads url into file. progress(received, total) is called after every chunk.
    static func download(_ url: URL, to file: URL, progress: @escaping @Sendable (Int64, Int64) -> Void) async throws {
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }

        let expected = YouTubeService.queryValue("clen", in: url).flatMap(Int64.init)
        var total: Int64 = expected ?? 0
        var offset: Int64 = 0
        let agent = userAgent(for: url)

        while true {
            try Task.checkCancellation()
            let end = total > 0 ? min(offset + chunkSize, total) - 1 : offset + chunkSize - 1
            var request = URLRequest(url: url)
            request.setValue(agent, forHTTPHeaderField: "User-Agent")
            request.setValue("bytes=\(offset)-\(end)", forHTTPHeaderField: "Range")

            let (data, response) = try await fetchChunk(request)
            if data.isEmpty { break }
            try handle.write(contentsOf: data)
            offset += Int64(data.count)

            if response.statusCode == 200 {
                // The server ignored the range and sent the whole file.
                total = offset
                progress(offset, total)
                break
            }
            if let range = response.value(forHTTPHeaderField: "Content-Range"),
               let slash = range.lastIndex(of: "/"),
               let full = Int64(range[range.index(after: slash)...]) {
                total = full
            }
            progress(offset, max(total, offset))
            if total > 0 && offset >= total { break }
            if total == 0 && Int64(data.count) < chunkSize { break }
        }
        if offset == 0 { throw ServiceError.message("YouTube sent an empty file. Try again.") }
    }

    /// One ranged request, retried a few times on network hiccups.
    private static func fetchChunk(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var attempt = 0
        while true {
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                if http.statusCode == 403 {
                    throw ServiceError.message("YouTube refused the download (403). The link may have expired: tap Retry.")
                }
                if http.statusCode == 416 { return (Data(), http) }
                guard (200...299).contains(http.statusCode) else {
                    throw ServiceError.message("Download failed with HTTP \(http.statusCode).")
                }
                return (data, http)
            } catch let error as URLError where error.code != .cancelled && attempt < 3 {
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(attempt) * 1_000_000_000)
            }
        }
    }
}

/// Joins a video-only and an audio-only MP4 into one file without re-encoding.
enum Merger {
    static func merge(video: URL, audio: URL, to output: URL) async throws {
        let videoAsset = AVURLAsset(url: video)
        let audioAsset = AVURLAsset(url: audio)
        guard let videoTrack = try await videoAsset.loadTracks(withMediaType: .video).first,
              let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first else {
            throw ServiceError.message("The downloaded streams could not be read.")
        }
        let videoDuration = try await videoAsset.load(.duration)
        let audioDuration = try await audioAsset.load(.duration)
        let range = CMTimeRange(start: .zero, duration: CMTimeMinimum(videoDuration, audioDuration))

        let composition = AVMutableComposition()
        guard let compVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let compAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw ServiceError.message("Could not prepare the video file.")
        }
        try compVideo.insertTimeRange(range, of: videoTrack, at: .zero)
        compVideo.preferredTransform = try await videoTrack.load(.preferredTransform)
        try compAudio.insertTimeRange(range, of: audioTrack, at: .zero)

        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
            throw ServiceError.message("Could not join video and audio.")
        }
        try? FileManager.default.removeItem(at: output)
        export.outputURL = output
        export.outputFileType = export.supportedFileTypes.contains(.mp4) ? .mp4 : .mov
        export.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            export.exportAsynchronously {
                continuation.resume()
            }
        }
        if export.status != .completed {
            throw export.error ?? ServiceError.message("Could not join video and audio.")
        }
    }

    static func duration(of file: URL) async -> Double? {
        guard let time = try? await AVURLAsset(url: file).load(.duration) else { return nil }
        let seconds = CMTimeGetSeconds(time)
        return seconds.isFinite && seconds > 0 ? seconds : nil
    }
}
