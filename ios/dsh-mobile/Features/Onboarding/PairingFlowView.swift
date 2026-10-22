import SwiftUI

@MainActor
struct PairingFlowView: View {
    enum Phase: Equatable {
        case idle
        case requesting
        case waiting
        case success
        case failed
    }

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    let payload: PairingPayload

    @State private var phase: Phase = .idle
    @State private var receipt: PairRequestReceipt?
    @State private var errorText: String?
    @State private var displayName: String = ""

    private var baseURL: URL? { payload.baseURL }

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        DshLogo(size: 40)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("配对")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Text("dsh-mobile")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .buttonStyle(RoundIconButtonStyle(size: 40))
                        .disabled(phase == .waiting)
                        .opacity(phase == .waiting ? 0.4 : 1)
                    }
                    .padding(.top, 8)

                    VStack(alignment: .leading, spacing: 9) {
                        Text(phase == .success ? "配对成功。" : "连接这台电脑。")
                            .font(.dshTitle(36))
                            .tracking(-1.2)
                            .padding(.top, 38)
                        Text(phase == .success ? "正在把令牌安全地写入钥匙串…" : "请求会发送到电脑。请在电脑的配对页核对 6 位数字并允许。")
                            .font(.system(size: 13.5))
                            .foregroundStyle(.secondary)
                            .lineSpacing(3)
                    }

                    serverCard
                        .padding(.top, 24)

                    Group {
                        switch phase {
                        case .idle, .requesting:
                            idleContent
                        case .waiting:
                            waitingContent
                        case .success:
                            successContent
                        case .failed:
                            failedContent
                        }
                    }
                    .padding(.top, 18)

                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 26)
            }
        }
        .interactiveDismissDisabled(phase == .waiting || phase == .success)
        .task(id: receipt?.requestId) {
            guard let receipt else { return }
            await poll(receipt)
        }
        .onAppear {
            displayName = payload.n
        }
    }

    private var serverCard: some View {
        HStack(spacing: 13) {
            IconBadge(systemName: "desktopcomputer", tint: DshColor.accent, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(displayName)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                Text(payload.u)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let fingerprint = payload.f, !fingerprint.isEmpty {
                    Text(fingerprint)
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(.quaternary)
                }
            }
            Spacer(minLength: 8)
            StatusPill(text: payload.code, tint: DshColor.accent2, showsDot: false)
        }
        .glassCard(radius: 24, padding: 15)
    }

    private var idleContent: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 11) {
                PairStep(icon: "1.circle.fill", title: "发起请求", detail: "手机会把你的设备名和一次性配对码发给电脑。")
                PairStep(icon: "2.circle.fill", title: "核对数字", detail: "电脑配对页会显示一个 6 位核对码，和手机上的一致才继续。")
                PairStep(icon: "3.circle.fill", title: "保存令牌", detail: "允许后，令牌只写入 iPhone 钥匙串，可随时在电脑上吊销。")
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let errorText {
                Text(errorText)
                    .font(.system(size: 12))
                    .foregroundStyle(DshColor.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(DshColor.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }

            Button {
                Task { await requestPair() }
            } label: {
                HStack(spacing: 8) {
                    if phase == .requesting { ProgressView().tint(.white) }
                    Text(phase == .requesting ? "正在请求…" : "向电脑请求配对")
                    if phase != .requesting { Image(systemName: "arrow.right") }
                }
            }
            .buttonStyle(PrimaryButtonStyle(minHeight: 56))
            .disabled(phase == .requesting || baseURL == nil)
        }
    }

    private var waitingContent: some View {
        VStack(spacing: 14) {
            if let receipt {
                Text("在电脑上核对")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Text(receipt.verificationCode)
                    .font(.system(size: 58, weight: .bold, design: .monospaced))
                    .tracking(5)
                    .foregroundStyle(.primary)
                    .shadow(color: DshColor.accent.opacity(0.45), radius: 24)
                Text("电脑配对页会显示同一个数字。确认后，电脑会允许这台 iPhone 连接。")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.horizontal, 8)
                ProgressView()
                    .tint(Color.primary)
                    .padding(.top, 2)
                Button("取消配对") {
                    Haptics.impact()
                    phase = .idle
                    self.receipt = nil
                }
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var successContent: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 44))
                .foregroundStyle(DshColor.green)
                .shadow(color: DshColor.green.opacity(0.5), radius: 22)
            Text("设备已信任")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
            Text("正在打开 dsh-mobile…")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var failedContent: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(DshColor.red)
            Text(errorText ?? "配对失败")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("重新请求") {
                errorText = nil
                receipt = nil
                phase = .idle
            }
            .buttonStyle(GlassButtonStyle(minHeight: 48))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }

    private func requestPair() async {
        guard let baseURL else {
            errorText = "配对地址无效"
            phase = .failed
            return
        }
        errorText = nil
        phase = .requesting
        Haptics.impact()
        do {
            let api = BridgeAPI(baseURL: baseURL)
            let value = try await api.pairRequest(code: payload.c, deviceName: DeviceIdentity.name)
            receipt = value
            displayName = value.serverName
            phase = .waiting
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            phase = .failed
            Haptics.error()
        }
    }

    private func poll(_ receipt: PairRequestReceipt) async {
        guard let baseURL else { return }
        let api = BridgeAPI(baseURL: baseURL)
        for _ in 0..<150 {
            if Task.isCancelled { return }
            do {
                let status = try await api.pairStatus(requestId: receipt.requestId)
                switch status.status {
                case "approved":
                    guard let token = status.token else {
                        errorText = "电脑已经允许，但没有收到设备令牌。请重新配对。"
                        phase = .failed
                        return
                    }
                    await finish(token: token, status: status, baseURL: baseURL)
                    return
                case "denied":
                    errorText = status.reason ?? "电脑端拒绝了这次配对"
                    phase = .failed
                    Haptics.error()
                    return
                case "expired":
                    errorText = status.reason ?? "配对请求已过期，请重新请求"
                    phase = .failed
                    Haptics.error()
                    return
                default:
                    try await Task.sleep(nanoseconds: 1_200_000_000)
                }
            } catch is CancellationError {
                return
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                phase = .failed
                Haptics.error()
                return
            }
        }
        errorText = "等待电脑确认超时，请重新请求"
        phase = .failed
    }

    private func finish(token: String, status: PairStatusResponse, baseURL: URL) async {
        let health = try? await BridgeAPI(baseURL: baseURL).health()
        let profile = ServerProfile(
            id: UUID(),
            displayName: health?.serverName ?? displayName,
            baseURL: baseURL,
            token: token,
            fingerprint: payload.f,
            pairedAt: Date(),
            tokenExpiresAt: status.tokenExpiresAt.map { $0.millisecondsDate },
            permissionMode: health?.permissionMode,
            platform: health?.platform,
            model: health?.model,
            appVersion: health?.version
        )
        model.save(profile)
        phase = .success
        Haptics.success()
        try? await Task.sleep(nanoseconds: 850_000_000)
        dismiss()
    }
}

private struct PairStep: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(DshColor.accent2)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold))
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .lineSpacing(1.5)
            }
        }
    }
}
