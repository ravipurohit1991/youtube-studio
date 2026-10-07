import SwiftUI
import UIKit

/// Brand colors, shared with the desktop and Android apps.
enum Brand {
    static let accent = Color("AccentColor")
    static let crimson = Color(red: 229.0 / 255, green: 50.0 / 255, blue: 75.0 / 255)
    static let violet = Color(red: 123.0 / 255, green: 92.0 / 255, blue: 1.0)
    static let ok = Color(red: 52.0 / 255, green: 193.0 / 255, blue: 126.0 / 255)
    static let gradient = LinearGradient(colors: [crimson, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
}

enum Format {
    static func bytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    static func duration(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds > 0 else { return "" }
        let total = Int(seconds.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// A saved thumbnail if there is one, otherwise the YouTube one.
struct Thumbnail: View {
    let videoID: String
    var remoteURL: URL?
    var kind: MediaKind = .video

    var body: some View {
        ZStack {
            Rectangle().fill(Color.secondary.opacity(0.15))
            if let image = UIImage(contentsOfFile: Library.thumbnailFile(for: videoID).path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let url = remoteURL ?? URL(string: "https://i.ytimg.com/vi/\(videoID)/mqdefault.jpg") {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        Image(systemName: kind == .audio ? "music.note" : "play.rectangle")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipped()
    }
}

struct DurationBadge: View {
    let seconds: Double?

    var body: some View {
        let text = Format.duration(seconds)
        if !text.isEmpty {
            Text(text)
                .font(.caption2.monospacedDigit().weight(.semibold))
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
                .foregroundStyle(.white)
                .padding(5)
        }
    }
}

/// A short message at the bottom of the screen that goes away by itself.
struct Toast: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await Task.sleep(nanoseconds: 2_200_000_000)
                        withAnimation { self.message = nil }
                    }
            }
        }
        .animation(.spring(response: 0.3), value: message)
    }
}

extension View {
    func toast(_ message: Binding<String?>) -> some View {
        modifier(Toast(message: message))
    }
}
