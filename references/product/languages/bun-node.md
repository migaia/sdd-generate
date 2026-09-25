# Bun and Node projects

Load when in-scope packages run on Bun or Node.js. Build and publication responsibility for TypeScript also follows [TypeScript toolchain](../../design/typescript-toolchain.md).

## Decide the runtime contract

- **Runtime**: Bun, Node.js or both. A package consumed by Node users must not use Bun-only APIs (`Bun.file`, `Bun.spawn`, `bun:sqlite`) outside an adapter selected at runtime; a Bun application may use them freely. Record `engines` and the evidence for the minimum version.
- **Module format**: ESM (`"type": "module"`) for new packages; dual ESM/CJS only for a named consumer that requires CommonJS. The `exports` map is the public contract: every subpath, condition (`types`, `import`, `require`, `bun`, `node`) and file it points to.
- **Workspaces**: Bun or pnpm workspaces with internal packages referenced by `workspace:*`; one lockfile at the root.
- **Layering**: a core package with no HTTP framework, CLI parser or database client imports; adapters (`cli`, `server`, `worker`, `docs`) depend on it ([core and adapters](../architecture/core-adapters.md)).

## Design-controlling decisions

- **Types**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` where the repository allows; runtime validation (TypeBox, Zod, Valibot — the existing one) at every I/O boundary, with the static type derived from the schema.
- **Errors**: typed error classes or result unions in the core; adapters map them to HTTP status or exit codes; unhandled rejections crash the process deliberately and are observed.
- **Configuration**: environment parsed and validated once at startup; no `process.env` reads in the core.
- **HTTP services**: the framework already in use (Hono, Elysia, Fastify, Express); request validation, body size limits, timeouts and graceful shutdown on `SIGTERM` stated.
- **CLI**: argument parsing, exit codes, stdout for results and stderr for diagnostics, JSON output mode for automation, no prompts when stdin is not a TTY.
- **Concurrency**: async I/O by default; CPU-bound work in workers; bounded concurrency for fan-out calls.
- **Publication**: `files` allowlist, generated declarations, `sideEffects`, provenance; a packed-tarball consumer test rather than a workspace import.
- **Supply chain**: lockfile committed, install scripts reviewed, `bun audit` or `npm audit` in CI.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Lint and format | the repository's tools (oxlint/oxfmt, Biome, ESLint/Prettier) exit 0 with warnings denied |
| Types | `tsc --noEmit` (or `tsgo`) on the batch's packages exits 0 |
| Behavior | `bun test <file> -t '<name>'` or `node --test`/Vitest naming the batch's tests |
| HTTP contracts | in-process request against the app (`app.request`, `fetch` to an ephemeral port) asserting status and schema |
| CLI contracts | spawn the built CLI with arguments; assert exit code, stdout JSON and stderr diagnostics |
| Package exports | `npm pack` then install the tarball in a temporary consumer; import every `exports` subpath under each declared runtime; `publint` and `attw --pack` exit 0 for published packages |
| Runtime compatibility | the same consumer test under each declared runtime and minimum version |
| Performance claims | a benchmark script with workload, runtime version and threshold, compared with a stored baseline |

## Contract grounding probe

When a key decision depends on version, types or call shape and no applicable contract, documentation or existing consumer settles it, make one focused probe: create a temporary consumer with the exact versions and the repository's package manager, write a `.ts` file with the exact import specifiers, type imports and call combinations the SDD uses, and run `tsc --noEmit` with the repository's module resolution. A successful install or `import.meta.resolve` is not grounding. Compiling or type-checking is design evidence; running the scratch program to observe behavior is testing and follows the user's test authorization. Persist the command, exact versions, toolchain and an output excerpt in the SDD's evidence companion; a temporary directory may host the probe but is not the record.

## Anti-patterns

- Bun-only APIs leaking into a package that declares Node support.
- `exports` pointing at source files that are not in `files`.
- Business logic inside route handlers or command callbacks.
- Tests importing workspace source paths that consumers can never import.
