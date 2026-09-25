# Delivery platforms

Load for every implementation SDD after [archetypes](archetypes.md). The archetype says what value the product delivers; the platform says where it runs and which runtime rules, review gates and toolchains bind the design. Both are decided in [harvest card](../v2-authoring.md#1-harvest--facts-and-principles) pass 1 and recorded in the contract as `product_archetype` and `delivery_platforms`.

## Classify

List every platform that ships in scope. A product that must behave the same on several platforms names one primary platform and treats the others as explicit parity requirements, not as implied ports.

| Platform | Signals | Guide |
| --- | --- | --- |
| `web` | browser routes, SSR/SSG, PWA | [experience contract](experience-contract.md), [content site](content-site.md) when content-led |
| `mini-program` | WeChat/Alipay/Douyin/Baidu/QQ mini programs, `app.json`, Taro, uni-app | [mini program](platforms/mini-program.md) |
| `ios` | Swift, SwiftUI/UIKit, Xcode project, App Store | [native mobile](platforms/mobile-native.md) |
| `android` | Kotlin, Jetpack Compose, Gradle, Play Store | [native mobile](platforms/mobile-native.md) |
| `flutter` | Dart, `pubspec.yaml`, one codebase for mobile/web/desktop | [Flutter](platforms/flutter.md) |
| `harmonyos` | ArkTS, ArkUI, `module.json5`, `oh-package.json5`, hvigor, AppGallery | [HarmonyOS ArkTS](platforms/harmonyos-arkts.md) |
| `desktop` | Electron, Tauri, SwiftUI/AppKit, WinUI/WPF, GTK/Qt | [desktop](platforms/desktop.md) |
| `native-sdk` | libraries embedded by other apps: C/C++/Rust core with Swift, Kotlin, Flutter, HarmonyOS, Node or Python bindings | [native SDK](platforms/native-sdk.md) |
| `server` | HTTP/gRPC services, workers, schedulers | the language guide and [core and adapters](architecture/core-adapters.md) |
| `cli` | command-line programs | the language guide and [core and adapters](architecture/core-adapters.md) |
| `library` | published packages consumed by other code | the language guide |

Language guides: [Rust](languages/rust.md), [Go](languages/go.md), [Python](languages/python.md), [Bun and Node](languages/bun-node.md), [JVM: Java and Kotlin](languages/jvm.md); TypeScript build responsibility also follows [TypeScript toolchain](../design/typescript-toolchain.md). Multi-surface products (one core feeding a CLI, services and documents) follow [core and adapters](architecture/core-adapters.md). Acceptance for every platform follows [acceptance standards](acceptance-standards.md).

## Dimensions every platform closes

Each dimension is `REQUIRED_AND_CLOSED` or evidenced `NOT_APPLICABLE` before the design is normative:

1. **Runtime lifecycle**: launch, foreground/background, suspension, process death or cold restart, and what state survives each. Include context changes that do not restart the process (client-side navigation, locale or account switch, tenant or configuration reload) and whether each long-lived instance is updated, rebuilt or isolated.
2. **Navigation model**: route set, page or screen stack, deep links and their entry states, back behavior, and which navigations reload the document or process versus keep runtime state.
3. **Capabilities and permissions**: every device, account or network capability, when it is requested, and the degraded path when denied.
4. **Data, offline and sync**: local persistence, cache invalidation, conflict rule, behavior without network.
5. **Identity and secrets**: login flow, token storage, which secrets never ship in the client.
6. **Distribution and review gates**: store or platform review, signing, privacy declarations, package size limits, update channel.
7. **Compatibility window**: minimum OS/runtime/SDK versions, device classes and screen sizes, and the evidence for choosing them.
8. **Performance budget**: cold start, first meaningful screen, frame rate on a named low-end device, package or binary size.
9. **Accessibility and localization**: screen reader labels, dynamic type or font scaling, contrast, locales and text expansion.
10. **Observability**: crash reporting, logs, analytics events and their privacy basis.
11. **Toolchain and CI**: exact build, lint, type and test commands the repository already uses, and the test hosts that can run them.

A dimension closes with a decision and its evidence, not with a framework name.

## Contract projection

```json
"delivery_platforms": ["mini-program", "server"]
```

`delivery_platforms` lists platform IDs from the table. UI platforms (`web`, `mini-program`, `ios`, `android`, `flutter`, `harmonyos`, `desktop`) require an `experience_contract` whose routes use the platform's navigation units: web paths, mini-program page paths (`pages/home/index`), or screen IDs for native apps with a `deep-link` route for every external entry.

## Anti-patterns

- Porting a web design to a mini program or native app without closing lifecycle, permissions and review gates.
- Choosing a cross-platform framework before listing the platform-specific capabilities the product needs.
- Declaring a minimum OS version without evidence from users, analytics or the distribution channel.
- Treating store review or package-size limits as release chores instead of design constraints.
