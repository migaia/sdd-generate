# Observed defects — the RSI intake queue

Record here, as `## OD-<n> <title>`, any defect a real authoring or delivery run found that this
skill's checks missed: what was observed, the evidence, why the checks missed it, and what a
detector would need. The file is a queue, not a history. Each update works it through
`rsi.ts update`: inside a round, `rsi.ts settle --id OD-<n> --as detector|ruling|rejected
--evidence <text>` decides every entry (a detector names the frozen case that pins it), and `close`
archives each settled entry's text into `rsi/rounds/<round>.json` and removes it here. After an
update this file holds only this header; anything below it is waiting to be settled.
