# Native mobile: iOS and Android

Load when `delivery_platforms` contains `ios` or `android`. Store policies and minimum SDK requirements change: cite the current official source and date for every version or policy number the design depends on.

## Decide the implementation route

- iOS: SwiftUI for new screens; UIKit where the repository or a required component already depends on it. Swift Package Manager for dependencies. Swift concurrency (`async`/`await`, actors) for new asynchronous code; state which types are `@MainActor`.
- Android: Kotlin with Jetpack Compose for new screens; Views only where interop requires. Gradle version catalog, one dependency injection approach (the repository's), coroutines and `Flow` for asynchrony, ViewModel plus `SavedStateHandle` for screen state.
- Shared logic across both: decide explicitly between duplicated native code, Kotlin Multiplatform shared modules, or a cross-platform UI ([Flutter](flutter.md)); record why the rejected route is worse for this product.

## Design-controlling dimensions

- **Architecture**: unidirectional data flow per screen (state, events, effects); domain and data layers without UI framework imports; repositories own caching and sync. Keep the platform UI a thin adapter over the same use cases (see [core and adapters](../architecture/core-adapters.md)).
- **Lifecycle and restoration**: iOS scene phases and state restoration; Android configuration changes and process death. Every screen names what survives rotation, backgrounding and process death, and where it is saved.
- **Navigation and deep links**: navigation graph or `NavigationStack` paths; Universal Links (`apple-app-site-association`) and Android App Links (`assetlinks.json`) with verified domains; each link's parameters, authentication requirement and fallback when content is missing.
- **Permissions**: request at the moment of use with pre-permission explanation; iOS usage description strings in `Info.plist`; Android runtime permissions and their "don't ask again" path; background location, notifications and tracking transparency as separate decisions.
- **Privacy declarations**: iOS privacy manifest (`PrivacyInfo.xcprivacy`) including required-reason APIs and third-party SDK manifests; Google Play Data safety form. Both must match what the code collects.
- **Offline and sync**: local database choice (SwiftData/Core Data/GRDB, Room), conflict rule, background refresh limits (BGTaskScheduler, WorkManager constraints).
- **Push and background work**: APNs and FCM token lifecycle, notification channels on Android, what happens when a notification opens a deleted item.
- **Compatibility**: minimum iOS version and minSdk with evidence; targetSdk meeting current Play requirements; screen classes (small phones, tablets, foldables), Dynamic Type and font scale, dark mode, right-to-left layouts.
- **Performance**: cold start budget on a named low-end device, frame pacing on scrolling screens, app size (IPA thinning, Android App Bundle), Android baseline profiles for startup-critical code.
- **Security**: tokens in Keychain or Android Keystore-backed storage, certificate handling, no secrets in the binary, obfuscation (R8) keep rules for reflection-based libraries.
- **Release**: signing and provisioning ownership, build flavors or schemes per environment, phased rollout, forced-update policy, crash reporting.

## Experience contract rules

- Routes are screen IDs (`kind: "screen"`, `tab`, `sheet`) with the navigation parent; every external entry is a `deep-link` route.
- Style hooks map to the design system: SwiftUI environment values or asset catalog colors, Compose `MaterialTheme` color, typography and shape tokens. Components read tokens only.
- States cover loading, empty, error, offline and permission-denied per screen.

## Acceptance standards

| Claim | iOS | Android |
| --- | --- | --- |
| Domain and view-model logic | `xcodebuild test` or `swift test` on a named simulator | `./gradlew testDebugUnitTest` |
| UI journey | XCUITest on a named simulator and OS | Compose UI test or Espresso via `./gradlew connectedDebugAndroidTest` on a named emulator API level |
| Deep link | `xcrun simctl openurl <device> <url>` lands on the expected screen | `adb shell am start -W -a android.intent.action.VIEW -d <url>` lands on the expected screen |
| Process death | UI test terminates and relaunches; restored state asserted | "Don't keep activities" or `adb shell am kill` then relaunch; state asserted |
| Permission denied | UI test resets privacy (`simctl privacy`) and asserts the fallback | `adb shell pm revoke` then asserts the fallback |
| Accessibility | XCUITest `performAccessibilityAudit` or accessibility identifiers and labels asserted | Compose semantics assertions; Accessibility Scanner or Espresso accessibility checks |
| Performance | XCTest metrics (`XCTApplicationLaunchMetric`) against the budget | Macrobenchmark startup timing against the budget |
| Privacy declaration | privacy report generated from the archive matches collected data | Data safety declaration reviewed against the network and SDK inventory |

Each case names device, OS version and a timeout within the loop limit; a full device-farm run is not a single acceptance case.

## Anti-patterns

- Screens that load data in view constructors without a lifecycle-aware owner.
- One shared "network manager" singleton reachable from every view.
- Permission prompts on first launch before the user sees value.
- Deep links that assume the user is signed in and the target exists.
