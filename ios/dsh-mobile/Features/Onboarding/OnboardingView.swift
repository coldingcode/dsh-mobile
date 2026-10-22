import SwiftUI

@MainActor
struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showScanner = false
    @State private var showManual = false
    @State private var pendingPayload: PairingPayload?

    var body: some View {
        ZStack {
            AuroraBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 12) {
                        DshLogo(size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("dsh-mobile")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                            Text("本机 DeepSeek Harness")
                                .font(.system(size: 10.5))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.isDemo {
                            StatusPill(text: "DEMO", tint: DshColor.yellow)
                        }
                    }
                    .padding(.top, 8)

                    VStack(alignment: .leading, spacing: 15) {
                        Text("把本机 DSH\n放到手机上。")
                            .font(.dshTitle(41))
                            .tracking(-1.4)
                            .lineSpacing(-2)
                            .padding(.top, 44)
                        Text("手机只负责发消息。代码、文件和命令都在你的电脑上执行，会话仍然属于你自己的 DeepSeek Harness。")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    ConnectionPreview()
                        .padding(.top, 28)

                    VStack(spacing: 10) {
                        Button {
                            Haptics.impact(.medium)
                            showScanner = true
                        } label: {
                            HStack(spacing: 9) {
                                Image(systemName: "qrcode.viewfinder")
                                    .font(.system(size: 19, weight: .semibold))
                                Text("扫描配对二维码")
                                Spacer()
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .opacity(0.6)
                            }
                            .padding(.horizontal, 20)
                        }
                        .buttonStyle(PrimaryButtonStyle(minHeight: 58))

                        Button {
                            Haptics.impact()
                            showManual = true
                        } label: {
                            HStack(spacing: 9) {
                                Image(systemName: "keyboard")
                                    .font(.system(size: 17, weight: .medium))
                                Text("手动输入配对码")
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .opacity(0.4)
                            }
                            .padding(.horizontal, 20)
                        }
                        .buttonStyle(GlassButtonStyle(minHeight: 56))
                    }
                    .padding(.top, 26)

                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "lock.shield")
                            .font(.system(size: 12))
                            .foregroundStyle(DshColor.green)
                            .padding(.top, 1)
                        Text("配对只在同一局域网内完成。令牌保存在 iPhone 钥匙串，电脑端的配对页可以随时移除设备。")
                            .font(.system(size: 10.5))
                            .foregroundStyle(.tertiary)
                            .lineSpacing(2)
                    }
                    .padding(.top, 18)

                    HStack(spacing: 6) {
                        Text("dsh-mobile v" + DeviceIdentity.appVersion)
                        Text("·")
                        Text("GitHub Actions 自签构建")
                        Spacer()
                    }
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(.quaternary)
                    .padding(.top, 28)
                    .padding(.bottom, 12)
                }
                .padding(.horizontal, 22)
            }
        }
        .fullScreenCover(isPresented: $showScanner) {
            ScannerView { payload in
                showScanner = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                    pendingPayload = payload
                }
            }
        }
        .sheet(isPresented: $showManual) {
            ManualPairView { payload in
                showManual = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    pendingPayload = payload
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.hidden)
        }
        .fullScreenCover(item: $pendingPayload) { payload in
            PairingFlowView(payload: payload)
                .environmentObject(model)
        }
        .preferredColorScheme(nil)
    }
}

private struct ConnectionPreview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .fill(DshColor.accent2.opacity(0.1))
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .strokeBorder(DshColor.accent2.opacity(0.2), lineWidth: 1)
                    Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                        .font(.system(size: 21, weight: .medium))
                        .foregroundStyle(DshColor.accent2)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 3) {
                    Text("局域网直连")
                        .font(.system(size: 14, weight: .semibold))
                    Text("扫码后，手机会通过本机桥接访问 DSH")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                StatusPill(text: "等待配对", tint: DshColor.accent2)
            }

            Divider()
                .overlay(Color.white.opacity(0.09))
                .padding(.vertical, 16)

            HStack(spacing: 0) {
                PreviewFeature(icon: "desktopcomputer", title: "本机执行", tint: DshColor.accent)
                PreviewFeature(icon: "key.horizontal", title: "令牌配对", tint: DshColor.accent2)
                PreviewFeature(icon: "hand.raised", title: "随时移除", tint: DshColor.green)
            }
        }
        .glassCard(radius: 28, padding: 18)
    }
}

private struct PreviewFeature: View {
    let icon: String
    let title: String
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
            Text(title)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
