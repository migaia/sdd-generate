# Assessment — deciding before specifying

An idea that is not yet worth an SDD gets an assessment: a document whose `sdd-contract` block uses `"protocol": "sdd-assessment/v1"` (spec-kit's intake, research, define, shape and decide). It targets no implementation, so it has no steps or writes:

- **Harvest:** `## Intake` (who asks, why now) and `## Research` (what exists, constraints, evidence).
- **Admit / Design:** `## Options`, each option defined in prose and listed in `options`, with its cost and risk.
- **Report:** `## Decision` and `"decision": {"outcome": "go" | "no-go" | "reshape" | "open", "option": "O1"}`. A `go` names an option and seeds prioritized `proposed_entries`.

`validate` reports `READY_FOR_SDD` (go), `CLOSED` (no-go) or `AWAITING_USER` (open, reshape or pending decisions). The follow-up sdd/v2 cites the file in `assessment`, starts its Entries from the seeds with the same IDs and priorities, and is blocked if the cited assessment is not a `go`.
