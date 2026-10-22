import SwiftUI
import UIKit
import WebKit

struct BridgeWebView: UIViewRepresentable {
    let profile: ServerProfile
    let reloadToken: UUID
    let onLoad: () -> Void
    let onFailure: (String) -> Void
    let onMessage: (String, [String: Any]) -> Void

    func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator(parent: self)
        coordinator.lastReloadToken = reloadToken
        return coordinator
    }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "dshMobile")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()

        let config: [String: Any] = [
            "token": profile.token,
            "serverUrl": profile.baseURL.absoluteString,
            "serverName": profile.displayName,
            "appVersion": DeviceIdentity.appVersion,
            "deviceName": DeviceIdentity.name,
            "platform": "ios"
        ]
        if let data = try? JSONSerialization.data(withJSONObject: config, options: []),
           let json = String(data: data, encoding: .utf8) {
            let source = """
            (function () {
              window.__DSH_MOBILE__ = \(json);
              window.dshMobileNative = {
                postMessage: function (message) {
                  try { window.webkit.messageHandlers.dshMobile.postMessage(message); } catch (error) {}
                }
              };
            })();
            """
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "dsh-mobile/0.1 iOS WKWebView"
        context.coordinator.webView = webView
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(white: 1, alpha: 0.55)
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.load(profile.baseURL)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.load(profile.baseURL)
        }
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "dshMobile")
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: BridgeWebView
        weak var webView: WKWebView?
        var lastReloadToken = UUID()

        init(parent: BridgeWebView) {
            self.parent = parent
        }

        func load(_ url: URL) {
            let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            webView?.load(request)
        }

        @objc func handleRefresh() {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.webView?.scrollView.refreshControl?.endRefreshing()
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "dshMobile" else { return }
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            parent.onMessage(type, body)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.onLoad()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private func failed(_ error: Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            parent.onFailure(nsError.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "about" || scheme == "data" || scheme == "blob" || scheme == "file" {
                decisionHandler(.allow)
                return
            }
            if scheme == "dshm" {
                decisionHandler(.cancel)
                return
            }
            if scheme == "http" || scheme == "https" {
                if isSameHost(url) {
                    decisionHandler(.allow)
                } else {
                    UIApplication.shared.open(url)
                    decisionHandler(.cancel)
                }
                return
            }
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        private func isSameHost(_ url: URL) -> Bool {
            guard let baseHost = parent.profile.baseURL.host else { return false }
            return url.host?.caseInsensitiveCompare(baseHost) == .orderedSame
        }

        // MARK: - WKUIDelegate

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
            present(alert, from: webView) { completionHandler() }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(true) })
            present(alert, from: webView) { completionHandler(false) }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { field in field.text = defaultText }
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
            present(alert, from: webView) { completionHandler(nil) }
        }

        private func present(_ controller: UIViewController, from webView: WKWebView, onFailure: @escaping () -> Void) {
            guard let root = webView.window?.rootViewController else {
                onFailure()
                return
            }
            var presenter = root
            while let next = presenter.presentedViewController { presenter = next }
            presenter.present(controller, animated: true, completion: nil)
        }
    }
}
