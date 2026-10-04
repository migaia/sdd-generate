# Feature A dependency guard

Defective sdd/v2 fixture for the acceptance-quality cases (OD-15..OD-28). Each `v2-quality-od*.md`
variant changes exactly one decisive fact of this document. Delivery may run on a dirty worktree.

## Outcome
- E1 A caller removing a provider learns every dependent that blocks it.

## Requirements
- R1 Public `unUse(name)` on the host rejects with `DEPENDENCY_BLOCKED` while required dependents remain, and `blockedBy` lists all transitive dependents; dry-run edges to an absent optional provider carry `'optional-absent'`.
- R2 `use()` returns plugin handles instead of views.
- R3 Repository gates keep the migrated suites intact.

## Batches
- C1 Implement the dependency guard.

## Steps
- S1 Update `packages/feature-a/src/index.ts` with the guard.
- S2 Update `packages/feature-a/src/index.ts` so `use()` returns handles.
- S3 Rename the migrated test files.

## Acceptance
- A1 Given A←B←C, when `unUse('A')`, then it rejects with top-level `DEPENDENCY_BLOCKED`, `blockedBy` is `['C', 'B']`, and the dry-run edge for absent D carries `'optional-absent'`.
- A2 Given the positional and object `use()` overloads and the typed facade, when each installs a plugin, then each returns a handle.
- A3 `rg -n "IPluginHostView|getShared" packages/feature-a/src` produces no output.
- A4 Case counts stay equal before and after the move and the rename map lists every moved case.
- A5 `node scripts/test/public-exports.test.mjs` passes in a temporary checkout without `docs/`, created and removed by that script.
- A6 `rg --files packages/feature-a/test | rg legacy` produces no output in the working tree.

## Lifecycle and errors
- A dependency validation error is the thrown value, never wrapped in `cause` (A1).
- Removal of a blocked provider changes no state (A1).

## Gates
- `pnpm -r run test` runs every package; pre-existing failures outside the write scope are recorded as existing defects and cannot block R1–R3.
- `node scripts/coverage-custody.mjs` guards branch totals; the baseline update path for this feature's growth is owned by S1 and is feasible within scope.
- `bun bench/latency.ts` keeps the 1 MiB RPC p50 at or under 300 µs.
- Timing gates hold the shared exclusive measurement window through `node scripts/exclusive-window.mjs acquire`, which owns its heartbeat, release and the reaping of malformed or stale locks.

## Principle check
- `AGENTS.md` error contract: complies — R1 throws the dependency code itself (A1).
- `AGENTS.md` architecture-first: complies — S1 reuses the existing guard owner.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "feature-a-guard",
  "revision": "1",
  "requirements": [
    { "id": "R1", "kind": "must-ship", "implementation": ["S1"], "acceptance": ["A1"] },
    { "id": "R2", "kind": "must-ship", "implementation": ["S2"], "acceptance": ["A2"] },
    { "id": "R3", "kind": "must-ship", "implementation": ["S3"], "acceptance": ["A3", "A4", "A5", "A6"] }
  ],
  "batches": [
    { "id": "C1", "steps": ["S1", "S2", "S3"], "requirements": ["R1", "R2", "R3"], "depends_on": [] }
  ],
  "steps": ["S1", "S2", "S3"],
  "step_sources": [],
  "acceptance": ["A1", "A2", "A3", "A4", "A5", "A6"],
  "oracles": { "A1": "packages/feature-a/test/feature.test.ts" },
  "inventories": [
    {
      "id": "I1",
      "requirement": "R1",
      "kind": "invariant",
      "statement": "No provider leaves while a required dependent still serves.",
      "entry_points": [
        { "name": "unUse", "acceptance": ["A1"] },
        { "name": "managed removal", "exempt": "no managed protocol in this package" }
      ]
    },
    {
      "id": "I2",
      "requirement": "R2",
      "kind": "surface",
      "statement": "Every public construction surface returns handles.",
      "entry_points": [
        { "name": "use overloads", "path": "packages/feature-a/src/index.ts", "acceptance": ["A2"] },
        { "name": "typed facade", "path": "packages/feature-a/src/facade.ts", "acceptance": ["A2"] }
      ]
    }
  ],
  "writes": ["packages/feature-a"],
  "metas": [
    { "id": "E1", "kind": "Entry", "members": ["M1", "M2", "M3"] },
    { "id": "M1", "kind": "Module", "owner": "self", "source_id": "R1", "origin": { "document": "self", "requirement_id": "R1" } },
    { "id": "M2", "kind": "Module", "owner": "self", "source_id": "R2", "origin": { "document": "self", "requirement_id": "R2" } },
    { "id": "M3", "kind": "Module", "owner": "self", "source_id": "R3", "origin": { "document": "self", "requirement_id": "R3" } },
    { "id": "K1", "kind": "Chunk", "owner": "self", "source_id": "C1", "members": ["M1", "M2", "M3"] },
    { "id": "B1", "kind": "Bundle", "owner": "self", "members": ["K1"], "requires": [] },
    { "id": "T1", "kind": "Asset", "producer": "B1", "path": "packages/feature-a/src/index.ts", "version": "1", "acceptance": ["A1", "A2", "A3", "A4", "A5", "A6"] }
  ],
  "exports": [],
  "consumes": [],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
