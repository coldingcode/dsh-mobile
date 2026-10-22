import SwiftUI
import UIKit

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

enum DshColor {
    static let bg = Color(hex: 0x050509)
    static let ink = Color(hex: 0xF7F7FB)
    static let muted = Color.white.opacity(0.56)
    static let accent = Color(hex: 0x7C8CFF)
    static let accent2 = Color(hex: 0x58D8FF)
    static let accent3 = Color(hex: 0xC084FC)
    static let green = Color(hex: 0x5EE6A8)
    static let red = Color(hex: 0xFF6B81)
    static let yellow = Color(hex: 0xFFD479)

    static var userGradient: LinearGradient {
        LinearGradient(colors: [Color(hex: 0x7181FF), Color(hex: 0x4D5DE3)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static var brandGradient: LinearGradient {
        LinearGradient(colors: [Color(hex: 0x8E9CFF), Color(hex: 0x5364EA), Color(hex: 0x1A2046)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension Font {
    static func dshTitle(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }

    static func dshBody(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

enum Haptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}

struct GlassCardModifier: ViewModifier {
    var radius: CGFloat = 30
    var padding: CGFloat = 18

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(.ultraThinMaterial)
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [Color.white.opacity(0.16), Color.white.opacity(0.035)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [Color.white.opacity(0.34), Color.white.opacity(0.06), Color.white.opacity(0.16)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            }
            .shadow(color: Color.black.opacity(0.34), radius: 30, x: 0, y: 18)
    }
}

extension View {
    func glassCard(radius: CGFloat = 30, padding: CGFloat = 18) -> some View {
        modifier(GlassCardModifier(radius: radius, padding: padding))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 54

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(DshColor.userGradient)
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(
                            RadialGradient(
                                colors: [Color.white.opacity(0.38), Color.clear],
                                center: .topLeading,
                                startRadius: 0,
                                endRadius: 160
                            )
                        )
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.24), lineWidth: 1)
            }
            .shadow(color: Color(hex: 0x4252DC).opacity(0.42), radius: 22, x: 0, y: 12)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.72), value: configuration.isPressed)
    }
}

struct GlassButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 54

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15.5, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
            }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.72), value: configuration.isPressed)
    }
}

struct RoundIconButtonStyle: ButtonStyle {
    var size: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(width: size, height: size)
            .background(.ultraThinMaterial, in: Circle())
            .overlay { Circle().strokeBorder(Color.white.opacity(0.16), lineWidth: 1) }
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct DshLogo: View {
    var size: CGFloat = 68

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.31, style: .continuous)
                .fill(DshColor.brandGradient)
            RoundedRectangle(cornerRadius: size * 0.31, style: .continuous)
                .fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.92), Color.white.opacity(0.34), Color.clear],
                        center: UnitPoint(x: 0.22, y: 0.12),
                        startRadius: 0,
                        endRadius: size * 0.8
                    )
                )
            RoundedRectangle(cornerRadius: size * 0.31, style: .continuous)
                .strokeBorder(Color.white.opacity(0.34), lineWidth: 1)
            Text("d")
                .font(.system(size: size * 0.56, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .offset(y: -size * 0.02)
                .shadow(color: Color.black.opacity(0.22), radius: size * 0.04, x: 0, y: size * 0.03)
        }
        .frame(width: size, height: size)
        .shadow(color: Color(hex: 0x4B5CE6).opacity(0.38), radius: size * 0.32, x: 0, y: size * 0.22)
    }
}

struct StatusPill: View {
    var text: String
    var tint: Color = DshColor.green
    var showsDot: Bool = true

    var body: some View {
        HStack(spacing: 7) {
            if showsDot {
                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
                    .shadow(color: tint.opacity(0.8), radius: 5)
            }
            Text(text)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .frame(height: 30)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay { Capsule().strokeBorder(Color.white.opacity(0.13), lineWidth: 1) }
    }
}

struct SheetGrabber: View {
    var body: some View {
        Capsule()
            .fill(Color.white.opacity(0.2))
            .frame(width: 38, height: 5)
            .padding(.top, 8)
            .padding(.bottom, 12)
    }
}

struct IconBadge: View {
    var systemName: String
    var tint: Color = DshColor.accent2
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.4, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                    .strokeBorder(tint.opacity(0.18), lineWidth: 1)
            }
    }
}

struct InfoLine: View {
    var icon: String
    var title: String
    var value: String
    var mono: Bool = false

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 22)
            Text(title)
                .font(.system(size: 13.5))
            Spacer(minLength: 10)
            Text(value)
                .font(.system(size: mono ? 11 : 12.5, weight: .regular, design: mono ? .monospaced : .default))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(minHeight: 46)
    }
}
