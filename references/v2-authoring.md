# Authoring an `sdd/v2` document

This page fills each of the six authoring phases with the practices that make a spec executable, many of them proven in GitHub's spec-kit. They are placed in phases and Metas that already exist: no new phase, Meta kind, file set or host role. Load the part for the phase you are in. The document stays one SDD; spec-kit's separate `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` and `tasks.md` become sections or derived views of it.

Each phase is one card; read only the card for the phase at hand.

| Phase or mode | Card |
| --- | --- |
| 1 Harvest — facts and principles | [harvest](authoring/harvest.md) |
| 2 Admit — WHAT and WHY | [admit](authoring/admit.md) |
| 3 Design — HOW, under the principles | [design](authoring/design.md) |
| 4 Verify — observable acceptance | [verify](authoring/verify.md) |
| 5 Decompose — tasks as a derived view | [decompose](authoring/decompose.md) |
| 6 Report — analyze, hand off | [report](authoring/report.md) |
| 6 Converge — evidence and closure | [converge](authoring/converge.md) |
| Bug fix — the same six phases, proving the defect | [bug-fix](authoring/bug-fix.md) |
| Assessment — deciding before specifying | [assessment](authoring/assessment.md) |

## Five Metas and spec-kit

| Meta | Carries | spec-kit counterpart |
| --- | --- | --- |
| Entry | A user story with priority and independent acceptance | User story (P1, P2, …), MVP |
| Module | One functional requirement at its normative source | `FR-###` in `spec.md` |
| Chunk | One coherent batch of steps inside a story's work | A phase of `tasks.md` |
| (step) | One task: touches, after, closes; ordered and parallelized by the handoff | A task line with `[P]` |
| Bundle | One executable SDD and its reads and required Assets | One feature (`specs/###-name/`) |
| Asset | A versioned delivered file: interface, schema, entity model or code | `contracts/`, `data-model.md`, source |
