import AppKit

/// The app that is actually running, not a guessed /Applications copy.
struct GuideApplication: Equatable {
    let url: URL

    init?(url: URL) {
        guard url.isFileURL, url.pathExtension == "app",
              (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return nil }
        self.url = url.standardizedFileURL
    }

    var name: String { url.deletingPathExtension().lastPathComponent }
    var itemProvider: NSItemProvider { NSItemProvider(object: url as NSURL) }
    @MainActor func reveal() { NSWorkspace.shared.activateFileViewerSelecting([url]) }
}
