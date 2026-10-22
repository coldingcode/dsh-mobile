import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case onboarding
        case shell
    }

    @Published private(set) var profile: ServerProfile?
    @Published private(set) var phase: Phase
    @Published var reloadToken = UUID()
    @Published var incomingPayload: PairingPayload?
    let isDemo: Bool

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        isDemo = arguments.contains("-dshmDemo")
        if arguments.contains("-dshmReset") {
            KeychainStore.delete()
        }
        if let saved = KeychainStore.load() {
            profile = saved
            phase = .shell
        } else {
            profile = nil
            phase = .onboarding
        }
    }

    func save(_ newProfile: ServerProfile) {
        KeychainStore.save(newProfile)
        profile = newProfile
        withAnimation(.spring(response: 0.6, dampingFraction: 0.86)) {
            phase = .shell
        }
    }

    func disconnect() {
        if let profile {
            Task {
                await BridgeAPI(baseURL: profile.baseURL).logout(token: profile.token)
            }
        }
        KeychainStore.delete()
        profile = nil
        withAnimation(.easeInOut(duration: 0.3)) {
            phase = .onboarding
        }
    }

    func reload() {
        reloadToken = UUID()
    }

    func handle(url: URL) {
        guard let payload = PairingPayload(scannerText: url.absoluteString) else { return }
        incomingPayload = payload
    }
}
