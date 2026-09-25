# Pre-handoff review

Optional: runs on `SDD_V2_REVIEW_RECOMMENDED` or `review <SDD>`. A fresh reviewer reads the SDD and the repository before the host does, and reports what the host
would otherwise discover mid-implementation: clauses that cannot all hold, acceptance a wrong
implementation passes, and decisions the document leaves to the host. The reviewer gets the SDD
path, the repository root and this page — never the author's reasoning.

Structure is `validate`'s job; do not re-report what it checks. Report only what reading the
clauses against each other and against the code reveals.

## Lenses

**L1 Behaviour-change sweep.** For every changed behaviour (a BC, a flipped Capability Matrix cell,
a step that deletes or rewrites a branch):
- search the repository for every test and code branch that asserts the old behaviour — by the
  cited test's ID token, by the function name, by the error or value it asserts — not only the one
  the SDD cites;
- list every clause that touches the same cell (preserve acceptance, steps, failure clauses,
  compatibility notes, "other … unchanged" claims) and check each pair can hold together;
- for a deleted or rewritten branch, state which scenarios its condition separated and whether a
  preserved clause still needs that separation.

**L2 Discrimination.** For every Must-Ship acceptance — including those an earlier revision left
unchanged or marked verified, since a later revision can rely on them — try to write a plausible
wrong implementation that passes it: one that handles only the fixture's shape (one direct
dependent where the requirement says transitive), only one of the enumerated operations, an
internal path below the boundary the requirement names, or state the public surface cannot
observe. For an unchanged acceptance this is a reading check: compare its fixture with its
requirement's quantifiers, conditions and enumerations; open code only to confirm a suspicion.

**L3 Implementation dry-run.** Walk each step against the current code as if writing the diff.
Report every point where you would have to decide something the SDD does not settle, and every
place where a step, its failure clause and the acceptance disagree about the same input.

## Findings

Write one JSON file:

```json
{
  "protocol": "sdd-review-findings/v1",
  "sdd": "<absolute path>",
  "findings": [
    {
      "id": "F1",
      "lens": "L1",
      "clauses": ["BC3", "A3"],
      "evidence": [{ "path": "packages/x/test/signal.test.ts", "line": 430 }],
      "claim": "One sentence: what cannot hold, or what passes wrongly, and why."
    }
  ]
}
```

- `clauses` holds the SDD IDs involved; `evidence` holds repository-relative locations. A finding
  with neither is dropped.
- L1 and L3 report defects in the user-owned delta only; L2 covers every Must-Ship acceptance.
  Adjacent problems are not findings.
- Do not propose rewrites and do not edit any file other than the findings file.
- An empty `findings` array is a valid result.

## Disposition (author)

Each finding is closed as `fixed`, `ruled-invalid:<reason>` or `out-of-scope`, recorded in the SDD index as `"review": {"findings": "<file relative to the SDD>", "dispositions": {"F1": "fixed"}}`; `validate` reports an undisposed finding or an unknown clause as a candidate and counts dispositions per lens. A normative
fix gets one re-review of the changed clauses only; there is no second full pass.
