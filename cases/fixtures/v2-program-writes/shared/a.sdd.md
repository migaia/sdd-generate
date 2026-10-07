# Child a

## Requirements

- R1 Child a edits the shared package.

## Batches

- C1 Edit the package.

## Steps

- S1 Edit `packages/shared/index.ts`.

## Acceptance

- A1 Given the package builds, when child a's change runs, then it prints `a`.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "a",
  "revision": "1",
  "root": "root.sdd.md",
  "requirements": [{ "id": "R1", "kind": "must-ship", "implementation": ["S1"], "acceptance": ["A1"] }],
  "batches": [{ "id": "C1", "steps": ["S1"], "requirements": ["R1"], "depends_on": [] }],
  "steps": ["S1"],
  "acceptance": ["A1"],
  "writes": ["packages/shared"],
  "shared_writes": ["packages/shared"],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
