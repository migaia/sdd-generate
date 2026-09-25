# Rust projects

Load when in-scope packages are Rust crates. Follow the repository's existing workspace, edition and lint configuration; this guide closes design decisions the repository has not yet made.

## Structure

- **Workspace**: a Cargo workspace with `resolver = "3"` (edition 2024) or the repository's resolver; shared `[workspace.package]` metadata and `[workspace.dependencies]` versions.
- **Crate split**: a library crate owns domain and use cases; binaries (`cli`, `server`, `worker`) are thin crates that parse input, call the library and render output ([core and adapters](../architecture/core-adapters.md)). Split a crate only for a real boundary: compile time, optional heavy dependencies, a published API, or a different target.
- **Visibility**: `pub` only for the intended API; `pub(crate)` inside; re-export the public surface from `lib.rs`. A published crate documents every public item.
- **MSRV**: declare `rust-version` when publishing or when a toolchain floor matters; pin the developer toolchain in `rust-toolchain.toml` when CI and local builds must match.
- **Features**: additive only; no feature that removes behavior; heavy integrations behind default-off features; test `--no-default-features` and `--all-features` when features exist.

## Design-controlling decisions

- **Errors**: libraries return typed errors (`thiserror` enums or hand-written) with variants the caller can match; binaries may aggregate with `anyhow`/`eyre` at the edge. No `unwrap`/`expect` on reachable input paths; panics only for broken invariants, documented.
- **Async**: one runtime (usually Tokio) chosen at the binary; libraries stay runtime-agnostic where practical. No blocking calls inside async tasks (`spawn_blocking` instead); cancellation safety stated for every `select!` branch that holds state.
- **Ownership at the API**: borrow in parameters (`&str`, `&[T]`, `impl AsRef<Path>`), return owned values; avoid exposing lifetimes in public types unless zero-copy is a requirement.
- **`unsafe`**: forbidden by default (`#![forbid(unsafe_code)]`); an admitted `unsafe` block names its invariant in a `// SAFETY:` comment and gets a dedicated test or Miri run.
- **Serialization and compatibility**: `serde` formats are public contracts; `#[serde(deny_unknown_fields)]` or tolerant readers decided per format; version migrations named.
- **Semver**: published crates check API compatibility with `cargo semver-checks` before release.
- **Supply chain**: `cargo deny check` (licenses, bans, advisories) or `cargo audit`; commit `Cargo.lock` for binaries and workspaces.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Formatting and lint | `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings` |
| Behavior | `cargo test -p <crate> <filter>` (or `cargo nextest run`) naming the exact tests of the batch |
| Public API examples | doc tests in `cargo test --doc -p <crate>` |
| Invariants over inputs | `proptest` or `quickcheck` properties with a fixed seed recorded on failure |
| Parsers and decoders | `cargo fuzz` target runs for a bounded time without crashes (as a design probe, not a per-batch gate) |
| Feature combinations | `cargo check -p <crate> --no-default-features` and `--all-features` |
| Performance claims | `criterion` benchmark against a stored baseline with the workload and threshold stated |
| API compatibility | `cargo semver-checks check-release -p <crate>` |
| Supply chain | `cargo deny check` exits 0 |

## Contract grounding probe

When a key decision depends on version, types or call shape and no applicable contract, documentation or existing consumer settles it, make one focused probe: create a scratch crate in a temporary directory that depends on the exact versions, write the calls and types the SDD uses with exactly the features the design enables, and run `cargo check`. Compiling or type-checking is design evidence; running the scratch program to observe behavior is testing and follows the user's test authorization. Persist the command, exact versions, toolchain and an output excerpt in the SDD's evidence companion; a temporary directory may host the probe but is not the record.

## Anti-patterns

- One giant crate where the CLI parser, HTTP server and domain share private modules.
- `Box<dyn Error>` or strings as the public error type of a library.
- `clone()` sprinkled to silence the borrow checker instead of redesigning ownership.
- Features that change behavior of existing APIs.
