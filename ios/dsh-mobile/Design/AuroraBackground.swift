import SwiftUI

struct AuroraBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var animate = false

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            ZStack {
                (colorScheme == .light ? Color(hex: 0xEEF0F7) : Color(hex: 0x050509))
                    .ignoresSafeArea()

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color(hex: 0x6F7EFF).opacity(0.68), Color(hex: 0x5B4CFF).opacity(0.12), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: width * 0.58
                        )
                    )
                    .frame(width: width * 1.2, height: width * 1.2)
                    .blur(radius: 70)
                    .offset(x: animate ? -width * 0.18 : -width * 0.34, y: animate ? -height * 0.36 : -height * 0.28)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color(hex: 0x27C9E8).opacity(0.52), Color(hex: 0x268CFF).opacity(0.1), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: width * 0.52
                        )
                    )
                    .frame(width: width * 1.05, height: width * 1.05)
                    .blur(radius: 74)
                    .offset(x: animate ? width * 0.34 : width * 0.5, y: animate ? height * 0.1 : height * 0.2)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color(hex: 0xC660FF).opacity(0.4), Color(hex: 0xFF60AA).opacity(0.08), .clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: width * 0.52
                        )
                    )
                    .frame(width: width * 0.98, height: width * 0.98)
                    .blur(radius: 82)
                    .offset(x: animate ? width * 0.14 : width * 0.26, y: animate ? height * 0.47 : height * 0.55)

                LinearGradient(
                    colors: [Color.black.opacity(colorScheme == .light ? 0.02 : 0.24), .clear, Color.black.opacity(colorScheme == .light ? 0.05 : 0.38)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            }
            .frame(width: width, height: height)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.easeInOut(duration: 18).repeatForever(autoreverses: true)) {
                animate = true
            }
        }
    }
}

struct BootLogo: View {
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 22) {
            DshLogo(size: 78)
                .scaleEffect(pulse ? 1.04 : 0.96)
                .shadow(color: DshColor.accent.opacity(0.35), radius: pulse ? 34 : 18)
            VStack(spacing: 8) {
                Text("dsh-mobile")
                    .font(.dshTitle(30))
                    .foregroundStyle(.primary)
                Text("正在连接你电脑上的 DSH…")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            ProgressView()
                .tint(Color.primary)
                .padding(.top, 4)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}
