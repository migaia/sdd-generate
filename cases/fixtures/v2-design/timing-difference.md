# Feature A

Minimal sdd/v2 fixture for create-sdd defect cases.

## Outcome
- E1 A caller can obtain the feature-a greeting.

## Requirements
- R1 Installing plugins with `use` costs time proportional to the affected region, not to the whole host.

## Batches
- C1 Implement feature A.

## Steps
- S1 Create `packages/feature-a/index.ts` exporting `featureA()`.

## Acceptance
- A1 After three chained `use` calls, `metrics().visits` is at most 2 per installed plugin.
- A2 Timing `use` end to end for 500 and 4000 sequential plugins, the mean time per call minus the mean time of `metrics()` grows by at most 2x.

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
        "A1",
        "A2"
      ]
    }
  ],
  "inventories": [
    {
      "id": "I1",
      "requirement": "R1",
      "kind": "cost-path",
      "statement": "Code on the use path that touches a whole collection.",
      "entry_points": [
        { "name": "snapshotBatch", "path": "packages/feature-a/index.ts", "acceptance": ["A2"] }
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
    "A1",
    "A2"
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
        "A1",
        "A2"
      ]
    }
  ],
  "exports": [],
  "consumes": [],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
