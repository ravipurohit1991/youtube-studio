import Foundation

enum YouTubeLink {
    private static let patterns: [NSRegularExpression] = [
        #"(?:youtube\.com|youtube-nocookie\.com)/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/|v/)([A-Za-z0-9_-]{11})"#,
        #"youtu\.be/([A-Za-z0-9_-]{11})"#,
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }

    private static let bareID = try? NSRegularExpression(pattern: #"^[A-Za-z0-9_-]{11}$"#)

    /// The 11-character video ID in a pasted link (watch, youtu.be, Shorts, live, embed) or a bare ID.
    static func videoID(in text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        for pattern in patterns {
            if let match = pattern.firstMatch(in: trimmed, range: range),
               let idRange = Range(match.range(at: 1), in: trimmed) {
                return String(trimmed[idRange])
            }
        }
        if let bareID, bareID.firstMatch(in: trimmed, range: range) != nil {
            return trimmed
        }
        return nil
    }

    /// True for a playlist link without a video in it (not supported on iOS).
    static func isPlaylistOnly(_ text: String) -> Bool {
        text.contains("list=") && videoID(in: text) == nil
    }

    /// ytdstudio://open?url=<link> (from Shortcuts or the share sheet) or a plain YouTube link.
    static func link(fromOpenedURL url: URL) -> String? {
        if url.scheme?.lowercased() == "ytdstudio" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            if let value = components?.queryItems?.first(where: { $0.name == "url" || $0.name == "v" })?.value {
                return value
            }
            return nil
        }
        return url.absoluteString
    }

    static func watchURL(_ videoID: String) -> URL {
        URL(string: "https://www.youtube.com/watch?v=\(videoID)")!
    }
}
