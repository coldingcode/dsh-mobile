import SwiftUI
import UIKit

@MainActor
struct WebShellView: View {
    @EnvironmentObject private var model: AppModel
    let profile: ServerProfile

    @State private var loaded = false
    @State private var loadError: String?
    @State private var showSettings = false
    @State private var shareItems: [Any] = []
    @State private var showShare = false

    var body: some View {
        ZStack {
            Color(hex: 0x050509).ignoresSafeArea()

            BridgeWebView(
                profile: profile,
                reloadToken: model.reloadToken,
                onLoad: {
                    withAnimation(.easeOut(duration: 0.35)) {
                        loaded = true
                        loadError = nil
                    }
                },
                onFailure: { message in
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) {
                        loadError = message
                        loaded = true
                    }
                },
                onMessage: handleMessage
            )
            .ignoresSafeArea()

            if !loaded {
                ZStack {
                    AuroraBackground()
                    BootLogo()
                }
                .transition(.opacity)
            }

            if let loadError {
                ErrorOverlay(
                    message: loadError,
                    onRetry: {
                        self.loadError = nil
                        self.loaded = false
                        model.reload()
                    },
                    onSettings: { showSettings = true },
                    onDisconnect: { model.disconnect() }
                )
                .transition(.opacity)
            }
        }
        .sheet(isPresented: $showSettings) {
            NativeShellSettings(profile: profile)
                .environmentObject(model)
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
        .sheet(isPresented: $showShare) {
            ActivityView(items: shareItems)
        }
        .onChange(of: model.reloadToken) { _, _ in
            loaded = false
            loadError = nil
        }
        .preferredColorScheme(nil)
    }

    private func handleMessage(_ type: String, _ body: [String: Any]) {
        switch type {
        case "ready":
            withAnimation(.easeOut(duration: 0.35)) { loaded = true }
        case "haptic":
            let style = body["style"] as? String ?? "light"
            switch style {
            case "success": Haptics.success()
            case "warning": Haptics.warning()
            case "error": Haptics.error()
            case "medium": Haptics.impact(.medium)
            case "heavy": Haptics.impact(.heavy)
            default: Haptics.impact(.light)
            }
        case "share":
            var items: [Any] = []
            if let text = body["text"] as? String { items.append(text) }
            if let url = body["url"] as? String, let parsed = URL(string: url) { items.append(parsed) }
            if items.isEmpty, let title = body["title"] as? String { items.append(title) }
            shareItems = items
            showShare = !items.isEmpty
        case "openURL":
            if let value = body["url"] as? String, let url = URL(string: value) {
                UIApplication.shared.open(url)
            }
        case "disconnect":
            model.disconnect()
        case "openSettings":
            showSettings = true
        default:
            break
        }
    }
}

private struct ErrorOverlay: View {
    let message: String
    let onRetry: () -> Void
    let onSettings: () -> Void
    let onDisconnect: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(DshColor.red)
                Text("连接不到本机 DSH")
                    .font(.dshTitle(24))
                Text(message)
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                VStack(spacing: 9) {
                    Button("重试") { onRetry() }
                        .buttonStyle(PrimaryButtonStyle(minHeight: 50))
                    Button("原生设置") { onSettings() }
                        .buttonStyle(GlassButtonStyle(minHeight: 48))
                    Button("重新配对") { onDisconnect() }
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                .padding(.top, 6)
            }
            .padding(24)
            .frame(maxWidth: 330)
            .glassCard(radius: 30, padding: 24)
            .padding(24)
        }
    }
}

struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
