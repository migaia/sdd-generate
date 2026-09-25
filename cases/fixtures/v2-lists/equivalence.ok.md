# Feature A

Minimal sdd/v2 fixture for create-sdd defect cases.

## Outcome
- E1 A caller can obtain the feature-a greeting.

## Requirements
- R1 Every `use`/`unUse`/`dryRun` call stays within the dependency-computation bound; all other behaviour is the same as revision 1 except BC1 and BC3.
  - BC1 old behaviour: `unUse` of a provider with dependents resolved silently; new behaviour: it rejects (A1).
  - BC3 old behaviour: `dryRun` returned no edges for absent providers; new behaviour: it returns `optional-absent` edges (A1).

## Batches
- C1 Implement feature A.

## Steps
- S1 Create `packages/feature-a/index.ts` exporting `featureA()`.

## Acceptance
- A1 A leaf `use`, `unUse` and `dryRun` each visit at most one index node per member; all other results match revision 1 except BC1 and BC3.

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
