import Foundation
import SwiftUI
import UIKit

/// The download queue: two downloads at a time, live progress, cancel and retry. Finished files go to the Library.
@MainActor
final class DownloadManager: ObservableObject {
    @Published private(set) var jobs: [DownloadJob] = []

    private let library: Library
    private let maxConcurrent = 2
    private var tasks: [UUID: Task<Void, Never>] = [:]
    /// Resolved stream URLs for jobs added in this session. A retry (or a job from an earlier launch,
    /// whose links have expired) resolves the video again.
    private var options: [UUID: DownloadOption] = [:]
    /// Bytes received and expected for each part (video, audio) of a running download.
    private var partBytes: [UUID: [Int: (done: Int64, total: Int64)]] = [:]
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private static let jobsFile = Library.support.appendingPathComponent("jobs.json")

    init(library: Library) {
        self.library = library
        load()
    }

    var activeCount: Int { jobs.filter { $0.status.isActive }.count }

    func enqueue(_ info: VideoInfo, option: DownloadOption) {
        let job = DownloadJob(
            id: UUID(),
            videoID: info.id,
            title: info.title,
            author: info.author,
            thumbnailURL: info.thumbnailURL,
            kind: option.kind,
            quality: option.label,
            status: .queued,
            progress: 0,
            bytesDone: 0,
            bytesTotal: option.estimatedBytes ?? 0,
            error: nil,
            libraryItemID: nil,
            createdAt: Date()
        )
        options[job.id] = option
        jobs.insert(job, at: 0)
        save()
        pump()
    }

    func cancel(_ id: UUID) {
        if let task = tasks[id] {
            task.cancel()
        } else {
            mutate(id) { $0.status = .canceled }
            save()
        }
    }

    func retry(_ id: UUID) {
        guard let job = jobs.first(where: { $0.id == id }), !job.status.isActive else { return }
        options[id] = nil
        mutate(id) {
            $0.status = .queued
            $0.error = nil
            $0.progress = 0
            $0.bytesDone = 0
        }
        save()
        pump()
    }

    func remove(_ id: UUID) {
        tasks[id]?.cancel()
        jobs.removeAll { $0.id == id }
        options[id] = nil
        save()
    }

    func clearFinished() {
        jobs.removeAll { !$0.status.isActive }
        save()
    }

    func retryFailed() {
        for job in jobs where job.status == .failed { retry(job.id) }
    }

    // MARK: - Running

    private func pump() {
        while tasks.count < maxConcurrent,
              let next = jobs.last(where: { $0.status == .queued && tasks[$0.id] == nil }) {
            let id = next.id
            tasks[id] = Task { [weak self] in
                await self?.run(id)
            }
        }
        updateBackgroundTask()
    }

    private func run(_ id: UUID) async {
        defer {
            tasks[id] = nil
            save()
            pump()
        }
        guard let job = jobs.first(where: { $0.id == id }) else { return }
        let work = FileManager.default.temporaryDirectory.appendingPathComponent(id.uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: work) }
        do {
            try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
            let option = try await resolveOption(for: job)
            mutate(id) {
                $0.status = .downloading
                $0.bytesTotal = option.estimatedBytes ?? $0.bytesTotal
            }

            // Byte counts per part; the sum drives the progress bar.
            var parts: [Int: (done: Int64, total: Int64)] = [:]
            for (index, url) in option.parts.enumerated() {
                parts[index] = (0, YouTubeService.queryValue("clen", in: url).flatMap(Int64.init) ?? 0)
            }
            partBytes[id] = parts
            defer { partBytes[id] = nil }
            var files: [URL] = []
            for (index, url) in option.parts.enumerated() {
                let file = work.appendingPathComponent("part\(index)")
                try await Fetcher.download(url, to: file) { received, total in
                    Task { @MainActor [weak self] in
                        self?.reportProgress(id, part: index, done: received, total: total)
                    }
                }
                files.append(file)
            }
            try Task.checkCancellation()

            let fileName = Library.reserveFileName(title: job.title, videoID: job.videoID, kind: job.kind, fileExtension: option.fileExtension)
            let destination = Library.documents.appendingPathComponent(fileName)
            if files.count == 2 {
                mutate(id) { $0.status = .merging }
                let merged = work.appendingPathComponent("merged." + option.fileExtension)
                try await Merger.merge(video: files[0], audio: files[1], to: merged)
                try FileManager.default.moveItem(at: merged, to: destination)
            } else {
                try FileManager.default.moveItem(at: files[0], to: destination)
            }
            try Task.checkCancellation()

            await saveThumbnail(videoID: job.videoID, url: job.thumbnailURL)
            let duration = await Merger.duration(of: destination)
            let size = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
            let item = LibraryItem(
                id: UUID(),
                videoID: job.videoID,
                title: job.title,
                author: job.author,
                kind: job.kind,
                quality: option.label,
                fileName: fileName,
                duration: duration,
                sizeBytes: size,
                addedAt: Date(),
                position: 0,
                watched: false,
                favorite: false
            )
            library.add(item)
            mutate(id) {
                $0.status = .completed
                $0.progress = 1
                $0.bytesDone = size
                $0.bytesTotal = size
                $0.libraryItemID = item.id
            }
        } catch {
            let canceled = error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled
            mutate(id) {
                $0.status = canceled ? .canceled : .failed
                $0.error = canceled ? nil : error.localizedDescription
            }
        }
        options[id] = nil
    }

    /// The stream URLs for a job: from this session, or a fresh look-up with the same quality.
    private func resolveOption(for job: DownloadJob) async throws -> DownloadOption {
        if let option = options[job.id] { return option }
        mutate(job.id) { $0.status = .resolving }
        let info = try await YouTubeService.resolve(videoID: job.videoID)
        mutate(job.id) {
            $0.title = info.title
            if !info.author.isEmpty { $0.author = info.author }
        }
        let sameKind = info.options.filter { $0.kind == job.kind }
        guard let option = sameKind.first(where: { $0.label == job.quality }) ?? sameKind.first else {
            throw ServiceError.nothingToSave
        }
        return option
    }

    private func saveThumbnail(videoID: String, url: URL?) async {
        let target = Library.thumbnailFile(for: videoID)
        if FileManager.default.fileExists(atPath: target.path) { return }
        guard let url, let result = try? await URLSession.shared.data(from: url), UIImage(data: result.0) != nil else { return }
        try? result.0.write(to: target, options: .atomic)
    }

    private func reportProgress(_ id: UUID, part: Int, done received: Int64, total expected: Int64) {
        guard var parts = partBytes[id] else { return }
        parts[part] = (received, expected)
        partBytes[id] = parts
        let done = parts.values.reduce(0) { $0 + $1.done }
        let total = parts.values.reduce(0) { $0 + $1.total }
        mutate(id) {
            guard $0.status == .downloading else { return }
            $0.bytesDone = done
            if total > 0 { $0.bytesTotal = total }
            $0.progress = $0.bytesTotal > 0 ? min(1, Double(done) / Double($0.bytesTotal)) : 0
        }
    }

    private func mutate(_ id: UUID, _ change: (inout DownloadJob) -> Void) {
        guard let index = jobs.firstIndex(where: { $0.id == id }) else { return }
        change(&jobs[index])
    }

    /// Keeps downloads going for a while after the app is sent to the background.
    private func updateBackgroundTask() {
        let busy = !tasks.isEmpty
        if busy && backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "downloads") { [weak self] in
                Task { @MainActor in self?.endBackgroundTask() }
            }
        } else if !busy {
            endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - Storage

    private func load() {
        guard let data = try? Data(contentsOf: Self.jobsFile),
              var saved = try? JSONDecoder().decode([DownloadJob].self, from: data) else { return }
        // Downloads cut off by the app closing cannot continue: their links have expired.
        for index in saved.indices where saved[index].status.isActive {
            saved[index].status = .failed
            saved[index].error = "Interrupted when the app closed. Tap Retry."
        }
        jobs = saved
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(jobs) else { return }
        try? data.write(to: Self.jobsFile, options: .atomic)
    }
}
