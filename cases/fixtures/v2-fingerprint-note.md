# Feature A

Fixture for OD-86: a mapping table names R1 before its normative bullet.

## Clause map

| Clause | Topic | Acceptance |
| --- | --- | --- |
| R1 | the greeting clause | A1 |

## Requirements

- R1 `featureA()` returns the string `ok`. <!-- note: was layer 3 before revision 2 (K12) -->

## Batches

- C1 Implement feature A.

## Steps

- S1 Create `packages/feature-a/index.ts` exporting `featureA()`.

## Acceptance

- A1 Given the package is built, when `featureA()` is called, then it returns `ok`.

## Exports

- X1 `featureA()` in `packages/feature-a/index.ts`, version 1.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "feature-a",
  "revision": "1",
  "requirements": [{ "id": "R1", "kind": "must-ship", "implementation": ["S1"], "acceptance": ["A1"] }],
  "batches": [{ "id": "C1", "steps": ["S1"], "requirements": ["R1"], "depends_on": [] }],
  "steps": ["S1"],
  "acceptance": ["A1"],
  "exports": [{ "id": "X1", "asset": "T1", "version": "1", "semantics": ["R1"], "fingerprint": "41f3789d8a7e" }],
  "writes": ["packages/feature-a"],
  "metas": [
    { "id": "T1", "kind": "Asset", "producer": "B:self", "path": "packages/feature-a/index.ts", "version": "1", "acceptance": ["A1"] }
  ],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
