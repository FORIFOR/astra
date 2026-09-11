import AppKit
import ApplicationServices

/// Guided Setup の状態機械。**状態を変えるのはここだけ。**
///
/// 1. アバターを出す  2. 「画面収録を使うため設定します」  3. System Settings を開く
/// 4. AX で対象を特定  5. ハイライト + 吹き出し  6. 利用者がオンにする
/// 7. OS API で再確認  8. 案内を消す  9. アバターを success  10. 「設定できました ✓」  11. 次へ / completed
///
/// 権限は変えない（案内するだけ）。見つからなければ推測位置に出さず一般ガイドだけ。
/// 追従は AXObserver の出来事で行い、権限の付与だけは OS が通知しないので低頻度で preflight を読む。
@MainActor
final class PermissionGuideCoordinator: ObservableObject {
    static let shared = PermissionGuideCoordinator()

    struct Dependencies {
        var permissions: PermissionProviding
        var tree: AXTreeProviding
        var makeObserver: () -> AXEventObserving
        var overlay: GuideOverlaying
        var openSettings: (GuidePermission) -> Void
        /// System Settings が走っているか（pid）。
        var settingsPID: () -> pid_t?
        /// success 表示を見せておく時間。検査では 0。
        var successDwell: TimeInterval = 0.9
        /// 権限の付与を OS が通知しないので、待っている間だけこの間隔で preflight を読む（UI の polling ではない）。
        var fallbackInterval: TimeInterval = 3.0
        /// System Settings が現れるのを待つ上限。
        var settingsLaunchTimeout: TimeInterval = 15
        /// 連続した AX の出来事をまとめる窓。検査では 0（`after` が即時）。
        var relocateCoalesceInterval: TimeInterval = 0.08
        /// System Settings の一覧に出る名前の候補（表示名 / バンドル名 / 実行体名）。文字列 1 個に依存しない。
        var appNames: [String] = Dependencies.bundleAppNames()
        var applicationToAdd = GuideApplication(url: Bundle.main.bundleURL)
        /// Hide only Astra's ordinary windows; restoring never resumes a task or records audio.
        var suspendWindows: () -> (() -> Void) = { {} }

        static func bundleAppNames() -> [String] {
            let info = Bundle.main.infoDictionary ?? [:]
            var names: [String] = []
            for key in ["CFBundleDisplayName", "CFBundleName"] { if let n = info[key] as? String { names.append(n) } }
            names.append(ProcessInfo.processInfo.processName)
            names.append("Astra")
            var seen = Set<String>()
            return names.filter { seen.insert($0).inserted }
        }
        /// 遅延実行。検査では即時。
        var after: (TimeInterval, @escaping () -> Void) -> Void = { s, block in
            DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: block)
        }
        var now: () -> Date = Date.init

        @MainActor static func live() -> Dependencies {
            Dependencies(
                permissions: PermissionManager.shared,
                tree: AXElementService.shared,
                makeObserver: { AXObserverService() },
                overlay: GuideOverlayStack(),
                openSettings: { PermissionManager.shared.openSettings(for: $0) },
                settingsPID: { AXElementService.shared.pid(ofBundle: SystemSettingsAnchorLocator.bundleID) },
                suspendWindows: {
                    let main = MainWindowController.shared.suspendForPermissionGuide()
                    let settings = SettingsWindowController.shared.suspendForPermissionGuide()
                    let practice = PermissionPractice.shared.suspendForPermissionGuide()
                    return { main(); settings(); practice() }
                })
        }
    }

    @Published private(set) var state: PermissionGuideState = .idle
    private(set) var plan = GuidePlan(pending: [])
    /// いま案内している対象（追従と検査のため）。
    private(set) var anchor: GuideAnchor?
    /// 最後の探索の理由（見つからなかったときに何が起きたか）。
    private(set) var lastLocateReason: String?

    private var deps: Dependencies
    private var observer: AXEventObserving?
    private var fallbackTimer: Timer?
    private var settingsWaitStarted: Date?
    private var distributedObserver: NSObjectProtocol?
    private var workspaceObservers: [NSObjectProtocol] = []
    private var generation = UUID()
    private var experience: GuidePermission?
    private var purpose: PermissionGuidePurpose?
    private var continuation: (() -> Void)?
    private var cancellation: (() -> Void)?
    private var restoreWindows: (() -> Void)?
    private lazy var locator = SystemSettingsAnchorLocator(tree: deps.tree)

    init(dependencies: Dependencies? = nil) {
        if let dependencies { deps = dependencies }
        else { deps = Dependencies.live() }
    }

    // MARK: - 入口

    /// 案内を始める。許可済みのものは飛ばす。
    func start(order: [GuidePermission] = GuidePlan.defaultOrder) {
        guard state.isTerminal else { return }
        tearDownWatchers()
        generation = UUID()
        plan = GuidePlan(order: order) { deps.permissions.state(of: $0) == .granted }
        GuideLog.debug("start: pending=\(plan.pending.map(\.rawValue))")
        deps.overlay.showAvatar(state: .guiding, message: Self.messageIntro, onClose: { [weak self] in self?.stop() })
        subscribeSystemEvents()
        advance()
    }

    /// A Settings row guides only the permission the user selected.
    func guide(_ permission: GuidePermission) {
        if !state.isTerminal { stop() }
        start(order: [permission])
    }

    /// Purpose-first public entry. Reading this card never requests OS access.
    func explain(_ permission: GuidePermission, purpose: PermissionGuidePurpose? = nil, onCancel: (() -> Void)? = nil, then: @escaping () -> Void) {
        stop()
        generation = UUID()
        experience = permission
        let copy = purpose ?? PermissionGuidePurpose(explanation: permission.explanation, readyMessage: permission.readyMessage)
        self.purpose = copy
        continuation = then
        cancellation = onCancel
        plan = GuidePlan(pending: [permission])
        deps.overlay.showAvatar(state: .guiding, message: copy.explanation, onClose: { [weak self] in self?.stop() })
        deps.overlay.focusAvatar()
        deps.overlay.setExplanationLabel("macOS：" + permission.systemPermissionName)
        deps.overlay.setSecondaryAction(("あとで", { [weak self] in self?.stop() }))
        if deps.permissions.state(of: permission) == .granted { showReady(permission); return }
        set(PermissionGuideState.intro(for: permission))
        let run = generation
        deps.overlay.updateAvatar(state: .guiding, message: copy.explanation,
            action: (permission.enableTitle, { [weak self] in
                guard let self, self.generation == run else { return }
                self.enableExplainedPermission()
            }))
    }

    private func enableExplainedPermission() {
        guard let permission = experience, state == PermissionGuideState.intro(for: permission) else { return }
        deps.overlay.setExplanationLabel(nil)
        deps.overlay.setSecondaryAction(nil)
        restoreWindows = deps.suspendWindows()
        subscribeSystemEvents()
        // Recheck immediately before asking: another Astra instance may have received the grant.
        if deps.permissions.state(of: permission) == .granted { showReady(permission); return }
        deps.overlay.setApplicationToAdd(permission == .microphone ? nil : deps.applicationToAdd)
        switch permission {
        case .accessibility: beginAccessibility()
        case .screenCapture: beginScreenCapture()
        case .microphone: beginMicrophone()
        }
    }

    private func showReady(_ permission: GuidePermission) {
        plan.finish(permission)
        tearDownWatchers()
        deps.overlay.hideGuide()
        deps.overlay.setApplicationToAdd(nil)
        deps.overlay.setExplanationLabel(nil)
        set(.ready(permission))
        let run = generation
        deps.overlay.updateAvatar(state: .success, message: purpose?.readyMessage ?? permission.readyMessage,
            action: (purpose?.continueTitle ?? "試してみる", { [weak self] in
                guard let self, self.generation == run, self.state == .ready(permission) else { return }
                // A grant may be revoked while the success card is still visible.
                guard self.deps.permissions.state(of: permission) == .granted else {
                    let action = self.continuation ?? {}
                    let cancel = self.cancellation
                    self.cancellation = nil
                    self.explain(permission, purpose: self.purpose, onCancel: cancel, then: action)
                    return
                }
                let action = self.continuation
                self.cancellation = nil
                self.stop()
                action?()
            }))
        deps.overlay.setSecondaryAction(("あとで", { [weak self] in self?.stop() }))
    }

    /// 案内をやめる。**窓と observer をすべて手放す。**
    func stop() {
        generation = UUID()
        tearDownWatchers()
        deps.overlay.hideAll()
        deps.overlay.setApplicationToAdd(nil)
        anchor = nil
        plan = GuidePlan(pending: [])
        experience = nil; purpose = nil; continuation = nil
        let cancel = cancellation; cancellation = nil
        deps.overlay.setExplanationLabel(nil)
        deps.overlay.setSecondaryAction(nil)
        let restore = restoreWindows; restoreWindows = nil
        set(.idle)
        restore?()
        cancel?()
    }

    // MARK: - 状態遷移（ここだけ）

    private func set(_ new: PermissionGuideState) {
        guard state != new else { return }
        GuideLog.debug("state: \(state) → \(new)")
        state = new
    }

    /// 次の権限へ。無ければ completed。
    private func advance() {
        while let next = plan.next, deps.permissions.state(of: next) == .granted { plan.finish(next) }
        guard let next = plan.next else {
            set(.completed)
            deps.overlay.updateAvatar(state: .success, message: Self.messageAllDone, action: nil)
            stopFallback()
            observer?.stop(); observer = nil
            let run = generation
            deps.after(deps.successDwell * 2) { [weak self] in
                guard let self, self.generation == run, self.state == .completed else { return }
                self.tearDownWatchers()
                self.deps.overlay.hideAll()
                self.set(.idle)
            }
            return
        }
        deps.overlay.setApplicationToAdd(next == .accessibility || next == .screenCapture ? deps.applicationToAdd : nil)
        set(PermissionGuideState.intro(for: next))
        switch next {
        case .accessibility: beginAccessibility()
        case .screenCapture: beginScreenCapture()
        case .microphone: beginMicrophone()
        }
    }

    private func beginAccessibility() {
        deps.overlay.updateAvatar(state: .guiding, message: Self.messageAccessibility, action: openSettingsAction(.accessibility))
        if deps.permissions.promptAccessibility() { granted(.accessibility); return }
        // 許可が無い間は AX を辿れないので、設定面を開いて一般ガイドだけ出す（推測位置には出さない）。
        deps.openSettings(.accessibility)
        set(.waitingAccessibility)
        startFallback()
    }

    private func beginScreenCapture() {
        deps.overlay.updateAvatar(state: .guiding, message: Self.messageScreenCapture, action: openSettingsAction(.screenCapture))
        if deps.permissions.requestScreenCapture() { granted(.screenCapture); return }
        set(.openingScreenSettings)
        deps.openSettings(.screenCapture)
        settingsWaitStarted = deps.now()
        tryGuideScreenCapture()
        startFallback()
    }

    private func beginMicrophone() {
        deps.overlay.updateAvatar(state: .guiding, message: Self.messageMicrophone, action: nil)
        switch deps.permissions.state(of: .microphone) {
        case .granted: granted(.microphone)
        case .notDetermined:
            set(.waitingMicrophone)
            let run = generation
            deps.permissions.requestMicrophone { [weak self] _ in
                guard let self, self.generation == run, self.state == .waitingMicrophone else { return }
                if self.deps.permissions.state(of: .microphone) == .granted { self.granted(.microphone) }
                else { self.guideMicrophoneInSettings() }
            }
        case .denied, .restricted:
            set(.waitingMicrophone)
            guideMicrophoneInSettings()
        }
    }

    private func guideMicrophoneInSettings() {
        deps.openSettings(.microphone)
        deps.overlay.updateAvatar(state: .guiding, message: Self.messageMicrophoneSettings, action: openSettingsAction(.microphone))
        settingsWaitStarted = deps.now()
        locateAndShow(selectors: SystemSettingsAnchorLocator.astraRowSelectors(appNames: deps.appNames),
                      message: Self.calloutTurnOn, fallback: Self.messageMicrophoneFallback)
        startFallback()
    }

    /// System Settings が現れたら対象を探して案内を出す。まだなら待つ（上限あり）。
    private func tryGuideScreenCapture() {
        guard state == .openingScreenSettings || state == .guidingScreenCapture || state == .waitingScreenCapture else { return }
        guard deps.settingsPID() != nil else {
            if let started = settingsWaitStarted, deps.now().timeIntervalSince(started) > deps.settingsLaunchTimeout {
                set(.failed("設定画面を開けませんでした"))
                deps.overlay.updateAvatar(state: .warning, message: Self.messageSettingsFailed,
                                          action: (Self.actionRetryOpenSettings, { [weak self] in self?.retryScreenSettings() }))
                stopFallback()
            }
            return
        }
        // 走ってはいるが AX 木がまだ空（起動直後）なら、開いている最中として待つ（上限は同じ）。
        if state == .openingScreenSettings, !settingsTreeIsReady() {
            if let started = settingsWaitStarted, deps.now().timeIntervalSince(started) > deps.settingsLaunchTimeout {
                set(.guidingScreenCapture)
            } else { return }
        }
        set(.guidingScreenCapture)
        locateScreenCaptureTargets()
        set(.waitingScreenCapture)
    }

    /// Astra 行 → 無ければ「+」→ 無ければ一般ガイド。**1 回の取り直しで 1 回だけ描く**
    /// （行が無いときに「消して→+ を描く」を毎回すると、AX の出来事ごとに吹き出しが点滅した）。
    private func locateScreenCaptureTargets() {
        locateAndShow(candidates: [
            (SystemSettingsAnchorLocator.astraRowSelectors(appNames: deps.appNames), Self.calloutTurnOn),
            (SystemSettingsAnchorLocator.addButtonSelectors, Self.calloutAdd),
        ], fallback: Self.messageGeneralTurnOn)
    }

    private func retryScreenSettings() {
        guard case .failed = state, plan.next == .screenCapture else { return }
        set(.openingScreenSettings)
        settingsWaitStarted = deps.now()
        deps.openSettings(.screenCapture)
        tryGuideScreenCapture()
        startFallback()
    }

    /// System Settings の AX 木が読める状態か（起動直後は app 要素だけで子が無い）。AX 未許可なら読めないので true 扱い
    /// （待っても変わらない。一般ガイドへ進む）。
    private func settingsTreeIsReady() -> Bool {
        guard deps.tree.isTrusted, let pid = deps.settingsPID() else { return true }
        return (deps.tree.applicationTree(pid: pid, maxDepth: 1, maxNodes: 8)?.nodeCount ?? 0) > 1
    }

    /// 対象を探して案内を出す。見つかれば true。見つからなければ fallback の一般ガイドだけ（推測位置に出さない）。
    @discardableResult
    private func locateAndShow(selectors: [AXSelector], message: String, fallback: String?) -> Bool {
        locateAndShow(candidates: [(selectors, message)], fallback: fallback)
    }

    /// 候補を優先順に試し、最初に見つかったものを描く。全部外れたときだけ案内を消して一般ガイドにする。
    @discardableResult
    private func locateAndShow(candidates: [([AXSelector], String)], fallback: String?) -> Bool {
        var result = SystemSettingsAnchorLocator.Result(anchor: nil, appTree: nil, reason: nil)
        var message = ""
        for (selectors, msg) in candidates {
            result = locator.locate(.accessibilityElement(bundleID: SystemSettingsAnchorLocator.bundleID, selectors: selectors))
            message = msg
            if result.anchor != nil { break }
        }
        lastLocateReason = result.reason
        let windows = (result.appTree?.windows ?? []).compactMap(\.element)
        if let found = result.anchor {
            anchor = found
            // 一般ガイド（fallback）を出していたなら、対象が見つかった時点で手順の文言へ戻す。
            if let permission = state.permission {
                deps.overlay.updateAvatar(state: .guiding, message: Self.introMessage(for: permission), action: openSettingsAction(permission))
            }
            // 吹き出しは見つけたものの名前で言う（一覧の行が「AstraDbg」なら「AstraDbg をオンにしてください」。別名で呼ぶと誤読させる）。
            let app = found.match.node.displayName ?? deps.appNames.first ?? "Astra"
            var named = message.replacingOccurrences(of: "{app}", with: app)
            // スイッチが既にオンなのに許可が無い = macOS が再起動を待っている（画面収録はそう）。「オンにして」とは言わない。
            let isSwitch = found.match.node.role == (kAXCheckBoxRole as String) || found.match.node.role == "AXSwitch"
            if isSwitch, found.match.node.value == "1" { named = Self.calloutAlreadyOn(for: app) }
            // 行のスイッチは行の**中**（名前とスイッチの間の空き）に置く: 尾がスイッチに触れ、スクロールバーを跨がない。
            // 「+」は下（横は隣の「−」を隠す）。
            let preferred: GuidePlacement = found.match.node.role == (kAXButtonRole as String) ? .below : .left
            deps.overlay.showGuide(message: named, at: found, preferred: preferred)
            watchSettings(elements: [found.match.node.element].compactMap { $0 } + windows)
            return true
        }
        anchor = nil
        deps.overlay.hideGuide()
        if let fallback, let permission = state.permission {
            deps.overlay.updateAvatar(state: .guiding, message: fallback, action: openSettingsAction(permission))
        }
        watchSettings(elements: windows)
        return false
    }

    /// 吹き出しの操作子: 文章で放り出さず、押せば設定画面へ行ける。
    private func openSettingsAction(_ permission: GuidePermission) -> (title: String, run: () -> Void) {
        (Self.actionOpenSettings, { [weak self] in self?.deps.openSettings(permission) })
    }

    // MARK: - 出来事

    /// 権限の状態を読み直す（OS の通知・AX の出来事・低頻度 fallback から）。
    func recheckPermissions() {
        guard let permission = state.permission, state.isWaiting else { return }
        if deps.permissions.state(of: permission) == .granted { granted(permission) }
    }

    /// AXObserver の出来事。対象を取り直して置き直し、権限も読み直す。
    /// ドラッグ中は `AXUIElementDestroyed` が連続で来るので、短い窓でまとめて 1 回だけ取り直す（AX 木を毎回は歩かない）。
    func handleAXEvent(_ name: String) {
        GuideLog.debug("ax event: \(name)")
        guard !relocatePending else { return }
        relocatePending = true
        let run = generation
        deps.after(deps.relocateCoalesceInterval) { [weak self] in
            guard let self, self.generation == run else { return }
            self.relocatePending = false
            self.relocateNow()
        }
    }

    private var relocatePending = false

    private func relocateNow() {
        switch state {
        case .waitingScreenCapture, .guidingScreenCapture:
            if deps.settingsPID() != nil { locateScreenCaptureTargets() }
        case .waitingMicrophone:
            locateAndShow(selectors: SystemSettingsAnchorLocator.astraRowSelectors(appNames: deps.appNames),
                          message: Self.calloutTurnOn, fallback: Self.messageMicrophoneFallback)
        default: break
        }
        recheckPermissions()
    }

    /// 低頻度 fallback（権限の付与は OS が通知しない）。System Settings の出現もここで拾う。
    func tick() {
        if state == .openingScreenSettings { tryGuideScreenCapture() }
        if state == .waitingScreenCapture || state == .waitingMicrophone, deps.settingsPID() != nil,
           observer?.isRunning != true || anchor == nil {
            // AXObserver が作れなかったとき、または対象がまだ見つかっていない（設定面が切り替わる途中など）ときだけ、
            // 低頻度で位置を取り直す。見つかっていて observer が動いている間は出来事だけに任せる。
            handleAXEvent("fallback.tick")
            return
        }
        recheckPermissions()
    }

    private func granted(_ permission: GuidePermission) {
        guard plan.pending.contains(permission) else { return }
        GuideLog.debug("granted: \(permission)")
        plan.finish(permission)
        anchor = nil
        deps.overlay.hideGuide()
        deps.overlay.setApplicationToAdd(nil)
        observer?.stop(); observer = nil
        stopFallback()
        if experience == permission { showReady(permission); return }
        deps.overlay.updateAvatar(state: .success, message: Self.messageDone(for: permission), action: nil)
        let run = generation
        deps.after(deps.successDwell) { [weak self] in
            guard let self, self.generation == run, !self.state.isTerminal else { return }
            self.advance()
        }
    }

    // MARK: - 監視

    private func watchSettings(elements: [AXUIElement]) {
        guard let pid = deps.settingsPID() else { return }
        if observer == nil || observer?.isRunning != true {
            let obs = deps.makeObserver()
            let ok = obs.start(pid: pid, notifications: AXObserverService.windowNotifications) { [weak self] name in
                self?.handleAXEvent(name)
            }
            observer = ok ? obs : nil
            if !ok { GuideLog.debug("AXObserver unavailable; relying on low-frequency fallback") }
        }
        for element in elements { observer?.observe(element: element, notifications: AXObserverService.elementNotifications) }
    }

    private func subscribeSystemEvents() {
        guard distributedObserver == nil else { return }
        // アクセシビリティの信頼が変わると OS がこれを配る。
        distributedObserver = DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.apple.accessibility.api"), object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.recheckPermissions() }
            }
        let ws = NSWorkspace.shared.notificationCenter
        workspaceObservers = [
            ws.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.tryGuideScreenCapture() }
            },
            ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.recheckPermissions() }
            },
        ]
    }

    private func startFallback() {
        stopFallback()
        guard deps.fallbackInterval > 0 else { return }
        let t = Timer(timeInterval: deps.fallbackInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        fallbackTimer = t
    }

    private func stopFallback() {
        fallbackTimer?.invalidate(); fallbackTimer = nil
    }

    private func tearDownWatchers() {
        relocatePending = false
        stopFallback()
        observer?.stop(); observer = nil
        if let d = distributedObserver { DistributedNotificationCenter.default().removeObserver(d); distributedObserver = nil }
        for o in workspaceObservers { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        workspaceObservers = []
        settingsWaitStarted = nil
    }

    /// 検査用: 監視が残っているか。
    var hasLiveWatchers: Bool { observer?.isRunning == true || fallbackTimer != nil || distributedObserver != nil || !workspaceObservers.isEmpty }

    // MARK: - 文言

    static func introMessage(for permission: GuidePermission) -> String {
        switch permission {
        case .accessibility: return messageAccessibility
        case .screenCapture: return messageScreenCapture
        case .microphone: return messageMicrophone
        }
    }

    // 盲検で直した文言: 「1 つ設定してください」は何を直すか言っていない（3/3 FIX）。対象と場所を言い切る。
    // 成功の ✓ は丸だけに描く（文にもあると二重で、OCR は「く」と読む）。失敗は短く、操作子（システム設定を開く）を添える。
    // 1 行目 = 状態、2 行目 = すること（改行で分ける。1 文に目的と手順を詰めない）。
    static let messageIntro = "使う機能の設定をいっしょに済ませます"
    static let messageAccessibility = "アクセシビリティの許可を確認しています\nシステム設定の一覧で Astra をオンにしてください"
    static let messageScreenCapture = "画面収録が未許可です\nシステム設定で Astra をオンにしてください"
    static let messageMicrophone = "マイクが未許可です\n許可すると声で頼めます"
    static let messageMicrophoneSettings = "マイクが未許可です\nマイクの設定で Astra をオンにしてください"
    static let messageGeneralTurnOn = "Astra を自動で見つけられません\n画面収録の一覧で Astra をオンにしてください"
    static let messageMicrophoneFallback = "Astra を自動で見つけられません\nマイクの一覧で Astra をオンにしてください"
    static let messageSettingsFailed = "設定画面を開けませんでした\nプライバシーとセキュリティ › 画面収録"
    /// 何を設定できたかを言う（「設定できました」だけだと、絵の文字が 1 語で判定不能になる。何が済んだかも分かる）。
    static func messageDone(for permission: GuidePermission) -> String {
        switch permission {
        case .accessibility: return "アクセシビリティを設定できました"
        case .screenCapture: return "画面収録を設定できました"
        case .microphone: return "マイクを設定できました"
        }
    }
    static let messageAllDone = "今回の権限設定を確認できました"
    /// スイッチはオンなのに許可がまだ = 再起動待ち。
    /// 短く（行の中に置くので、長いと行の名前を隠す）。尾がその行を指しているので名前は要らない。
    static func calloutAlreadyOn(for app: String) -> String { "\(app) を再起動して再確認してください" }
    static let actionRetryOpenSettings = "もう一度開く"
    static let actionOpenSettings = "システム設定を開く"
    /// `{app}` は見つけた行の名前に置き換える。
    static let calloutTurnOn = "{app} をオンにしてください"
    static let calloutAdd = "「+」から {app} を追加してください"
    static func calloutTurnOn(for app: String) -> String { calloutTurnOn.replacingOccurrences(of: "{app}", with: app) }
    static func calloutAdd(for app: String) -> String { calloutAdd.replacingOccurrences(of: "{app}", with: app) }
}
