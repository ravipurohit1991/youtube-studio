import AVKit
import SwiftUI

/// Full-screen player: the system controls with picture-in-picture, AirPlay and lock-screen controls.
struct PlayerScreen: View {
    @EnvironmentObject private var player: PlayerModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    player.close()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.title3.weight(.semibold))
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Close player")
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.session?.title ?? "")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let subtitle = player.session?.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    }
                }
                Spacer()
                if player.isLoading {
                    ProgressView().tint(.white)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            ZStack {
                SystemPlayer(player: player.player)
                if let message = player.errorMessage {
                    VStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle)
                        Text(message).multilineTextAlignment(.center)
                    }
                    .foregroundStyle(.white)
                    .padding()
                }
            }
        }
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

struct SystemPlayer: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.updatesNowPlayingInfoCenter = true
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.exitsFullScreenWhenPlaybackEnds = false
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}
