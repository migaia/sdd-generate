# Feature A

Minimal sdd/v2 fixture for create-sdd defect cases.

- Status: **verified** (program closed after the independent audit).

## Outcome
- E1 A caller can obtain the feature-a greeting.

## Requirements
- R1 Every `use`/`unUse`/`dryRun` call stays within the dependency-computation bound.

## Batches
- C1 Implement feature A.

## Steps
- S1 Create `packages/feature-a/index.ts` exporting `featureA()`.

## Acceptance
- A1 A leaf `use`, `unUse` and `dryRun` each visit at most one index node per member.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "feature-a",
  "revision": "1",
  "requirements": [
    {
      "id": "R1",
      "kind": "must-ship",
      "implementation": [
        "S1"
      ],
      "acceptance": [
        "A1"
      ]
    }
  ],
  "batches": [
    {
      "id": "C1",
      "steps": [
        "S1"
      ],
      "requirements": [
        "R1"
      ],
      "depends_on": []
    }
  ],
  "steps": [
    "S1"
  ],
  "step_sources": [],
  "acceptance": [
    "A1"
  ],
  "writes": [
    "packages/feature-a"
  ],
  "metas": [
    {
      "id": "E1",
      "kind": "Entry",
      "members": [
        "M1"
      ]
    },
    {
      "id": "M1",
      "kind": "Module",
      "owner": "self",
      "source_id": "R1",
      "origin": {
        "document": "self",
        "requirement_id": "R1"
      }
    },
    {
      "id": "K1",
      "kind": "Chunk",
      "owner": "self",
      "source_id": "C1",
      "members": [
        "M1"
      ]
    },
    {
      "id": "B1",
      "kind": "Bundle",
      "owner": "self",
      "members": [
        "K1"
      ],
      "requires": []
    },
    {
      "id": "T1",
      "kind": "Asset",
      "producer": "B1",
      "path": "packages/feature-a/index.ts",
      "version": "1",
      "acceptance": [
        "A1"
      ]
    }
  ],
  "exports": [],
  "consumes": [],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
