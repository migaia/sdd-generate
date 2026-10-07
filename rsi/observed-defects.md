# Observed defects — the RSI intake queue

Record here, as `## OD-<n> <title>`, any defect a real authoring or delivery run found that this
skill's checks missed: what was observed, the evidence, why the checks missed it, and one
`**Root cause:** <asset> — <mechanism>` line.

Record when, during authoring or delivery, any of these happens: a check or review passes a result
later shown wrong; a check blocks a design or implementation that is correct; the author or host
invents a marker, override, wrapper or threshold change the skill does not define, or stops because
the skill gives no path; two instructions of this skill cannot both hold. Do not record defects of
the target repository or SDD content that the checks did catch.

The root cause names the asset whose gap or wrong assumption lets this whole kind of symptom
through — a `SKILL.md`, `references/`, `scripts/` or `cases/` path (`:line` allowed) or a ledger
rule code — and why. Ask why until the answer is in this skill; a restated symptom ("validate
reported X") is not a cause, and one fix per symptom never converges. The asset is the unit RSI
converges by: when it matches a queued entry, add the evidence there instead of opening another
(`health` lists `shared_roots`). Success is fewer host stops per delivery (sdd-bench `stops`), not
more detectors.

The file is a queue, not a history. Each update works it through `rsi.ts update`: inside a round,
`rsi.ts settle --id OD-<n> --as detector|lens|ruling|rejected --evidence <text>` decides every
entry by fixing its root asset (a detector names the frozen case that pins it; only `rejected`, for
a cause outside this skill, needs no existing root asset), and `close` archives each settled entry's
text into `rsi/rounds/<round>.json` and removes it here. After an update this file holds only this
header; anything below it is waiting to be settled.
