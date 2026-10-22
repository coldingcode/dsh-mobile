import AVFoundation
import Combine
import SwiftUI
import UIKit

final class ScannerController: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate {
    enum Permission: Equatable {
        case unknown
        case granted
        case denied
    }

    let session = AVCaptureSession()
    @Published var permission: Permission = .unknown
    @Published var torchAvailable = false
    @Published var errorMessage: String?

    private let queue = DispatchQueue(label: "app.dsh.mobile.scanner")
    private var configured = false
    private var device: AVCaptureDevice?
    private var hasResult = false
    private var lastInvalidAt = Date.distantPast
    private var onFound: ((PairingPayload) -> Void)?
    private var onInvalid: ((String) -> Void)?

    func start(onFound: @escaping (PairingPayload) -> Void, onInvalid: @escaping (String) -> Void) {
        self.onFound = onFound
        self.onInvalid = onInvalid
        hasResult = false
        errorMessage = nil
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            permission = .granted
            configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        self.permission = .granted
                        self.configureAndStart()
                    } else {
                        self.permission = .denied
                    }
                }
            }
        case .denied, .restricted:
            permission = .denied
        @unknown default:
            permission = .denied
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
            if let device = self.device, device.hasTorch, device.torchMode == .on {
                do {
                    try device.lockForConfiguration()
                    device.torchMode = .off
                    device.unlockForConfiguration()
                } catch {}
            }
        }
    }

    func toggleTorch() {
        guard let device, device.hasTorch else { return }
        queue.async {
            do {
                try device.lockForConfiguration()
                device.torchMode = device.torchMode == .on ? .off : .on
                device.unlockForConfiguration()
            } catch {
                DispatchQueue.main.async { self.errorMessage = "无法打开手电筒" }
            }
        }
    }

    private func configureAndStart() {
        guard !configured else {
            queue.async {
                if !self.session.isRunning { self.session.startRunning() }
            }
            return
        }
        configured = true
        queue.async {
            self.session.beginConfiguration()
            self.session.sessionPreset = .high
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.errorMessage = "这台设备没有可用的后置相机" }
                return
            }
            do {
                let input = try AVCaptureDeviceInput(device: camera)
                guard self.session.canAddInput(input) else { throw NSError(domain: "scanner", code: 1) }
                self.session.addInput(input)
                let output = AVCaptureMetadataOutput()
                guard self.session.canAddOutput(output) else { throw NSError(domain: "scanner", code: 2) }
                self.session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
                self.device = camera
                self.session.commitConfiguration()
                self.session.startRunning()
                DispatchQueue.main.async {
                    self.torchAvailable = camera.hasTorch
                }
            } catch {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.errorMessage = "相机启动失败，请稍后再试" }
            }
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !hasResult else { return }
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue else { return }
        if let payload = PairingPayload(scannerText: value) {
            hasResult = true
            session.stopRunning()
            Haptics.success()
            onFound?(payload)
        } else if Date().timeIntervalSince(lastInvalidAt) > 1.5 {
            lastInvalidAt = Date()
            Haptics.warning()
            onInvalid?("这不是 dsh-mobile 的配对二维码")
        }
    }
}

private final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let connection = previewLayer.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> CameraPreviewView {
        let view = CameraPreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        if let connection = view.previewLayer.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: CameraPreviewView, context: Context) {
        uiView.previewLayer.session = session
    }
}

private struct ScannerCutoutMask: View {
    let cutout: CGRect

    var body: some View {
        Color.black.opacity(0.62)
            .mask {
                ZStack {
                    Rectangle().fill(.white)
                    RoundedRectangle(cornerRadius: 36, style: .continuous)
                        .frame(width: cutout.width, height: cutout.height)
                        .position(x: cutout.midX, y: cutout.midY)
                        .blendMode(.destinationOut)
                }
                .compositingGroup()
            }
            .ignoresSafeArea()
    }
}

@MainActor
struct ScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var scanner = ScannerController()
    @State private var torchOn = false
    @State private var errorText: String?
    @State private var sweep = false
    let onScan: (PairingPayload) -> Void

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width * 0.74, 310)
            let cutout = CGRect(
                x: (proxy.size.width - side) / 2,
                y: proxy.size.height * 0.24,
                width: side,
                height: side
            )
            ZStack {
                Color.black.ignoresSafeArea()
                CameraPreview(session: scanner.session)
                    .ignoresSafeArea()

                ScannerCutoutMask(cutout: cutout)

                RoundedRectangle(cornerRadius: 36, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [DshColor.accent.opacity(0.9), DshColor.accent2.opacity(0.55), Color.white.opacity(0.25)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 2
                    )
                    .frame(width: side, height: side)
                    .position(x: cutout.midX, y: cutout.midY)
                    .shadow(color: DshColor.accent.opacity(0.45), radius: 16)

                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [.clear, DshColor.accent2.opacity(0.85), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: side - 20, height: 2)
                    .shadow(color: DshColor.accent2.opacity(0.8), radius: 8)
                    .position(
                        x: cutout.midX,
                        y: sweep ? cutout.maxY - 22 : cutout.minY + 22
                    )
                    .animation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true), value: sweep)

                VStack(spacing: 0) {
                    HStack {
                        Button {
                            Haptics.impact()
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .buttonStyle(RoundIconButtonStyle(size: 42))

                        Spacer()

                        Text("扫描配对二维码")
                            .font(.system(size: 15, weight: .semibold))

                        Spacer()

                        Button {
                            Haptics.impact()
                            torchOn.toggle()
                            scanner.toggleTorch()
                        } label: {
                            Image(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                        }
                        .buttonStyle(RoundIconButtonStyle(size: 42))
                        .disabled(!scanner.torchAvailable)
                        .opacity(scanner.torchAvailable ? 1 : 0.4)
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 8)

                    Spacer()

                    VStack(spacing: 12) {
                        Text(errorText ?? scanner.errorMessage ?? "把电脑上的二维码放进框内")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(errorText == nil ? Color.white.opacity(0.72) : DshColor.yellow)
                            .multilineTextAlignment(.center)
                        HStack(spacing: 6) {
                            Image(systemName: "lock.shield")
                            Text("只在本机局域网内配对")
                        }
                        .font(.system(size: 10.5))
                        .foregroundStyle(Color.white.opacity(0.42))
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 26)
                }

                if scanner.permission == .denied {
                    VStack(spacing: 14) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(DshColor.accent2)
                        Text("需要相机权限")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                        Text("请在系统设置中允许 dsh-mobile 使用相机，然后重新打开扫码。")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("打开系统设置") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle(minHeight: 46))
                        .padding(.top, 4)
                    }
                    .padding(24)
                    .frame(maxWidth: 300)
                    .glassCard(radius: 28)
                    .padding(28)
                }
            }
        }
        .statusBarHidden(true)
        .onAppear {
            sweep = true
            scanner.start(
                onFound: { payload in
                    onScan(payload)
                },
                onInvalid: { message in
                    errorText = message
                }
            )
        }
        .onDisappear {
            scanner.stop()
        }
    }
}
