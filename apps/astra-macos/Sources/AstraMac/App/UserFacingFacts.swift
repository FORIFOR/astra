import SwiftUI

/// 利用者に見せる語の正本。画面（SwiftUI / NSMenu）と説明書（`docs/guide/build.py`）が
/// **同じ定義**を読む。
///
/// 0.1.1 の説明書は「音声入力 … 長押し」のまま出た（アプリは出荷の数時間前に
/// 「録音を開始 / 停止」へ変わっていた）。UI が変わったのに説明書だけ古い、を
/// 人の注意で防ぐのはやめる。`--selftest facts` が `FACT\t<key>\t<value>\t<protected>` を
/// 書き出し、`scripts/verify-guide-facts.sh` が説明書側の `fact("key")` と突き合わせる。
///
/// 入れるのは**押せる語・見出し・許可名・鍵**だけ。文の途中の説明（prose）は入れない。
/// key は表示文字列と別に安定させる（`confirmation.cancel` は ja=やめる、あとで en=Cancel）。
/// `protected` の語は build.py に文字で書くと落ちる（必ず `fact()` で引く）。
///
/// 値は全て literal で、OS の言語・時刻・設定に依らない（`NSLocalizedString` は使っていない）。
enum UserFacingFacts {
    static let locale = "ja-JP"

    struct Fact { let key: String; let value: String; let protected: Bool }

    // MARK: 操作ラベル

    static let recordingStart = "録音を始める"
    static let recordingMenuStart = "会議を録音"
    static let recordingMenuStop = "録音を停止"
    /// Home の録音カード・会議バー横（図形 ■ の横の字）。
    static let recordingStop = "止める"
    /// Agent の面。録音と同じ字だが意味が別なので key は分ける。
    static let taskStop = "止める"
    static let recordingCannotStart = "録音を始められません"
    static let meetingNotes = "メモ"
    static let meetingNotesOpen = "ライブメモを開く"
    static let meetingNotesPanelTitle = "ライブメモ"
    static let meetingDetach = "会議の横に開く"
    static let notesSummary = "要約"
    static let notesDecisions = "決まったこと"
    static let notesActions = "やること"
    static let notesQuestions = "質問"
    static let notesConcerns = "懸念"
    static let sourceLabel = "出所"
    static let homeIntentPlaceholder = "何を終わらせますか？"
    static let listeningPlaceholder = "聞いています…"
    /// 録音は続いているが、この Mac ではオンデバイス STT の資産が無い。サーバへは落とさない（`SpeechTranscriber`）。
    static let transcriptionOnDeviceUnavailable = "この Mac ではオンデバイス文字起こしを使えません。音声は保存されています"
    static let taskOpenWorkspace = "作業画面で続ける"
    /// 確認の実行ボタンは依頼ごとに**結果の語**（「切断する」「3 件を捨てる」）が入る
    /// （`ActionConfirmation.confirmLabel`）。固定の語ではない。これは demo と説明書が
    /// 例として使う値で、golden 07-confirmation と説明書の「例: 送る」を同じにする。
    static let confirmationConfirmExample = "送る"
    static let confirmationCancel = "やめる"
    static let confirmationEdit = "直す"
    static let confirmationEditDone = "完了"
    static let resultOpen = "開く"
    static let resultCopy = "コピー"
    static let resultOpenSettings = "設定を開く"
    static let recoveryResume = "続きから"
    static let recoveryDiscard = "破棄"
    static let sessionInterrupted = "途中で終わっています"
    static let hudClickHint = "クリック"
    static let permissionRequest = "許可…"
    static let settingsPermissionsSection = "許可（OS）"
    static let settingsShortcutRow = "録音を開始 / 停止"

    // 録音の見出し（録音中 / 一時停止中）の正本は astra-core（Rust）の `hero_text`。
    // Swift へ移さず、`--selftest facts` が Rust の snapshot と一致することを確かめる。
    static let recordingHeroRecording = "録音中"
    static let recordingHeroPaused = "一時停止中"
    static let recordingHeroSilentSuffix = "（音声なし）"
    /// 面は出たが、まだ 1 サンプルも取り込めていない間の見出し。
    /// マイクは engine を start してから最初の IO バッファまで何も入らない（~105ms 実測）。
    /// そこを「録音中」と名乗ると、その間に話した頭が落ちる。**取り込みが生きてから**名乗る。
    static let recordingHeroPreparing = "準備中…"

    // MARK: メニュー

    static let menuOpen = "Astra を開く"
    static let menuSettings = "設定…"
    static let menuGuide = "操作ガイド（PDF）"
    static let menuQuit = "Astra を終了"
    static let menuCheckUpdates = "更新を確認…"
    /// 更新を確認できない実行体（appcast / 公開鍵の無い swift build 等）で出す面。偽の「最新です」は出さない。
    static let updateUnavailableTitle = "この Astra では更新を確認できません"
    static let updateOpenReleases = "配布ページを開く"
    static let updateClose = "閉じる"

    // MARK: ナビ・見出し

    static let navHome = "Home"
    static let navWork = "Work"
    static let navLibrary = "Library"
    static let navApps = "Apps"
    /// 4 面の中の 2 面ずつ（Tasks / Meetings / Agents / Plugins は上位から親の下へ移した）。
    static let workTasks = "Tasks"
    static let workAgents = "Agents"
    static let libraryMeetings = "Meetings"
    static let libraryFiles = "Files"
    static let appsPlugins = "Plugins"
    static let appsConnectors = "Connectors"
    /// `DockLabel` が大文字にして出す（画面では PLAN / CONTEXT / SUGGESTED）。
    static let dockPlan = "Plan"
    static let dockContext = "Context"
    static let dockSuggested = "Suggested"

    // MARK: 許可名（設定画面の 5 行。OS の設定と同じ語）

    static let permissionMicrophone = "マイク"
    static let permissionScreenRecording = "画面収録"
    static let permissionAccessibility = "アクセシビリティ"
    static let permissionCalendar = "カレンダー"
    static let permissionInputMonitoring = "入力監視"
    static let permissionCount = 5

    // MARK: 鍵の表示

    @MainActor static var shortcutRecordingToggle: String { GlobalShortcut.label() }
    static var shortcutConfirmationProceed: String { UserShortcut.confirm.display }
    static var shortcutEscape: String { UserShortcut.cancel.display }

    /// `--selftest facts` が書き出す全件。key の重複は selftest が落とす。
    @MainActor static var all: [Fact] {
        func f(_ k: String, _ v: String, _ p: Bool = true) -> Fact { Fact(key: k, value: v, protected: p) }
        return [
            f("recording.start", recordingStart),
            f("recording.menu.start", recordingMenuStart),
            f("recording.menu.stop", recordingMenuStop),
            f("recording.stop", recordingStop, false),
            f("task.stop", taskStop, false),
            f("recording.cannotStart", recordingCannotStart),
            f("meeting.notes", meetingNotes, false),
            f("meeting.notes.open", meetingNotesOpen),
            f("meeting.notes.panelTitle", meetingNotesPanelTitle),
            f("meeting.detach", meetingDetach),
            f("notes.summary", notesSummary, false),
            f("notes.decisions", notesDecisions),
            f("notes.actions", notesActions),
            f("notes.questions", notesQuestions, false),
            f("notes.concerns", notesConcerns, false),
            f("source.label", sourceLabel),
            f("home.intent.placeholder", homeIntentPlaceholder),
            f("listening.placeholder", listeningPlaceholder),
            f("transcription.onDeviceUnavailable", transcriptionOnDeviceUnavailable),
            f("task.openWorkspace", taskOpenWorkspace),
            f("confirmation.confirm.example", confirmationConfirmExample, false),
            f("confirmation.cancel", confirmationCancel),
            f("confirmation.edit", confirmationEdit),
            f("confirmation.editDone", confirmationEditDone, false),
            f("result.open", resultOpen, false),
            f("result.copy", resultCopy, false),
            f("result.openSettings", resultOpenSettings),
            f("recovery.resume", recoveryResume),
            f("recovery.discard", recoveryDiscard),
            f("session.interrupted", sessionInterrupted),
            f("hud.clickHint", hudClickHint, false),
            f("permission.request", permissionRequest),
            f("settings.permissionsSection", settingsPermissionsSection),
            f("settings.shortcutRow", settingsShortcutRow),
            f("recording.hero.recording", recordingHeroRecording, false),
            f("recording.hero.preparing", recordingHeroPreparing, false),
            f("recording.hero.paused", recordingHeroPaused, false),
            f("recording.hero.silentSuffix", recordingHeroSilentSuffix, false),
            f("menu.open", menuOpen),
            f("menu.settings", menuSettings),
            f("menu.guide", menuGuide),
            f("menu.quit", menuQuit),
            f("menu.checkUpdates", menuCheckUpdates),
            f("update.unavailable.title", updateUnavailableTitle, false),
            f("update.openReleases", updateOpenReleases, false),
            f("update.close", updateClose, false),
            f("nav.home", navHome, false),
            f("nav.work", navWork, false),
            f("nav.library", navLibrary, false),
            f("nav.apps", navApps, false),
            f("work.tasks", workTasks, false),
            f("work.agents", workAgents, false),
            f("library.meetings", libraryMeetings, false),
            f("library.files", libraryFiles, false),
            f("apps.plugins", appsPlugins, false),
            f("apps.connectors", appsConnectors, false),
            f("dock.plan", dockPlan, false),
            f("dock.context", dockContext, false),
            f("dock.suggested", dockSuggested, false),
            f("permission.microphone", permissionMicrophone),
            f("permission.screenRecording", permissionScreenRecording),
            f("permission.accessibility", permissionAccessibility),
            f("permission.calendar", permissionCalendar),
            f("permission.inputMonitoring", permissionInputMonitoring),
            f("shortcut.recording.toggle", shortcutRecordingToggle),
            f("shortcut.confirmation.proceed", shortcutConfirmationProceed),
            f("shortcut.escape", shortcutEscape),
        ]
    }
}

typealias Facts = UserFacingFacts

/// 鍵の正本。**実動作（`keyboardShortcut`）と badge の表示を別々に書かない。**
///
/// 以前は `.keyboardShortcut(.return, modifiers: .command)` と `KeyBadge("⌘↩")` が独立していて、
/// 鍵を変えても表示が変わらなかった。表示は key/modifiers から機械的に組む。
/// グローバルの ⌥Space は CGEventTap（`GlobalShortcut`）なので別型だが、表示は同じ規則。
struct UserShortcut {
    let key: KeyEquivalent
    let modifiers: EventModifiers

    /// 確認の実行。Return だけでは走らない（押し慣れた鍵で外へ出るのは危ない）。
    static let confirm = UserShortcut(key: .return, modifiers: .command)
    /// 逃げ道。どの面でも同じ鍵。
    static let cancel = UserShortcut(key: .escape, modifiers: [])

    /// 表示（badge・facts・説明書）。
    var display: String { Self.symbols(modifiers) + keyName }

    var keyName: String {
        switch key.character {
        case KeyEquivalent.return.character: return "↩"
        case KeyEquivalent.escape.character: return "esc"
        case KeyEquivalent.space.character: return "space"
        case KeyEquivalent.tab.character: return "⇥"
        case KeyEquivalent.delete.character: return "⌫"
        default: return String(key.character)
        }
    }

    static func symbols(_ m: EventModifiers) -> String {
        var s = ""
        if m.contains(.control) { s += "⌃" }
        if m.contains(.option) { s += "⌥" }
        if m.contains(.shift) { s += "⇧" }
        if m.contains(.command) { s += "⌘" }
        return s
    }

    /// グローバルの録音鍵（⌥Space）を HUD の badge 列に分ける: ["⌥", "space"]。
    /// 正本は `GlobalShortcut.label()`（Carbon の keycode から組む）。
    @MainActor static var globalRecordingBadges: [String] {
        let label = GlobalShortcut.label()
        var mods: [String] = []
        var rest = Substring(label)
        while let c = rest.first, "⌘⌥⌃⇧".contains(c) { mods.append(String(c)); rest = rest.dropFirst() }
        return mods + [rest.lowercased()]
    }
}
