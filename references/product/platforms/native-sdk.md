# Native SDKs

Load when `delivery_platforms` contains `native-sdk`: a library other developers embed in their apps, shipped as native binaries with platform bindings (Swift, Kotlin/Java, Flutter, HarmonyOS, Node.js, Python, WebAssembly). The consumers are developers; their build, runtime and review constraints are part of the product.

## Decide the implementation route

| Route | Choose when | Costs |
| --- | --- | --- |
| Shared core (C, C++ or Rust) behind a C ABI, thin bindings per platform | identical behavior on many platforms, performance or cryptography in the core | FFI design, per-platform packaging, crash symbolication |
| Binding generator (UniFFI, Djinni, SWIG, napi-rs, maturin/PyO3, ffigen, wasm-bindgen) | many bindings from one interface definition | generator limits shape the API; generated code must be reviewed |
| Separate native SDKs (Swift and Kotlin) | two platforms, platform-idiomatic APIs matter more than shared code | behavior drift; parity must be tested |

Record the interface definition that is the single source of the public API and how every binding is produced from it.

## Design-controlling dimensions

- **Public API contract**: one semantic API with idiomatic bindings (Swift `async`/`throws`, Kotlin coroutines and exceptions, Dart `Future`, JavaScript promises). The API table lists each operation with its per-binding signature.
- **ABI boundary**: `extern "C"` functions with opaque handles; no C++ classes, STL types, Rust types or exceptions across the boundary; symbols hidden by default with an explicit export list; versioned symbols or a stable function table.
- **Memory ownership**: every returned pointer names its owner and matching free function; strings and buffers have explicit length and encoding; bindings wrap handles in platform finalization (`deinit`, `Cleaner`/`AutoCloseable`, `Finalizable`).
- **Errors and panics**: error codes or error structs at the C boundary mapped to each binding's error type; panics and C++ exceptions never unwind across FFI (`catch_unwind`, `noexcept` wrappers).
- **Threading and callbacks**: thread-safety of every handle, which thread callbacks arrive on, how bindings hop to the main or UI thread, cancellation of long operations, re-entrancy rules.
- **Lifecycle and configuration**: initialization and shutdown, multiple instances, host-provided logger, network stack and storage location; no global side effects on load.
- **Packaging per platform**: iOS/macOS XCFramework via Swift Package Manager binary target; Android AAR with `.so` per ABI (`arm64-v8a`, `armeabi-v7a`, `x86_64`) aligned for 16 KB page sizes; Flutter FFI plugin; HarmonyOS HAR with NAPI `.so`; Node.js prebuilt binaries per OS/arch via N-API; Python wheels per platform tag; WebAssembly package.
- **Compatibility matrix**: minimum OS, API level, toolchain, runtime and architecture per binding; semantic versioning shared across bindings; deprecation policy.
- **Size and dependencies**: binary size budget per ABI; static-linking symbol clashes avoided (prefixed or hidden symbols); no forced transitive dependencies on host apps.
- **Privacy and review**: an iOS privacy manifest shipped inside the SDK with required-reason APIs declared; SDK signature where the platform requires it; no data collection the host app cannot disclose or disable.
- **Diagnostics**: debug symbols (dSYM, unstripped `.so`, PDB) published per release; version and build ID queryable at runtime.
- **Documentation and samples**: generated reference docs per binding and one runnable sample app per platform, built in CI against the published artifact.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Core behavior | core tests (`cargo test`, `ctest`) with AddressSanitizer or Valgrind clean for memory claims |
| Binding parity | one conformance scenario table executed through every binding, with the same results |
| ABI stability | exported symbol list (`nm -gU` / `nm -D --defined-only`) or `cargo public-api` / `abidiff` diff matches the declared change |
| Ownership and threads | stress tests creating and freeing handles from several threads under ThreadSanitizer; callbacks observed on the declared thread |
| No unwinding across FFI | a forced panic or exception in the core returns the declared error in every binding |
| Consumption | sample apps build and run against the packaged artifact: SwiftPM binary target via `xcodebuild`, Gradle consuming the AAR, `npm pack` install, `pip install` of the wheel, Flutter plugin example |
| Packaging rules | Android `.so` files report 16 KB alignment (`llvm-objdump -p` load segments) ; XCFramework contains each slice and the privacy manifest |
| Size | per-ABI binary sizes within budget |
| Symbols | release symbols uploaded; a symbolicated crash from the sample app resolves core frames |

## Anti-patterns

- C++ or Rust types in the public C header.
- Callbacks invoked on an arbitrary internal thread without documentation.
- A binding that silently differs from the others because it was hand-written later.
- Testing bindings only from inside the SDK repository instead of through the packaged artifact.
