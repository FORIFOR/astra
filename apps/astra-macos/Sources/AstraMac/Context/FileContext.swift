import Foundation
import AstraCore

/// ローカルファイルを RAG 候補にする（Finder access）。正本 §3「Finder access」/ §5「見たものだけ」。
///
/// **勝手に全ディスクを漁らない。**ユーザーが選んだフォルダ / 明示的に渡された URL だけを読む
/// （全ディスクアクセスは TCC ゲート）。テキストとして読めないもの（バイナリ）は候補にしない。
/// ランキングは core の `rank_context`。ここは候補を作るだけ。
enum FileContext {
    /// 1 ファイルから読む上限（先頭のみ。索引用の抜粋であって全文ではない）。
    static let snippetLimit = 2000

    /// テキストとして読めれば抜粋を返す。読めなければ nil（バイナリは候補にしない）。
    static func readableText(at url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else { return nil }
        guard let text = String(data: data.prefix(64 * 1024), encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return String(trimmed.prefix(snippetLimit))
    }

    /// 渡された URL 群を候補にする。読めないものは黙って落とす（**推測で埋めない**）。
    static func candidates(from urls: [URL], projectDir: URL? = nil, now: Date = Date()) -> [ContextCandidate] {
        urls.compactMap { url in
            guard let text = readableText(at: url) else { return nil }
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let modified = (attrs?[.modificationDate] as? Date) ?? now
            let age = max(0, now.timeIntervalSince(modified))
            let underProject = projectDir.map { url.path.hasPrefix($0.path) } ?? false
            return ContextCandidate(
                id: url.path,
                text: "\(url.lastPathComponent): \(text)",
                source: .library,
                ageSeconds: UInt64(age),
                projectMatch: underProject)
        }
    }

    /// フォルダ直下のファイルを候補にする（再帰しない。深追いは別途）。
    static func candidates(inDirectory dir: URL, projectDir: URL? = nil) -> [ContextCandidate] {
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])) ?? []
        let files = urls.filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true }
        return candidates(from: files, projectDir: projectDir ?? dir)
    }
}
