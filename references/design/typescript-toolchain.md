# TypeScript toolchain selection

Load only when an in-scope TypeScript surface changes build, bundling or publication responsibility.

## Discovery trigger

- Only for in-scope packages whose production source is governed by a TypeScript toolchain, inspect actual package scripts, direct dependencies, configuration, emitted topology, publish contract, and consumer requirements. Declaration publication supports this classification only when it is generated from that TypeScript production source. Pure JavaScript, Rust, Go, and other non-TypeScript packages are excluded; mixed repositories activate this rule only for their in-scope TypeScript surfaces. A hand-authored declaration shim, TypeScript-related transitive dependency, `@types/*`, editor tooling, or an unrelated workspace package does not activate it. Distinguish direct tool ownership from a transitive lockfile dependency before naming a build tool.

## Selection in canonical design

Apply toolchain selection only when the requested outcome changes build/publication responsibility or evidence shows the existing toolchain cannot meet it; ordinary TypeScript edits do not trigger a tooling redesign. For that affected surface, first decide whether the output needs bundling at all. For an unbundled library, prefer the repository's existing TypeScript/declaration emit rather than adding a bundler. For a library that genuinely needs bundling or publication orchestration, prefer evaluating `tsdown` as the modern high-level route; for an application already on a Rolldown-backed Vite generation, keep Vite/Rolldown; for isolated parsing, transformation, minification, declaration emit, or lint responsibilities, evaluate the relevant Oxc component. Oxc alone is not a module bundler or library publication pipeline. Select esbuild only when current repository compatibility, a required plugin/API, an intentionally esbuild-defined measurement baseline, or a demonstrably smaller bounded solution makes it the best route. Do not migrate tools merely for fashion, and do not preserve esbuild merely from habit. For a non-TypeScript surface, stop applying this rule and follow that ecosystem's repository-native evidence instead.

## TypeScript toolchain selection

Activate this section only when an in-scope package's production source is compiled by a TypeScript toolchain. Generated declarations support that classification only when they come from the same TypeScript production source. Pure JavaScript and other-language projects are excluded. In a mixed monorepo, apply it only to the in-scope TypeScript-owned packages; do not pull adjacent JavaScript, Rust, Go, or other packages into the decision. A hand-authored declaration shim, lockfile TypeScript/esbuild entry, `@types/*`, editor configuration, test-only loader, or unrelated TypeScript workspace package does not activate this policy.

Do not begin with a tool name. Classify the required responsibility first:

- direct TypeScript execution is a runtime/loader concern;
- type checking is a compiler concern;
- syntax lowering, parsing, minification, linting, and isolated declaration emit are transform/toolchain concerns;
- module graph construction and chunking are bundler concerns;
- exports, formats, declarations, externalization, and packed-consumer correctness form a library-publication concern;
- dev server, HMR, assets, and production output form an application-build concern.

Prefer the smallest route that owns the complete required responsibility. If no bundle is required, keep the library unbundled and use the repository's existing TypeScript/declaration path. When a TypeScript library needs bundling or publication orchestration, evaluate `tsdown` before esbuild-based library wrappers because it provides a Rolldown/Oxc-based library boundary. For an application already using a Rolldown-backed Vite generation, preserve Vite/Rolldown rather than adding a parallel esbuild pipeline. Use Oxc components for isolated transform, minify, lint, parse, or compatible declaration responsibilities; do not describe Oxc alone as a bundler. Keep esbuild only with current evidence of a required plugin/API, compatibility constraint, intentionally esbuild-defined measurement oracle, or a materially smaller bounded implementation.

Repository-native does not mean lockfile-native. A transitive esbuild entry, historical benchmark, stale config, copied example, or previous SDD is not proof that esbuild is the current owner. Inspect direct dependencies, scripts, configuration, emitted artifacts, plugins, public exports, and consumers. A tool migration remains outside scope unless the requested observable delta requires it or the user explicitly requests modernization. Record the selected route, rejected viable route, compatibility evidence, and cheapest falsifier; benchmark only when performance is material to the decision.

When the activation condition is false, record no Oxc/tsdown/esbuild preference. Use the actual ecosystem's repository-native toolchain and evidence.
