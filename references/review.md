# Pre-handoff review

Optional: runs on `SDD_V2_REVIEW_RECOMMENDED` or `review <SDD>`. A fresh reviewer, given the SDD
path, the repository root and this page (never the author's reasoning), reports what the host would
otherwise meet mid-implementation: clauses that cannot all hold, acceptance a wrong implementation
passes, decisions left to the host. Do not re-report what `validate` checks.

## Lenses

**L1 Behaviour-change sweep.** For every changed behaviour (a BC, a flipped Capability Matrix cell,
a step that deletes or rewrites a branch):
- find every test and branch asserting the old behaviour (by test ID token, function name,
  asserted error or value), not only the one the SDD cites;
- check that every clause touching the same cell (preserve acceptance, steps, failure clauses,
  "other … unchanged" claims) can hold with it;
- for a deleted branch, state which scenarios its condition separated and whether a preserved
  clause still needs that.

**L2 Discrimination.** For every Must-Ship acceptance, including ones an earlier revision left
verified, try to write a plausible wrong implementation that passes it: one handling only the
fixture's shape (one direct dependent where the requirement says transitive), only one enumerated
operation, a path below the named boundary, or state the public surface cannot observe. For an
unchanged acceptance, compare its fixture with the requirement's quantifiers and enumerations.

**L3 Implementation dry-run.** Walk each step against the current code as if writing the diff;
report every decision the SDD leaves open and every input on which a step, its failure clause and
the acceptance disagree.

**L4 Trust boundary** (the leaf parses peer, user or file input). Every sink an input can reach
(message, `cause`, summary, log, serialized error, persisted file) is allowlist-projected, and an
acceptance plants a sentinel in every input position and asserts no sink shows it.

**L5 Stale handle** (the leaf defines replace, restart, generation or re-adopt). For each handle a
caller can hold, state what it may do after each transition and which acceptance proves the old
handle is refused rather than acting on the new state.

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

- `clauses` holds SDD IDs, `evidence` repository-relative locations; a finding with neither is
  dropped. Empty `findings` is valid.
- L2 covers every Must-Ship acceptance; the other lenses report defects in the user-owned delta
  only. Edit only the findings file; propose no rewrites.

## Disposition (author)

Close each finding as `fixed`, `ruled-invalid:<reason>` or `out-of-scope` in the SDD index:
`"review": {"findings": "<file relative to the SDD>", "dispositions": {"F1": "fixed"}}`. `validate`
reports undisposed findings and unknown clauses as candidates and counts dispositions per lens. A
normative fix gets one re-review of the changed clauses only.
