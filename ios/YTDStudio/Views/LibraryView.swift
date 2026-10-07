import SwiftUI
import UIKit

struct LibraryView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var player: PlayerModel

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case video = "Videos"
        case audio = "Audio"
        case favorites = "Favorites"

        var id: String { rawValue }
    }

    enum Sort: String, CaseIterable, Identifiable {
        case newest = "Newest"
        case oldest = "Oldest"
        case title = "Title"
        case channel = "Channel"
        case largest = "Largest"

        var id: String { rawValue }
    }

    @State private var filter: Filter = .all
    @AppStorage("librarySort") private var sort: Sort = .newest
    @State private var search = ""
    @State private var pendingDelete: LibraryItem?
    @State private var toast: String?

    private var visible: [LibraryItem] {
        var items = library.items
        switch filter {
        case .all: break
        case .video: items = items.filter { $0.kind == .video }
        case .audio: items = items.filter { $0.kind == .audio }
        case .favorites: items = items.filter(\.favorite)
        }
        let query = search.trimmingCharacters(in: .whitespaces)
        if !query.isEmpty {
            items = items.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.author.localizedCaseInsensitiveContains(query) }
        }
        switch sort {
        case .newest: items.sort { $0.addedAt > $1.addedAt }
        case .oldest: items.sort { $0.addedAt < $1.addedAt }
        case .title: items.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .channel: items.sort { $0.author.localizedCaseInsensitiveCompare($1.author) == .orderedAscending }
        case .largest: items.sort { $0.sizeBytes > $1.sizeBytes }
        }
        return items
    }

    var body: some View {
        NavigationStack {
            List {
                Picker("Show", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))

                if visible.isEmpty {
                    emptyRow
                } else {
                    ForEach(visible) { item in
                        row(item)
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Search titles and channels")
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Picker("Sort", selection: $sort) {
                            ForEach(Sort.allCases) { Text($0.rawValue).tag($0) }
                        }
                    } label: {
                        Image(systemName: "arrow.up.arrow.down.circle")
                    }
                }
            }
            .refreshable { library.prune() }
            .confirmationDialog("Delete this download?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { item in
                Button("Delete", role: .destructive) {
                    library.remove([item.id])
                }
            } message: { item in
                Text(item.title)
            }
            .toast($toast)
        }
    }

    private var emptyRow: some View {
        VStack(spacing: 10) {
            Image(systemName: "play.square.stack")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text(library.items.isEmpty ? "Nothing saved yet" : "Nothing matches")
                .font(.headline)
            Text(library.items.isEmpty ? "Videos and audio you download show up here, and in the Files app." : "Try another filter or search.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .listRowSeparator(.hidden)
    }

    private func row(_ item: LibraryItem) -> some View {
        Button {
            player.playLibraryItem(item)
        } label: {
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    Thumbnail(videoID: item.videoID, kind: item.kind)
                    DurationBadge(seconds: item.duration)
                }
                .frame(width: 120)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(alignment: .bottom) {
                    if item.isInProgress, let duration = item.duration, duration > 0 {
                        GeometryReader { geo in
                            Rectangle()
                                .fill(Brand.crimson)
                                .frame(width: geo.size.width * min(1, item.position / duration), height: 3)
                                .frame(maxHeight: .infinity, alignment: .bottom)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(item.watched ? .secondary : .primary)
                        .lineLimit(2)
                    if !item.author.isEmpty {
                        Text(item.author).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    HStack(spacing: 6) {
                        Image(systemName: item.kind == .audio ? "music.note" : "film")
                        Text(item.quality)
                        Text("·")
                        Text(Format.bytes(item.sizeBytes))
                        if item.favorite {
                            Image(systemName: "heart.fill").foregroundStyle(Brand.crimson)
                        }
                        if item.watched {
                            Image(systemName: "checkmark.circle.fill")
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                pendingDelete = item
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            Button {
                library.update(item.id) { $0.favorite.toggle() }
            } label: {
                Label(item.favorite ? "Unfavorite" : "Favorite", systemImage: item.favorite ? "heart.slash" : "heart")
            }
            .tint(Brand.crimson)
        }
        .contextMenu {
            Button {
                library.update(item.id) { $0.favorite.toggle() }
            } label: {
                Label(item.favorite ? "Remove from favorites" : "Add to favorites", systemImage: item.favorite ? "heart.slash" : "heart")
            }
            Button {
                library.update(item.id) {
                    $0.watched.toggle()
                    $0.position = 0
                }
            } label: {
                Label(item.watched ? "Mark as unwatched" : "Mark as watched", systemImage: item.watched ? "eye.slash" : "eye")
            }
            ShareLink(item: library.fileURL(for: item)) {
                Label("Share file", systemImage: "square.and.arrow.up")
            }
            if item.kind == .video {
                Button {
                    saveToPhotos(item)
                } label: {
                    Label("Save to Photos", systemImage: "photo.on.rectangle")
                }
            }
            Button {
                UIPasteboard.general.url = YouTubeLink.watchURL(item.videoID)
                toast = "Link copied"
            } label: {
                Label("Copy YouTube link", systemImage: "link")
            }
            Divider()
            Button(role: .destructive) {
                pendingDelete = item
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private func saveToPhotos(_ item: LibraryItem) {
        let path = library.fileURL(for: item).path
        guard UIVideoAtPathIsCompatibleWithSavedPhotosAlbum(path) else {
            toast = "Photos can't import this file"
            return
        }
        UISaveVideoAtPathToSavedPhotosAlbum(path, nil, nil, nil)
        toast = "Saving to Photos…"
    }
}
