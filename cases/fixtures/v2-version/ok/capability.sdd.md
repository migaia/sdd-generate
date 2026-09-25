# Capability planner

- R9 `planResume` gives `rebind` to a direct dependent that can rebind, `restart` only to dependents of a restarted node, and `resume` to every other resumable node.
- C9 Planner batch.
- S9 Implement the planner.
- A9 For p ← a ← b with a able to rebind, the plan is a: rebind, b: resume.
- dependency-planner The planning API in packages/capability/planner.ts.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "capability",
  "revision": "4",
  "root": "root.sdd.md",
  "requirements": [
    {
      "id": "R9",
      "kind": "must-ship",
      "implementation": [
        "S9"
      ],
      "acceptance": [
        "A9"
      ]
    }
  ],
  "inventories": [
    {
      "id": "I9",
      "requirement": "R9",
      "kind": "invariant",
      "statement": "Every resume action planResume assigns.",
      "entry_points": [
        { "name": "planResume", "path": "packages/capability/planner.ts", "acceptance": ["A9"] },
        { "name": "restart", "exempt": "the fixture graph has no restarted node" }
      ]
    }
  ],
  "batches": [
    {
      "id": "C9",
      "steps": [
        "S9"
      ],
      "requirements": [
        "R9"
      ],
      "depends_on": []
    }
  ],
  "steps": [
    "S9"
  ],
  "acceptance": [
    "A9"
  ],
  "writes": [
    "packages/capability"
  ],
  "exports": [
    {
      "id": "dependency-planner",
      "version": "1",
      "asset": "T-cap",
      "semantics": [
        "R9"
      ],
      "fingerprint": "c4524b8b69dc"
    }
  ],
  "consumes": [],
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
