# serial program

- E1 A maintainer migrates one package in two children.

## Shared Constraints

None

<!-- sdd-program:start -->
```json
{
  "protocol": "sdd-program/v2",
  "id": "serial-program",
  "revision": "1",
  "children": [
    { "id": "a", "sdd": "a.sdd.md", "depends_on": [] },
    { "id": "b", "sdd": "b.sdd.md", "depends_on": ["a"] }
  ],
  "metas": [
    { "id": "E1", "kind": "Entry", "priority": "P1", "members": ["M:a:R1", "M:b:R1"] }
  ],
  "unresolved_user_decisions": []
}
```
<!-- sdd-program:end -->
