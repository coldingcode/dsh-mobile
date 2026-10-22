import SwiftUI

@main
@MainActor
struct DshMobileApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .tint(DshColor.accent)
                .onOpenURL { url in
                    model.handle(url: url)
                }
        }
    }
}

@MainActor
private struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.phase == .shell, let profile = model.profile {
                WebShellView(profile: profile)
                    .id(profile.id)
                    .transition(.opacity)
            } else {
                OnboardingView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.32), value: model.phase)
        .fullScreenCover(item: $model.incomingPayload) { payload in
            PairingFlowView(payload: payload)
                .environmentObject(model)
        }
    }
}
