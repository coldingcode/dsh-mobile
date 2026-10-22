import SwiftUI
import UIKit

@MainActor
struct NativeShellSettings: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let profile: ServerProfile

    @State private var health: BridgeHealth?
    @State private var latency: Int?
    @State private var errorText: String?
    @State private var showDisconnect = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 20) {
                        header
                        serverCard
                        connectionCard
                        aboutCard
                        dangerZone
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 8)
                    .padding(.bottom, 28)
                }
            }
            .navigationTitle("原生设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .task { await checkHealth() }
        .alert("断开这台设备？", isPresented: $showDisconnect) {
            Button("取消", role: .cancel) {}
            Button("断开", role: .destructive) {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    model.disconnect()
                }
            }
        } message: {
            Text("手机上的令牌会被吊销，下次需要重新扫码。电脑上的 DSH 会话和文件不会受影响。")
        }
    }

    private var header: some View {
        HStack(spacing: 13) {
            DshLogo(size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(profile.displayName)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Text(profile.host)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(
                text: errorText == nil ? (health == nil ? "检查中" : "已连接") : "离线",
                tint: errorText == nil ? DshColor.green : DshColor.red
            )
        }
        .padding(.top, 6)
    }

    private var serverCard: some View {
        VStack(spacing: 0) {
            InfoLine(icon: "network", title: "桥接地址", value: profile.baseURL.absoluteString, mono: true)
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(icon: "waveform.path.ecg", title: "延迟", value: latency.map { String($0) + " ms" } ?? "—")
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(icon: "cpu", title: "当前模型", value: profile.modelLabel)
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(
                icon: profile.isDangerFullAccess ? "exclamationmark.shield" : "lock.shield",
                title: "权限",
                value: profile.permissionLabel
            )
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(icon: "calendar", title: "配对时间", value: profile.pairedAt.formatted(date: .abbreviated, time: .shortened))
        }
        .padding(.horizontal, 16)
        .glassCard(radius: 26, padding: 0)
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("连接", systemImage: "wifi")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if let errorText {
                    Text(errorText)
                        .font(.system(size: 10.5))
                        .foregroundStyle(DshColor.red)
                        .lineLimit(1)
                }
            }
            Button {
                model.reload()
                dismiss()
            } label: {
                Label("重新加载网页", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(GlassButtonStyle(minHeight: 48))

            Button {
                UIPasteboard.general.string = profile.baseURL.absoluteString
                copied = true
                Haptics.success()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
            } label: {
                Label(copied ? "地址已复制" : "复制服务器地址", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(GlassButtonStyle(minHeight: 48))

            Button {
                Task { await checkHealth() }
            } label: {
                Label("重新检查连接", systemImage: "antenna.radiowaves.left.and.right")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(GlassButtonStyle(minHeight: 48))
        }
        .glassCard(radius: 26, padding: 16)
    }

    private var aboutCard: some View {
        VStack(spacing: 0) {
            InfoLine(icon: "app.badge", title: "App 版本", value: DeviceIdentity.appVersion, mono: true)
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(icon: "lock", title: "令牌", value: "iOS 钥匙串 · 仅本机")
            Divider().overlay(Color.white.opacity(0.08))
            InfoLine(icon: "curlybraces", title: "桥接服务", value: health.map { $0.version } ?? "—", mono: true)
        }
        .padding(.horizontal, 16)
        .glassCard(radius: 26, padding: 0)
    }

    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("移除设备")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("断开后这台 iPhone 需要重新扫码配对。你也可以在电脑的配对页移除它。")
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .lineSpacing(2)
            Button {
                showDisconnect = true
            } label: {
                Label("断开这台设备", systemImage: "unplug")
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(DshColor.red)
            }
            .buttonStyle(GlassButtonStyle(minHeight: 48))
        }
        .glassCard(radius: 26, padding: 16)
    }

    private func checkHealth() async {
        errorText = nil
        let start = Date()
        do {
            let value = try await BridgeAPI(baseURL: profile.baseURL).health()
            health = value
            latency = max(1, Int(Date().timeIntervalSince(start) * 1000))
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            health = nil
            latency = nil
        }
    }
}
