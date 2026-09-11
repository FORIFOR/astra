import Foundation

/// Guided Setup の状態。**遷移させるのは `PermissionGuideCoordinator` だけ。**View からは変えない。
enum PermissionGuideState: Equatable {
    case idle
    case accessibilityIntro
    case waitingAccessibility
    case screenCaptureIntro
    case openingScreenSettings
    case guidingScreenCapture
    case waitingScreenCapture
    case microphoneIntro
    case waitingMicrophone
    case ready(GuidePermission)
    case completed
    case failed(String)

    /// いまどの権限の話か。
    var permission: GuidePermission? {
        switch self {
        case .accessibilityIntro, .waitingAccessibility: return .accessibility
        case .screenCaptureIntro, .openingScreenSettings, .guidingScreenCapture, .waitingScreenCapture: return .screenCapture
        case .microphoneIntro, .waitingMicrophone: return .microphone
        case .ready(let permission): return permission
        case .idle, .completed, .failed: return nil
        }
    }

    /// 権限の付与を待っている（OS API で確かめる）状態か。
    var isWaiting: Bool {
        switch self {
        case .waitingAccessibility, .guidingScreenCapture, .waitingScreenCapture, .waitingMicrophone: return true
        default: return false
        }
    }

    var isTerminal: Bool {
        switch self {
        case .completed, .failed, .idle: return true
        default: return false
        }
    }

    /// その権限の導入状態。
    static func intro(for permission: GuidePermission) -> PermissionGuideState {
        switch permission {
        case .accessibility: return .accessibilityIntro
        case .screenCapture: return .screenCaptureIntro
        case .microphone: return .microphoneIntro
        }
    }
}

/// 何を案内するか（まだ許可されていないものだけ、決まった順で）。
struct GuidePlan: Equatable {
    static let defaultOrder: [GuidePermission] = [.accessibility, .screenCapture, .microphone]
    var pending: [GuidePermission]

    init(pending: [GuidePermission]) { self.pending = pending }

    /// 許可済みを除いた計画。順番は固定（アクセシビリティが先: あとの AX 案内に要る）。
    init(order: [GuidePermission] = GuidePlan.defaultOrder, granted: (GuidePermission) -> Bool) {
        pending = order.filter { !granted($0) }
    }

    var next: GuidePermission? { pending.first }

    mutating func finish(_ permission: GuidePermission) {
        pending.removeAll { $0 == permission }
    }
}
