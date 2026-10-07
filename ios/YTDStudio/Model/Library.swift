import Foundation
import SwiftUI

/// Saved videos and audio. Files live in Documents (visible in the Files app under YTD Studio);
/// the list, thumbnails and watch progress live in Application Support.
@MainActor
final class Library: ObservableObject {
    @Published private(set) var items: [LibraryItem] = []

    nonisolated static let documents: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    nonisolated static let support: URL = {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    nonisolated static let videosFolder = "Videos"
    nonisolated static let musicFolder = "Music"
    nonisolated static let thumbnailsDir: URL = {
        let url = support.appendingPathComponent("Thumbnails", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
    nonisolated private static let indexFile = support.appendingPathComponent("library.json")

    init() {
        load()
        prune()
    }

    // MARK: - Files

    func fileURL(for item: LibraryItem) -> URL {
        Self.documents.appendingPathComponent(item.fileName)
    }

    nonisolated static func thumbnailFile(for videoID: String) -> URL {
        thumbnailsDir.appendingPathComponent(videoID + ".jpg")
    }

    /// A free file name like "Videos/Title [id].mp4" relative to Documents.
    nonisolated static func reserveFileName(title: String, videoID: String, kind: MediaKind, fileExtension: String) -> String {
        let folder = kind == .audio ? musicFolder : videosFolder
        let dir = documents.appendingPathComponent(folder, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let base = sanitize(title) + " [" + videoID + "]"
        var name = base + "." + fileExtension
        var counter = 2
        while FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).path) {
            name = base + " (\(counter))." + fileExtension
            counter += 1
        }
        return folder + "/" + name
    }

    nonisolated private static func sanitize(_ title: String) -> String {
        let banned = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.newlines).union(.controlCharacters)
        let cleaned = title.components(separatedBy: banned).joined(separator: " ")
            .trimmingCharacters(in: .whitespaces.union(CharacterSet(charactersIn: ".")))
        let short = String(cleaned.prefix(120))
        return short.isEmpty ? "Video" : short
    }

    // MARK: - Changes

    func add(_ item: LibraryItem) {
        items.insert(item, at: 0)
        save()
    }

    func remove(_ ids: Set<UUID>) {
        let removed = items.filter { ids.contains($0.id) }
        for item in removed {
            try? FileManager.default.removeItem(at: fileURL(for: item))
            if !items.contains(where: { $0.videoID == item.videoID && !ids.contains($0.id) }) {
                try? FileManager.default.removeItem(at: Self.thumbnailFile(for: item.videoID))
            }
        }
        items.removeAll { ids.contains($0.id) }
        save()
    }

    func removeAll() {
        remove(Set(items.map(\.id)))
    }

    func update(_ id: UUID, save shouldSave: Bool = true, _ change: (inout LibraryItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
        if shouldSave { save() }
    }

    func item(_ id: UUID) -> LibraryItem? {
        items.first { $0.id == id }
    }

    /// Drops entries whose file was deleted in the Files app.
    func prune() {
        let before = items.count
        items.removeAll { !FileManager.default.fileExists(atPath: fileURL(for: $0).path) }
        if items.count != before { save() }
    }

    var totalBytes: Int64 { items.reduce(0) { $0 + $1.sizeBytes } }

    // MARK: - Storage

    private func load() {
        guard let data = try? Data(contentsOf: Self.indexFile) else { return }
        items = (try? JSONDecoder().decode([LibraryItem].self, from: data)) ?? []
    }

    func save() {
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: Self.indexFile, options: .atomic)
    }
}
