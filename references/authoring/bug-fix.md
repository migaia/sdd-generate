# Bug fix — the same six phases, proving the defect

Set `"intent": "bug"` on an sdd/v2 leaf (spec-kit's bug-assess, bug-fix and bug-test):

- **Harvest:** a `## Reproduction` (or `## 复现`) section: steps, expected versus actual, version and environment. Reproduce before designing; an unreproduced report is an open decision, not a requirement.
- **Admit:** one Entry for the broken user outcome; severity and what is out of scope.
- **Design:** a `## Root Cause` (or `## 根因`) section naming the cause, not the symptom, and the smallest fix at that cause. A cause drawn from a measured series classifies each change as a step or a sustained trend (changepoint or piecewise fit, never one linear fit), excludes windows the diagnostic tools perturbed (snapshots, forced GC, profilers), and ends in one verdict with its confidence; `UNVERIFIED` only when the data cannot separate the hypotheses, naming the experiment that would.
- **Verify:** list in `regression` the acceptance cases that fail before the fix and pass after it. A regression case that would pass on the broken code proves nothing. A recorded defect or risk with a measured reproduction (a procedure and its numbers) closes only when that same procedure is a `regression` case that now passes; a related, weaker acceptance does not close it.
- **Decompose / Report:** usually one Chunk; converge with `--evidence` like any leaf.
