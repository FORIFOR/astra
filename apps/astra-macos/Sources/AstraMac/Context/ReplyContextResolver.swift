import AppKit
import Foundation

/// 「これ返して」の候補を、決めた順で集める（REPLY_IN_CONTEXT）。cloud はこの順で解決し、曖昧なら選ばない。
///
///   1. mail       いま開いているメール（Mail.app の窓の題名 / ブラウザの Gmail タブの題名）
///   2. selection  選択中の文字
///   3. screenshot 直前のスクショ（添付として別に渡る）
///   4. frontmost  前面アプリの窓の題名
///
/// 端末が送るのは**題名や選択の一部**だけ。本文もメールボックスも送らない。
enum ReplyContextResolver {
    struct Candidate: Equatable {
        let kind: String
        let label: String
        let app: String?
        var json: [String: Any] { ["kind": kind, "label": label, "app": app ?? NSNull()] }
    }

    /// 返信の発話か。cloud 側の意図判定（email_reply）と同じ語。
    static func isReplyUtterance(_ text: String) -> Bool {
        let t = text.lowercased()
        let patterns = ["返して", "返事して", "返信して", "返信を書", "返事を書", "返信の下書き", "reply", "respond"]
        return patterns.contains { t.contains($0) }
    }

    /// 前面の状況から候補を作る。`snapshot` は検査用の差し込み。
    static func candidates(snapshot: AXContext? = AccessibilityContext.snapshot()) -> [Candidate] {
        guard let ax = snapshot else { return [] }
        var out: [Candidate] = []
        let title = ax.windowTitle?.trimmingCharacters(in: .whitespaces) ?? ""
        let isMailApp = ax.bundleId == "com.apple.mail" || ax.appName == "Mail"
        let isGmailTab = title.hasSuffix(" - Gmail") || title.contains(" - Gmail - ")
        if isMailApp, !title.isEmpty {
            out.append(Candidate(kind: "mail", label: String(title.prefix(300)), app: ax.appName))
        } else if isGmailTab {
            // 「件名 - アカウント - Gmail」。件名は最初の区切りまで（件名の中の " - " は失うが、推測で足すよりよい）。
            let subject = title.components(separatedBy: " - ").first ?? title
            out.append(Candidate(kind: "mail", label: String(subject.prefix(300)), app: ax.appName))
        }
        if let sel = ax.selectedText, !sel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            out.append(Candidate(kind: "selection", label: String(sel.prefix(300)), app: ax.appName))
        }
        if !isMailApp, !isGmailTab, !title.isEmpty {
            out.append(Candidate(kind: "frontmost", label: String(title.prefix(300)), app: ax.appName))
        }
        return out
    }

    static func json(_ candidates: [Candidate]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: candidates.map(\.json))) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}
