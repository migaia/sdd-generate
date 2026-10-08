# Greet

- R1 The greeting says hello.
- R2 The farewell says goodbye.
- C1 Greeting change.
- S1 Change the greeting and the farewell in the greet module.
- A1 Given the module, when greet runs, then it returns hello.
- A2 Given the module, when farewell runs, then it returns goodbye.

<!-- sdd-contract:start -->
```json
{
  "protocol": "sdd/v2",
  "id": "greet",
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
    },
    {
      "id": "R2",
      "kind": "must-ship",
      "implementation": [
        "S1"
      ],
      "acceptance": [
        "A2"
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
        "R1",
        "R2"
      ],
      "depends_on": []
    }
  ],
  "steps": [
    {
      "id": "S1",
      "touches": [
        "packages/greet/greet.ts"
      ],
      "closes": [
        "A1",
        "A2"
      ]
    }
  ],
  "acceptance": [
    "A1",
    "A2"
  ],
  "writes": [
    "packages/greet"
  ],
  "oracles": {
    "A1": "packages/greet/greet.test.ts",
    "A2": "packages/greet/farewell.test.ts"
  },
  "unresolved_user_decisions": []
}
```
<!-- sdd-contract:end -->
