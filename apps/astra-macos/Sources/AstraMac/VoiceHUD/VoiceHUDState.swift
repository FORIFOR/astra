import SwiftUI

@MainActor
final class VoiceHUDState: ObservableObject {
    static let shared = VoiceHUDState()
    enum Mode { case idle, listening, thinking }
    @Published var mode: Mode = .idle
}
