import SwiftUI

@MainActor
struct ManualPairView: View {
    @Environment(\.dismiss) private var dismiss
    let onPair: (PairingPayload) -> Void

    @State private var urlText = "http://"
    @State private var code = ""
    @State private var errorText: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            ZStack {
                AuroraBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("手动连接")
                                .font(.dshTitle(32))
                            Text("在电脑的配对页上找到服务地址和 8 位配对码。手机和电脑需要在同一个 Wi-Fi。")
                                .font(.system(size: 13.5))
                                .foregroundStyle(.secondary)
                                .lineSpacing(3)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Label("服务地址", systemImage: "network")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                            TextField("http://192.168.1.20:47821", text: $urlText)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .font(.system(size: 14, design: .monospaced))
                                .padding(15)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.13), lineWidth: 1)
                                }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Label("配对码", systemImage: "key")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                            TextField("XXXX-XXXX", text: $code)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .font(.system(size: 22, weight: .semibold, design: .monospaced))
                                .multilineTextAlignment(.center)
                                .padding(15)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.13), lineWidth: 1)
                                }
                                .onChange(of: code) { _, newValue in
                                    let clean = String(newValue.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(9))
                                    if newValue != clean { code = clean }
                                }
                        }

                        if let errorText {
                            HStack(spacing: 7) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                Text(errorText)
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(DshColor.red)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(DshColor.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        }

                        Button {
                            Task { await connect() }
                        } label: {
                            HStack(spacing: 8) {
                                if isLoading { ProgressView().tint(.white) }
                                Text(isLoading ? "正在检查…" : "连接并配对")
                                if !isLoading { Image(systemName: "arrow.right") }
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(isLoading || code.trimmingCharacters(in: .whitespaces).isEmpty)

                        Text("配对码每 10 分钟刷新。若地址以 127.0.0.1 或 localhost 开头，手机无法访问——请使用电脑的局域网 IP。")
                            .font(.system(size: 10.5))
                            .foregroundStyle(.tertiary)
                            .lineSpacing(2)
                    }
                    .padding(22)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("取消") { dismiss() }
                        .foregroundStyle(.secondary)
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
    }

    private func connect() async {
        errorText = nil
        var candidate = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        if candidate.isEmpty { candidate = "http://" }
        if !candidate.contains("://") { candidate = "http://" + candidate }
        guard let url = URL(string: candidate), let scheme = url.scheme,
              ["http", "https"].contains(scheme), url.host != nil else {
            errorText = "请输入有效的服务地址"
            Haptics.error()
            return
        }
        guard PairingPayload.normalizeCode(code).count == 8 else {
            errorText = "配对码应为 8 位"
            Haptics.error()
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let api = BridgeAPI(baseURL: url)
            let info = try await api.pairInfo(code: PairingPayload.normalizeCode(code))
            guard info.validCode else {
                errorText = "配对码无效或已过期，请在电脑上刷新二维码"
                Haptics.error()
                return
            }
            let payload = PairingPayload.makeManual(baseURL: url, code: code, serverName: info.serverName)
            Haptics.success()
            onPair(payload)
            dismiss()
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            Haptics.error()
        }
    }
}
