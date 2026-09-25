# Flutter

Load when `delivery_platforms` contains `flutter`. Flutter shares UI code across iOS, Android, web and desktop; it does not remove platform lifecycle, permissions or store review. Close the [native mobile](mobile-native.md) dimensions for every shipped mobile target as well.

## Decide the implementation route

- **Targets**: list shipped targets (`ios`, `android`, `web`, `macos`, `windows`, `linux`). Each unshipped target is excluded explicitly so plugin choices are not constrained by it.
- **State management**: keep the repository's approach (Riverpod, Bloc, Provider, signals). A new project picks one and records the rejected alternative; mixing approaches per feature is a design defect.
- **Navigation**: one router (`go_router` or the repository's) with typed routes, redirect rules for authentication and deep-link handling for every external entry.
- **Platform integration**: prefer maintained federated plugins; custom code uses Pigeon-generated platform channels or `dart:ffi`. Every platform-specific capability names its implementation per target and its unsupported-target behavior.
- **Layering**: `lib/src/domain` and `lib/src/data` import no Flutter UI packages; widgets consume state objects only. Multi-package repositories use a workspace (pub workspaces or melos) with a pure Dart core package.
- **Flavors and configuration**: one flavor per environment with separate bundle/application IDs; configuration via `--dart-define-from-file`; no secrets compiled into the app.

## Design-controlling dimensions

- **Widget structure**: screens split into small `const`-constructible widgets; rebuild scope bounded by selectors; heavy work off the UI isolate (`compute`, `Isolate.run`).
- **Adaptive layout**: breakpoints as tokens; Material 3 or Cupertino adaptation per target; text scaling up to the declared maximum without overflow.
- **Theming and style hooks**: `ThemeData` with `ColorScheme`, `TextTheme` and `ThemeExtension` classes as the token set; widgets read `Theme.of(context)`, never literal colors or sizes.
- **Localization**: `gen-l10n` with ARB files, plural and gender rules, right-to-left layouts.
- **Lifecycle**: `AppLifecycleListener` or `WidgetsBindingObserver` for pause/resume; state restoration (`RestorationMixin`) for screens that must survive process death.
- **Performance**: cold start and first frame budget per target, 60 or 120 Hz frame budget on a named low-end device, app size per target measured with `--analyze-size`.
- **Dependencies**: pinned `pubspec.lock` for apps, version constraints for packages, plugin maintenance and platform support checked before adoption.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Static quality | `dart format --output=none --set-exit-if-changed .` and `flutter analyze` with the repository lint set exit 0 |
| Domain logic | `dart test` or `flutter test test/<unit>` on pure Dart code |
| Widget behavior | `flutter test` widget tests assert semantics, text and state transitions |
| Visual tokens | golden tests (`matchesGoldenFile`) for token-driven components on a pinned Flutter version and font set |
| Journeys | `flutter test integration_test/<journey>_test.dart -d <device>` on a named emulator or simulator |
| Deep links | platform launch commands from [native mobile](mobile-native.md) land on the typed route |
| Accessibility | `meetsGuideline(textContrastGuideline)`, `androidTapTargetGuideline`, `iOSTapTargetGuideline`, `labeledTapTargetGuideline` in widget tests |
| Size and performance | `flutter build appbundle --analyze-size` or `ipa` size within budget; `flutter drive --profile` timeline summary within frame budget |

Golden files are pinned to one rendering environment; regenerate them only inside the batch that owns the visual change.

## Anti-patterns

- Business logic inside `build` methods or `StatefulWidget` state.
- A plugin chosen for one target that silently breaks another shipped target.
- Hard-coded `Colors.*` and `TextStyle(fontSize: …)` in feature widgets.
- One integration test that walks the whole app instead of named journeys.
