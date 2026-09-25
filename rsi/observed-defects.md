# Observed defects — the RSI intake queue

Record here, as `## OD-<n> <title>`, any defect a real authoring or delivery run found that this
skill's checks missed: what was observed, the evidence, why the checks missed it, and what a
detector would need. The file is a queue, not a history. Each update works it through
`rsi.ts update`: inside a round, `rsi.ts settle --id OD-<n> --as detector|ruling|rejected
--evidence <text>` decides every entry (a detector names the frozen case that pins it), and `close`
archives each settled entry's text into `rsi/rounds/<round>.json` and removes it here. After an
update this file holds only this header; anything below it is waiting to be settled.

## OD-47 A prescribed algorithm's precondition was never checked against the observed code

**Observed:** migai plugin-host R3 revision 6 (2026-09-24/25). R17 prescribed "binary-search the
slot, then splice" for lane insertion and removal. The lane interleaves unowned host stages that
have no slot, so the array is not slot-sorted and binary search is invalid; a read-only survey
found it only after the SDD validated STRUCTURALLY_READY and a codex prompt had been issued.
**Evidence:** `packages/plugin-host/src/pipeline-runtime.ts:110-121` (host stages skipped in the
slot comparison), `stage-lanes.ts:80-97`; R3 Clarifications 2026-09-25.
**Why the checks missed it:** the validator checks structure and scope of requirements, not
whether a design's algorithmic premises (sortedness, uniqueness, key presence, monotonicity) hold
for the data the current code produces. Pseudocode symbols are resolved, preconditions are not.
**What a detector would need:** a design clause that prescribes an algorithm with a data
precondition (binary search, merge, dedupe-by-key, append-only order) must cite an `OBSERVED` fact
(file:line) establishing it, or declare the step that establishes it; flag prescriptive algorithm
words (二分, binary search, sorted, merge, unique) in a requirement or step without such a citation
as a candidate.

## OD-48 A cost-path inventory was accepted without checking it covers the named operations

**Observed:** same program. The R17 `cost-path` inventory listed install/publish/lane rebuild but
missed stage removal (`indexOf` over the whole lane per stage), `config.get` (copy + sort of all
registrations per read), per-run `ownersOf`, and receipt lookup; a later survey found all four.
**Evidence:** `pipeline-runtime.ts:124-130`, `config-runtime.ts:61-69`, `stage-lanes.ts:106-113`,
`composition-runtime.ts:218-219`.
**Why the checks missed it:** OD-45's detector requires a cost-path inventory to exist, not to be
complete; completeness against the operations' actual code paths is never examined.
**What a detector would need:** for each operation named by a scaling outcome, statically follow
its entry method one or two call levels into the owned source and list whole-collection patterns
(`new Map(`/`new Set(` of a field, spreads of `.values()`/`.entries()`, `.sort(`, `indexOf(`,
`.filter(` over a field, full `for…of` on a registry); any hit not named or exempted in the
inventory is a candidate.

## OD-54 A subsystem rewrite was designed without surveying the current behaviour of the paths it replaces

**Observed:** same program. R17 rewrote the plugin-host install batch and stage lane. Only a later
read-only survey found that the current code already dropped host stages registered during an
in-flight install, let a failed replace candidate delete the previous generation's lease key,
shared ownership across identical functions, reordered host stages on every rebuild, threw on runs
during a drain, and left state after failed lazy activation; three of these needed user rulings
(BC6–BC8) that the first design never asked for.
**Evidence:** plugin-host R3 revision 6 Clarifications 2026-09-25, R19, BC6–BC8.
**Why the checks missed it:** OD-42 requires pinning branches only when a "same as" claim exists;
a rewrite that states a new design without such a claim is never asked to inventory the current
behaviours (and defects) of the code it replaces.
**What a detector would need:** a requirement whose steps delete or rewrite existing modules
(steps touching files whose main symbols are listed for deletion) requires a `current-behaviour`
inventory: each observable behaviour of the replaced paths (ordering, visibility windows, failure
and rollback effects) with its disposition (`preserved:A<n>`, `BC<n>`, `defect-fixed:R<n>`).
