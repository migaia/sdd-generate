# Core and adapters: core → cli | services | documents

Load when one product exposes the same capability through several surfaces (CLI, HTTP/gRPC services, workers, UI, generated documentation) or when a request adds a second surface to an existing one. The design keeps one core of rules and use cases and makes every surface a thin adapter.

## Shape

```text
            ┌──────────── adapters (driving) ────────────┐
            │  cli        services       documents   ui   │
            └──────┬─────────┬──────────────┬─────────┬───┘
                   ▼         ▼              ▼         ▼
            ┌──────────────── core ───────────────────────┐
            │ application: use cases, commands, queries    │
            │ domain: entities, value objects, rules       │
            │ ports: interfaces the core needs             │
            │ metadata: schemas, error catalog, descriptions│
            └──────────────────────┬──────────────────────┘
                                   ▼
            ┌──────────── adapters (driven) ─────────────┐
            │  storage   network clients   clock   fs     │
            └─────────────────────────────────────────────┘
```

- **Core** owns every business decision. It imports no CLI parser, HTTP framework, ORM, UI toolkit or environment reader.
- **Ports** are interfaces declared by the core in its own vocabulary (`OrderStore`, `Clock`, `Mailer`).
- **Driving adapters** translate a request into one use-case call and translate the result or typed error back: `cli` (arguments → use case → exit code and stdout), `services` (HTTP/gRPC/queue message → use case → status and body), `ui` (event → use case → state).
- **Documents adapter** renders reference documentation, OpenAPI or JSON Schema, man pages and error tables from core metadata, so docs cannot drift from behavior.
- **Driven adapters** implement ports for real infrastructure; tests use in-memory fakes of the same ports.

## Decisions the SDD must close

1. **Use-case inventory**: every capability as one use case with input type, output type and typed errors. Each CLI command, endpoint and documented operation maps to exactly one use case; list the mapping table.
2. **Error catalog**: one core error enumeration with stable codes; per adapter a mapping table (exit code, HTTP status, gRPC status, UI message key, documentation section). An unmapped error is a design defect.
3. **Metadata source**: where names, descriptions, parameter schemas and examples live in the core (for example a schema module), and which adapters consume them (CLI help, OpenAPI, docs site).
4. **Configuration and identity**: resolved at the adapter edge into typed values passed to use cases; the core never reads environment, flags or headers.
5. **Transactions and side effects**: owned by use cases through ports; adapters never open transactions.
6. **Parity rules**: which capabilities must exist on every surface, which are surface-specific, and why.
7. **Output contracts**: CLI human and machine (`--json`) output, service response schemas, and versioning policy for each.
8. **Package layout and import boundaries** per language:

| Language | Core | Adapters |
| --- | --- | --- |
| Rust | `crates/core` (lib) | `crates/cli`, `crates/server`, `crates/docs` (bins or libs) |
| Go | `internal/core/...` | `cmd/<tool>`, `internal/httpapi`, `internal/docsgen` |
| Python | `src/<pkg>/core` | `src/<pkg>/cli`, `src/<pkg>/api`, `docs/` generator |
| Bun/Node | `packages/core` | `packages/cli`, `packages/server`, `packages/docs` |
| Flutter/mobile | `packages/domain` (pure Dart/Kotlin/Swift) | app UI modules, platform plugins |

State the enforcement: a boundary script, lint rule (`depguard`, `import-linter`, `eslint-plugin-boundaries`, crate visibility) or build graph that fails when core imports an adapter.

## Delivery plan

- The core API batch (use-case signatures, error catalog, metadata schema) is the foundation wave. Adapter batches depend on it and run in parallel lanes because their write sets are disjoint.
- A behavior change lands in the core batch with its core acceptance; each adapter batch proves only its translation.
- The documents adapter batch depends on the metadata it renders and carries the drift check.
- Contract: add `architecture` beside `delivery_plan`:

```json
"architecture": {
  "protocol": "core-adapters/v1",
  "core": {"packages": ["packages/core"]},
  "adapters": [
    {"id": "AD01", "kind": "cli", "packages": ["packages/cli"]},
    {"id": "AD02", "kind": "service", "packages": ["packages/server"]},
    {"id": "AD03", "kind": "documents", "packages": ["packages/docs"]}
  ]
}
```

The loop validates that core and adapter packages are disjoint and that, when a `delivery_plan` exists, every batch writing adapter packages depends (directly or transitively) on every batch writing core packages.

## Acceptance standards

| Claim | Method and oracle |
| --- | --- |
| Dependency direction | boundary check exits non-zero on a deliberately added core → adapter import (oracle sensitivity) and zero on the real tree |
| Use-case behavior | core tests with in-memory port fakes; no adapter process started |
| Adapter translation | per adapter: valid input reaches the use case with the expected typed input; each catalog error maps to its declared exit code or status |
| Surface parity | one scenario table executed through the CLI and the service returns equivalent results |
| Documentation drift | regenerate documents from core metadata; the diff against committed documents is empty |
| Machine output | CLI `--json` and service responses validate against the schemas generated from core metadata |

## Anti-patterns

- A CLI command that calls the HTTP service of the same product to reuse logic.
- Validation rules duplicated in the CLI parser and the service handler.
- Hand-written reference docs for flags, endpoints or error codes.
- A "shared utils" package that adapters and core both import and that grows business rules.
