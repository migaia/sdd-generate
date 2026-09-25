# Desktop applications

Load when `delivery_platforms` contains `desktop`. Covers Electron, Tauri and native toolkits. Signing, notarization and store rules change: cite the current official source and date for each requirement the design depends on.

## Decide the implementation route

| Route | Choose when | Costs |
| --- | --- | --- |
| Electron (Chromium + Node.js) | a web team, identical rendering on every OS, deep Node ecosystem needs | large install and memory footprint; the app ships and must patch its own Chromium |
| Tauri 2 (system WebView + Rust core) | small binaries, a Rust or security-sensitive core, fine-grained permissions | WebView differences (WebView2, WKWebView, WebKitGTK) must be tested per OS |
| Native (SwiftUI/AppKit, WinUI/WPF, GTK/Qt) | one OS, platform-native interaction, heavy OS integration | one codebase per OS |
| Cross-platform UI (Flutter desktop, Compose Multiplatform) | UI shared with mobile | desktop conventions (menus, windows, keyboard) need explicit work |

Keep the repository's route unless a required capability is impossible in it; record the rejected route and why.

## Design-controlling dimensions

- **Process and IPC boundary**: which process owns privileged work (Electron main, Tauri Rust core), which runs UI. Every IPC message has a typed, validated schema. Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a minimal `contextBridge` preload, and a Content Security Policy. Tauri: commands exposed only through capability files that grant exactly the windows and permissions needed.
- **Application and window lifecycle**: app versus window lifetime, single-instance lock, restoring windows and unsaved work, tray or background behavior, quit versus close per OS convention.
- **OS integration**: menus and shortcuts per platform convention, file associations, custom URL schemes and deep links with their entry states, drag and drop, notifications, clipboard.
- **File system and sandbox**: user-chosen file access through native dialogs; macOS App Sandbox entitlements and security-scoped bookmarks when sandboxed; never trust paths from the UI process.
- **Distribution**: installer formats (dmg/pkg, msi/msix/NSIS, AppImage/deb/rpm/Flatpak), architectures (x64, arm64, macOS universal), code signing (Apple Developer ID plus notarization, Windows Authenticode), store submission when used.
- **Updates**: signed update artifacts, update channel, staged rollout, rollback to the previous version, behavior when an update fails midway.
- **Compatibility**: minimum OS versions from evidence, HiDPI and multiple monitors, dark mode, right-to-left layouts.
- **Security**: no remote code in privileged contexts, dependency and runtime patch cadence (Electron releases), secrets in the OS keychain or credential manager.
- **Performance**: cold start, idle memory, installer and installed size budgets on a named low-end machine.
- **Observability**: crash reporting with symbol upload, logs with user consent.

## Experience contract rules

- Routes are window or view IDs (`kind: "screen"`), dialogs and panels (`sheet`), and every external entry (file association, URL scheme, notification) as `deep-link`.
- Style hooks reuse web tokens (Electron, Tauri) or platform tokens (asset catalogs, XAML resources); menus and shortcuts are listed per OS.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Journeys (Electron) | Playwright `_electron.launch` drives the packaged app; assert window, content and IPC results |
| Journeys (Tauri) | WebDriver through `tauri-driver` on the supported OSes; Rust commands covered by `cargo test` |
| IPC security | test that the UI process cannot call an unexposed command or Node API; invalid IPC payloads are rejected |
| Signing (macOS) | `codesign --verify --deep --strict` and `spctl --assess -vv` pass; `xcrun stapler validate` confirms notarization |
| Signing (Windows) | `signtool verify /pa` passes on the installer and executable |
| Updates | install version N-1, update to N through the real update channel, relaunch; data preserved; tampered artifact rejected |
| Deep links and file associations | OS open command (`open`, `start`, `xdg-open`) lands on the declared view |
| Size and start-up | installer and installed sizes within budget; cold start timed on the named machine |

## Anti-patterns

- Enabling `nodeIntegration` or exposing a generic `invoke(anything)` bridge to the UI.
- Shipping unsigned builds or an updater that does not verify signatures.
- Designing web routes first and treating windows, menus and file associations as polish.
- One Electron major version pinned for years.
