# R3 program

- E1 Plugins resume correctly after a generation change.

## Shared Constraints

None

## Integration Acceptance

- A-total The host run passes host A6 end to end.

<!-- sdd-program:start -->
```json
{
  "protocol": "sdd-program/v2",
  "id": "r3",
  "revision": "1",
  "children": [
    {
      "id": "capability",
      "sdd": "capability.sdd.md",
      "depends_on": []
    },
    {
      "id": "host",
      "sdd": "host.sdd.md",
      "depends_on": [
        "capability"
      ]
    }
  ],
  "metas": [
    {
      "id": "E1",
      "kind": "Entry",
      "members": [
        "M-cap",
        "M-host"
      ]
    },
    {
      "id": "M-cap",
      "kind": "Module",
      "owner": "capability",
      "source_id": "R9",
      "origin": {
        "document": "capability.sdd.md",
        "requirement_id": "R9"
      }
    },
    {
      "id": "K-cap",
      "kind": "Chunk",
      "owner": "capability",
      "source_id": "C9",
      "members": [
        "M-cap"
      ]
    },
    {
      "id": "B-cap",
      "kind": "Bundle",
      "owner": "capability",
      "members": [
        "K-cap"
      ],
      "requires": []
    },
    {
      "id": "T-cap",
      "kind": "Asset",
      "producer": "B-cap",
      "path": "packages/capability/planner.ts",
      "version": "1",
      "acceptance": [
        "A9"
      ]
    },
    {
      "id": "M-host",
      "kind": "Module",
      "owner": "host",
      "source_id": "R1",
      "origin": {
        "document": "host.sdd.md",
        "requirement_id": "R1"
      }
    },
    {
      "id": "K-host",
      "kind": "Chunk",
      "owner": "host",
      "source_id": "C1",
      "members": [
        "M-host"
      ]
    },
    {
      "id": "B-host",
      "kind": "Bundle",
      "owner": "host",
      "members": [
        "K-host"
      ],
      "requires": [
        "T-cap"
      ]
    }
  ],
  "integration": {
    "owner": "host",
    "implementation": [
      "S-int"
    ],
    "acceptance": [
      "A-total"
    ]
  },
  "relies_on": {
    "A-total": [
      {
        "document": "host",
        "acceptance": "A6"
      }
    ]
  },
  "unresolved_user_decisions": []
}
```
<!-- sdd-program:end -->
