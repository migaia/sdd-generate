# Observed defects — the RSI intake queue

Record here, as `## OD-<n> <title>`, any defect a real authoring or delivery run found that this
skill's checks missed: what was observed, the evidence, why the checks missed it, and what a
detector would need, and one `**Class:** duplication|blast-radius|feasibility|gate-scope` line.
The class decides the settlement first: `--as class` when the class mechanism already catches it
(duplication: `SDD_V2_CONTRACT_FIELD_RESTATED`; blast-radius: `SDD_V2_PREFLIGHT_STALE`;
feasibility: `SDD_V2_PREFLIGHT_FAILED`; gate-scope: preflight `writes_outside`), a detector only for
what no mechanism can see. Success is fewer host stops per delivery (sdd-bench `stops`), not more
detectors. The file is a queue, not a history. Each update works it through `rsi.ts update`: inside
a round, `rsi.ts settle --id OD-<n> --as class|detector|lens|ruling|rejected --evidence <text>`
decides every entry (a detector names the frozen case that pins it), and `close`
archives each settled entry's text into `rsi/rounds/<round>.json` and removes it here. After an
update this file holds only this header; anything below it is waiting to be settled.
