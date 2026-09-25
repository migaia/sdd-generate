# HarmonyOS with ArkTS

Load when `delivery_platforms` contains `harmonyos`. APIs and decorators evolve by API level: record the target and compatible API level from `build-profile.json5`, and cite the current official documentation for each API the design depends on.

## Decide the implementation route

- **Application model**: the Stage model. `UIAbility` components own windows and lifecycle; `AbilityStage` owns module-level initialization; `ExtensionAbility` types cover forms (service widgets), background work and sharing.
- **Module types**: `entry` HAP for the main app, `feature` HAPs for installable features, HAR for static shared libraries, HSP for shared dynamic packages loaded at runtime. Choose per module and record the reason; shared code used by several HAPs belongs in HAR or HSP, never copied.
- **UI**: declarative ArkUI with `@Entry` and `@Component` (or `@ComponentV2`) structs. Choose one state management generation per module: V1 decorators (`@State`, `@Prop`, `@Link`, `@Provide`/`@Consume`, `@Observed`/`@ObjectLink`, `@StorageLink`) or V2 (`@ObservedV2`/`@Trace`, `@Local`, `@Param`, `@Event`, `@Monitor`, `@Computed`). Mixing them inside one component tree needs an explicit boundary.
- **Navigation**: `Navigation` with `NavDestination` and a navigation stack for new work; the older `router` only where the repository already uses it.
- **Atomic services**: if the product ships as an atomic service (元服务), close its package size, installation-free entry and service card constraints separately.

## ArkTS language constraints

ArkTS is stricter than TypeScript. Design types that compile under it:

- no `any` or `unknown`, no structural typing for class instances, no runtime addition or deletion of object properties, no index signatures for dynamic objects, no `var`, no destructuring assignment in unsupported positions;
- object literals need declared class or interface types; JSON parsing results are mapped into declared classes;
- concurrency uses `TaskPool` or `Worker` with sendable data, not shared mutable objects.

Third-party TypeScript or JavaScript libraries are admitted only when their ohpm package or source compiles under ArkTS rules; record that evidence.

## Design-controlling dimensions

- **Lifecycle**: `UIAbility` `onCreate/onWindowStageCreate/onForeground/onBackground/onWindowStageDestroy/onDestroy`; page `aboutToAppear/onPageShow/onPageHide/aboutToDisappear`. Name what state is persisted (`Preferences`, relational store, `PersistentStorage`) before background termination.
- **Permissions**: declared in `module.json5` `requestPermissions` with `reason` and `usedScene`; `user_grant` permissions requested at use time via `abilityAccessCtrl` with a denied path and a route to settings.
- **Multi-device adaptation**: breakpoints (`BreakpointSystem`, `GridRow`/`GridCol`) and one-development-multi-device layouts for phone, foldable and tablet when in scope.
- **Style hooks**: resources in `resources/base/element` (`color.json`, `float.json`, `string.json`) with dark-mode qualifiers under `resources/dark`; components reference `$r('app.color.*')` tokens, never literal values.
- **Data and network**: `@kit.NetworkKit` HTTP with declared `ohos.permission.INTERNET`; relational store or KV store with a migration version; distributed data only with an explicit consistency rule.
- **Distribution**: signing profiles and certificates via AppGallery Connect, `app.json5` bundle name and version code policy, review requirements for the declared category.
- **Performance**: cold start budget, `LazyForEach` with a data source for long lists, component reuse (`@Reusable`), and frame rate on a named device.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Build | `hvigorw assembleHap --mode module -p product=default` (or the repository's build task) exits 0 with ArkTS compile errors as failures |
| Static rules | `codelinter` with the repository rule set exits 0 |
| Unit logic | Hypium unit tests in `ohosTest` (`describe`/`it`/`expect`) run through the project's test task on a named emulator or device |
| UI journey | `@kit.TestKit` UiTest (`Driver`, `ON.id`) drives the named journey and asserts component state |
| Permissions | the denied state is asserted after revoking the permission on the test device |
| Adaptation | the same UI test passes at phone and tablet breakpoints when both are in scope |
| Package size | the built HAP/HSP sizes are within the declared budget |

Record device type, API level and image for every case; emulator and real-device differences for sensors, payments and push are declared, not assumed.

## Anti-patterns

- Porting web TypeScript models that rely on `any`, dynamic properties or structural typing.
- Mixing V1 and V2 state decorators in one component tree without a boundary.
- Requesting all permissions in `onCreate`.
- Literal colors and sizes in components instead of resource tokens.
