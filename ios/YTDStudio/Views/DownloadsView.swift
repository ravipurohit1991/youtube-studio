import SwiftUI

struct DownloadsView: View {
    @EnvironmentObject private var downloads: DownloadManager
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: PlayerModel
    @EnvironmentObject private var router: Router

    var body: some View {
        NavigationStack {
            Group {
                if downloads.jobs.isEmpty {
                    empty
                } else {
                    List {
                        let active = downloads.jobs.filter { $0.status.isActive }
                        let finished = downloads.jobs.filter { !$0.status.isActive }
                        if !active.isEmpty {
                            Section("In progress") {
                                ForEach(active) { row($0) }
                            }
                        }
                        if !finished.isEmpty {
                            Section("Finished") {
                                ForEach(finished) { row($0) }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Downloads")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button {
                            downloads.retryFailed()
                        } label: {
                            Label("Retry failed", systemImage: "arrow.clockwise")
                        }
                        .disabled(!downloads.jobs.contains { $0.status == .failed })
                        Button(role: .destructive) {
                            downloads.clearFinished()
                        } label: {
                            Label("Clear finished", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .disabled(downloads.jobs.isEmpty)
                }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No downloads yet").font(.title3.weight(.semibold))
            Text("Paste a link on Home and pick Video or Audio.")
                .foregroundStyle(.secondary)
            Button("Go to Home") { router.tab = .home }
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func row(_ job: DownloadJob) -> some View {
        HStack(spacing: 12) {
            Thumbnail(videoID: job.videoID, remoteURL: job.thumbnailURL, kind: job.kind)
                .frame(width: 96)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(job.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 6) {
                    Image(systemName: job.kind == .audio ? "music.note" : "film")
                    Text(job.quality)
                    if job.bytesTotal > 0 {
                        Text("·")
                        Text(job.status == .downloading
                             ? Format.bytes(job.bytesDone) + " of " + Format.bytes(job.bytesTotal)
                             : Format.bytes(job.bytesTotal))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if job.status == .downloading {
                    ProgressView(value: job.progress)
                } else if job.status.isActive {
                    ProgressView(value: job.status == .merging ? 1 : 0)
                        .opacity(0.5)
                }
                Text(job.stageText)
                    .font(.caption)
                    .foregroundStyle(job.status == .failed ? Color.red : (job.status == .completed ? Brand.ok : Color.secondary))
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
            action(job)
        }
        .padding(.vertical, 4)
        .swipeActions {
            Button(role: .destructive) {
                downloads.remove(job.id)
            } label: {
                Label(job.status.isActive ? "Cancel" : "Remove", systemImage: job.status.isActive ? "xmark" : "trash")
            }
        }
    }

    @ViewBuilder
    private func action(_ job: DownloadJob) -> some View {
        switch job.status {
        case .queued, .resolving, .downloading, .merging:
            Button {
                downloads.cancel(job.id)
            } label: {
                Image(systemName: "xmark.circle.fill").font(.title2).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel")
        case .failed, .canceled:
            Button {
                downloads.retry(job.id)
            } label: {
                Image(systemName: "arrow.clockwise.circle.fill").font(.title2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Brand.crimson)
            .accessibilityLabel("Retry")
        case .completed:
            if let id = job.libraryItemID, let item = library.item(id) {
                Button {
                    player.playLibraryItem(item)
                } label: {
                    Image(systemName: "play.circle.fill").font(.title2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Brand.crimson)
                .accessibilityLabel("Play")
            }
        }
    }
}
