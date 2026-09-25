# Authoring an `sdd/v2` document

This page fills each of the six authoring phases with the practices that make a spec executable, many of them proven in GitHub's spec-kit. They are placed in phases and Metas that already exist: no new phase, Meta kind, file set or host role. Load the part for the phase you are in. The document stays one SDD; spec-kit's separate `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` and `tasks.md` become sections or derived views of it.

## 1 Harvest — facts and principles

- Start a new document with `init` ([presets and init](v2-presets.md)): the skeleton carries the repository preset's principles and sections and waits on `D1` until you replace it.

- Classify every fact as `USER_STATED`, `OBSERVED` (with its `path:line` or command), `INFERRED` or `ASSUMED`. Only the first two become normative. An inferred fact that decides owner, route or acceptance needs a check. A material assumption becomes an open decision (Admit), never a silent requirement.
- Principles: read the repository's standing rules before designing — `AGENTS.md`, contribution guides and, in a spec-kit project, `.specify/memory/constitution.md`. Name the files the design must respect in the index's `principles` array. They stay the authority; do not copy their rules into the SDD.
- A predecessor SDD cited as basis is evidence of its own day: re-verify its numeric and universal claims (counts, "all", "none") against live source before reusing them.
- For each unknown you resolve by reading or probing, keep one line: **Decision**, **Rationale**, **Alternatives considered**. This is spec-kit's `research.md`; put it in a `## Decisions` section, not a separate file.

## 2 Admit — WHAT and WHY

- Write the outcome without technology: who needs what, and why. HOW belongs to Design.
- Each **Entry** is a user story with a priority (`"priority": "P1"`, `"P2"`, …). P1 is the smallest slice that delivers value alone. Give every Entry at least one acceptance that proves it independently — an Entry that can only be observed together with another is not independent, so merge the two. The highest-priority Entries become the handoff's `mvp`.
- Success criteria are measurable and technology-agnostic ("a user completes checkout in under 3 minutes", not "the API answers in 200 ms"). Record each as an acceptance case under the Entry it proves. There is no separate ID type.
- List the edge cases and failure paths the supported scope can reach. Each one either becomes a requirement or is named as out of scope.
- **Clarify.** Mark each unresolved point in place as `[NEEDS CLARIFICATION: D1 <question>]` (or `[需澄清: D1 …]`), define `D1` in prose, and list it in `unresolved_user_decisions`. `validate` blocks a marker whose decision is not listed, and reports `AWAITING_USER` while any decision is open. Ask at most five questions in one batch. Order them by impact (scope, then security and privacy, then user experience, then technical detail), and give each question options with a recommendation. Record every answer in a `## Clarifications` log (`- YYYY-MM-DD Q: … → A: …`). Then apply it to the affected clause and remove the marker and the list entry.

## 3 Design — HOW, under the principles

- **Principle check.** When `principles` is non-empty, add a `## Principle Check` (or `## 原则检查`) section. For each principle file, say whether the design complies. For any deviation, give the justification and the simpler alternative that was rejected: spec-kit's Complexity Tracking. Trade off in this order: usability and implementability, then measured performance, then feature breadth, then test machinery, and optional hardening last. Add abstraction, configuration or defensive machinery only for a current requirement or a demonstrated failure.
- **Key entities**, when data is involved: fields, relationships, validation rules and state transitions, in one `## Key Entities` section (spec-kit's `data-model.md`). If an entity file is delivered, it is an Asset.
- **Interfaces.** For every export, give its schema or signature location in prose (for example an OpenAPI file, a `.proto` or a TypeScript fence). The export's Asset is that file (spec-kit's `contracts/`). Consumers pin the exact version. When other documents rely on an export's behaviour, list those clauses in its `semantics`: consumers then pin its fingerprint and cite the clauses in `relies_on`, and write their own acceptance as this document's effects of each producer outcome, never as a second statement of the producer's rule. Delegating an existing surface to an import is a behaviour change until shown otherwise: declare the delegation with a delta per imported rule and a disposition per imported error, register every non-identical delta as a BC, and keep any "same as the previous revision" claim's exception list in step with it.
- Readers are not only symbol references. A step that rewrites error messages or replaces a class's construction form breaks tests that assert the old text and code that reaches the class through `Name.prototype`, `extends Name` or `instanceof Name`; `validate` lists such undeclared readers as `SDD_V2_ERROR_TEXT_READER_UNDECLARED` and `SDD_V2_SHAPE_READER_UNDECLARED` candidates. Name each reader in the prose (or read it in the Bundle) and decide its update. For a new guard that runs before downstream code, ask which downstream error contract now competes for the same call.
- Read each step's failure and state claims back against its own pseudocode: a branch the prose describes must be reachable in the code beneath it.
- Steps name their inputs, outputs and the file paths they touch, so a host can work without inventing locations. Every call in a step's prose or pseudocode (including a step defined in a `step_sources` document) must be declared in the source the leaf writes or reads, or in the SDD itself; `validate` lists the rest as `PSEUDOCODE_SYMBOL_UNRESOLVED` candidates. When a step creates a function, declare it in the step's pseudocode (`function loadGreeting(locale)`) so the candidate means "missing", not "new".

## 4 Verify — observable acceptance

- Name the executable check that decides each case in `oracles`: a test file that names the case ID (`{"A1": "packages/a/a1.test.ts"}`), or, for a build or CLI result, a bounded command — one package script and one observable, `{"A2": {"script": "build", "exists": "dist/index.js"}}` or `{"script": "cli:help", "stdout": "Usage:"}`. At convergence the host's command must run that oracle; for a command oracle it must be exactly the derived script command (`bun run build`, by lockfile) and the row records what was `observed`.
- An oracle must be able to fail: if the observation holds before the change and would still hold with the change reverted, it proves nothing (convergence's behaviour proof asks for exactly this failing baseline). The exception is a must-ship property the change must keep, true before and after by design (golden equivalence, a refactor's unchanged output, a non-regression gate): list it in `preserve`. Its evidence is two PASS rows of the same command, base and change, never a manufactured failure (`ACCEPTANCE_BASELINE_UNFALSIFIABLE` flags an unmarked golden or before/after case). An oracle that names a function must test a fact the design actually routes to that function.
- Compare acceptance cases with each other: two cases that constrain the same subject or suite with opposite expectations are a contradiction to resolve before implementation, not during it.
- Write each acceptance case as **Given / When / Then**, or as `command → expected observation`. It must fail when its requirement is absent: a case that would pass against the old code proves nothing.
- The integration or end-to-end acceptance is the quickstart: the shortest runnable walk through the P1 Entries (spec-kit's `quickstart.md`). In a program it is the root's `## Integration Acceptance`.
- Before calling the requirements ready, review them as a checklist. For each requirement, check that it is complete, unambiguous, consistent, measurable and covered by acceptance. Also check that no vague adjective ("fast", "robust", "intuitive") remains without a number. This review tests the writing, not the implementation; it runs no code.
- A document that declares exported TypeScript in fences may run `type-probe.ts check` to catch degenerate public types before implementation.
- Coverage is per outcome, not per requirement. Advisory candidates (a preset may promote them) flag the gaps that let a structurally ready document ship broken:
  - every error code or quoted status a requirement names appears in a linked acceptance (`REQUIREMENT_OUTCOME_UNCOVERED`), and says whether it is top-level or on the `cause` chain (`ERROR_POSITION_UNSTATED`);
  - "all / every / transitive" needs a fixture of at least two elements or a two-level chain (`QUANTIFIER_FIXTURE_UNDISCRIMINATING`);
  - a state guard (a named operation that rejects, refuses or throws a code) or a signature migration declares an `inventories` entry with `kind` `invariant`/`surface` and at least one entry point — an empty shell does not count — and each entry point maps to acceptance or an exemption (`INVARIANT_INVENTORY_MISSING`, `INVENTORY_ENTRY_UNCOVERED`); a surface inventory lists every owned declaration site (`SURFACE_INVENTORY_INCOMPLETE`);
  - an oracle for a requirement that names a boundary (host, public API, CLI, outlet) drives that boundary or a published subpath, not an internal module; test-support modules (observers, helpers, fixtures) are exempt (`ORACLE_BELOW_BOUNDARY`); an acceptance asserts only what the declared interface can read, never a member its fence keeps private (`#field`, `private`) (`ACCEPTANCE_SUBJECT_UNOBSERVABLE`);
  - every lifecycle, failure and concurrency clause cites the acceptance or requirement that decides it, or says `deferred`/`non-testable` (`FAILURE_CLAUSE_UNBOUND`); every principle-check claim names the clauses it constrains (`PRINCIPLE_CHECK_UNBOUND`), and no clause prescribes setting `cause` on an existing error (`CAUSE_OVERWRITE_PRESCRIBED`);
  - scope, not only IDs: a must-ship requirement over "every/each/all" of listed operations names each operation in an acceptance or inventory entry point (`ENUMERATED_OPERATION_UNCOVERED`); a new or changed `…Status`/`…State`/`…Phase` vocabulary of three or more values has a `## State Combinations` table (existing axes × new state → reachable, projection, each rule's behaviour) (`STATE_SPACE_UNSTATED`); a requirement over three or more modes, platforms or variants has a `## Capability Matrix` (variant × capability → supported, source; ask about inferred or changed cells) (`VARIANT_MATRIX_MISSING`); a "same as R<n>" claim is pinned by a `preserved-branch` inventory listing each branch of the replaced code as `path:line` at the base with the acceptance that keeps it (`PRESERVATION_UNPINNED`); a must-ship scaling outcome ("proportional to", "linear", `O(n)`) is measured on the public operation end to end at two or more sizes, not only by a subsystem counter, and a `cost-path` inventory lists the whole-collection work (copies, scans, rebuilds) on that operation (`SCALING_ORACLE_UNSCOPED`);
  - negative searches use owner-qualified tokens (`NEGATIVE_SEARCH_GENERIC_TOKEN`); a dirty-worktree delivery proves files with the working tree, not `git ls-files` (`INDEX_ORACLE_DIRTY_TREE`); test migrations carry a rename map, not counts (`COUNT_ONLY_PRESERVATION`), and a test file promised unchanged ("assertions unchanged", "断言不变") does not assert an export the leaf removes unless that line states an export-assertion rule (`REMOVED_EXPORT_ASSERTED_UNCHANGED`); a temporary environment runs through a checked script (`ORACLE_PROCEDURE_UNSCRIPTED`); a recursive repository gate states which failures it can block (`REPO_GATE_NO_DISPOSITION`); a budget or custody gate states its feasibility and baseline-update owner (`BUDGET_GATE_UNOWNED`).

## 5 Decompose — tasks as a derived view

- An acceptance must be able to pass when its closing steps finish: if it names a path or symbol only a later step produces, `validate` reports `SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY`; move the case, the step or the batch order.
- Chunks (batches) group the steps of one coherent change. Order them so the P1 Entries' Chunks can finish first, and declare real `depends_on` edges.
- Each step is a task. Write it as a record when the host needs more than its prose: `{"id": "S2", "touches": ["packages/a/api.ts"], "after": ["S1"], "closes": ["A1"]}`. `touches` must lie inside `writes`; `after` names steps in the same leaf, and an `after` that crosses batches needs a matching batch `depends_on`; `closes` names the acceptance the step completes. A bare string ID stays valid.
- Do not write a tasks.md or parallel markers. The handoff derives them:
  - `tasks`: steps ordered by batch waves, then Entry priority, then `after`. Each task carries its Chunk, Entries, touches (marked `existing` or `new`), closes and `parallel_with` (tasks with no order between them and disjoint touches).
  - `mvp_tasks`: the smallest ordered set that closes every acceptance of the MVP Entries — the first checkpoint.
  - `waves` (Chunk layers) and, for a program root, `parallel_children` (child layers; child write boundaries are already conflict-checked).
- Keep one SDD unless an independently deliverable outcome with its own owner makes a child narrow the context a host must read ([multi-SDD](v2-program.md)).

## 6 Report — analyze, hand off, converge

- Run `validate` once. Then analyze semantically what structure cannot see:
  - duplicated requirements
  - ambiguous or unmeasurable wording
  - underspecified steps
  - conflicts with the principles
  - requirements or Entries without acceptance
  - terminology or ordering inconsistencies

  Fix what is in scope; report the rest as limits.
- In Plan Mode, output the complete proposed SDD through `validate-draft`, never a short plan instead. When the host's own plan mode asks for a plan file, that file carries the full draft `validate-draft` accepted.
- Converge: the host writes an evidence report outside the SDD and `validate --evidence <report>` compares it with the leaf:

  ```json
  { "protocol": "sdd-evidence/v1", "sdd": "feature-a", "revision": "1",
    "results": [{ "acceptance": "A1", "status": "PASS", "evidence": "reports/a1.log" }] }
  ```

  Report each acceptance once: a repeated ID blocks the closure whatever the order, because a FAIL followed by a PASS must not close by position.

  **Behaviour proof.** A PASS only shows the check passed, not that it could fail. Add the failing baseline of the same check: `"command": "bun test a1", "commit": "<change sha>", "baseline": {"status": "FAIL", "evidence": "reports/a1-before.log", "commit": "<base sha>"}`. `closure.proof` rates each PASS `verified` (both commits exist and the baseline is an ancestor, checked with read-only git), `claimed` (the pair without commits) or `none`; `behaviour_proven` says whether every must-ship case has at least a claimed proof. For an `intent: bug` leaf, every `regression` case needs one, or the closure stays `OPEN`. A `preserve` case instead needs `"baseline": {"status": "PASS", …}`, skips the causal diff and the replay ablation, and counts toward `behaviour_proven`; a PASS baseline on an unlisted case, or a FAIL baseline on a listed one, keeps the closure `OPEN` (`baseline-class-mismatch`). When three or more must-ship cases share one baseline failure (the base did not build), that failure shows nothing about each case: each row needs its own `"perturbation": {"status": "FAIL", "evidence": "…"}` (the oracle failing with its feature removed; make that removal in a disposable `git worktree`, never in the shared tree, and name the worktree or patch in `evidence`) or a proven `--replay`, else it is `claimed` and the closure stays `OPEN` (`baseline-shared`). A test title the change removes or renames needs `title_dispositions` (`{"test/a.test.ts": {"old title": "replaced-by:<new title>" | "superseded-by:BC<n>" | "obsolete-with:<reason>"}}`), else `test-title-removed` keeps the closure `OPEN`.

  **Requirement link.** Convergence asks whether each PASS came from the requirement:
  - every must-ship case needs a declared oracle, the host's command must run it, and the oracle must name the case;
  - a `verified` proof is downgraded unless the change between the two commits touches the files of the steps that close the case (or its Assets);
  - a `regression` case closes only on such a verified, causal proof; a claimed pair without commits is not enough.

  **Replay (`--replay`).** The validator then runs the declared oracle itself, never the host's command: it derives the runner from the oracle's type and the repository's tooling (`bun test`, `vitest`, `jest`, `pytest`, `go test`) and runs it in trees exported read-only with `git archive` — at the baseline (must FAIL), at the change (must PASS), and at the change with the implementing files put back to their baseline content (must FAIL). Each run starts in the oracle's own package (the nearest `package.json`), with the repository's root and package `node_modules` linked into the exported tree, as the host ran it. If the oracle does not pass at the change there, the replay is `environment-failed` (missing dependency, config or generated file), not `not-proven`. The last run is the ablation, and it must remove this requirement and nothing else. When the host commits each step separately with its step ID in the message (`S2: add farewell`, or `planner/S2` when sibling SDDs share one commit range), only the commits naming the case's steps and changing this leaf's `writes` are reverted (the oracle's own changes kept); a sibling's `S2`, or `pipeline/S2`, is never taken for this leaf's. A commit that also names another case's step, or one that cannot be reverted on its own, makes the replay `not-proven`. Without such commits the implementing files are reverted whole (`granularity: file`), but only when every other step declares its `touches` and none shares those files; otherwise the replay is `not-proven`, because removing a shared file would also remove another requirement's code and a wrong oracle could fail for the wrong reason. The ablation: an oracle that still passes without the implementation does not verify the requirement, and the closure stays `OPEN` (`replay-not-proven`). `behaviour_proven` is true only when every must-ship case has a linked oracle, a verified causal proof and, with `--replay`, a proven replay.

  **Design gap.** Like spec-kit's converge, closure compares the delivered code with the design, at the reported change commit when the rows name one: an Asset missing, a step's touched file missing (unless the change deleted it), a step call the code does not declare, or a must-ship requirement none of whose implementing files changed between the commits. Each is a `design-gap` that keeps the closure `OPEN` until the code or the SDD (a new revision) changes.

  `closure.status` is `CLOSED` when every must-ship acceptance has a PASS with evidence at the current revision, `FAILED` when any result is FAIL, otherwise `OPEN` (missing, blocked, stale revision, or a path-like evidence that does not exist). It also reports which Entries and whether the MVP are closed. A FAIL or a changed expectation returns as a revision: bump `revision`, log a user decision under `## Clarifications`, amend in place with IDs kept, and let the host report again. The check compares IDs, revision and evidence locations; it cannot tell whether the evidence proves the behaviour.

## Bug fix — the same six phases, proving the defect

Set `"intent": "bug"` on an sdd/v2 leaf (spec-kit's bug-assess, bug-fix and bug-test):

- **Harvest:** a `## Reproduction` (or `## 复现`) section: steps, expected versus actual, version and environment. Reproduce before designing; an unreproduced report is an open decision, not a requirement.
- **Admit:** one Entry for the broken user outcome; severity and what is out of scope.
- **Design:** a `## Root Cause` (or `## 根因`) section naming the cause, not the symptom, and the smallest fix at that cause.
- **Verify:** list in `regression` the acceptance cases that fail before the fix and pass after it. A regression case that would pass on the broken code proves nothing.
- **Decompose / Report:** usually one Chunk; converge with `--evidence` like any leaf.

## Assessment — deciding before specifying

An idea that is not yet worth an SDD gets an assessment: a document whose `sdd-contract` block uses `"protocol": "sdd-assessment/v1"` (spec-kit's intake, research, define, shape and decide). It targets no implementation, so it has no steps or writes:

- **Harvest:** `## Intake` (who asks, why now) and `## Research` (what exists, constraints, evidence).
- **Admit / Design:** `## Options`, each option defined in prose and listed in `options`, with its cost and risk.
- **Report:** `## Decision` and `"decision": {"outcome": "go" | "no-go" | "reshape" | "open", "option": "O1"}`. A `go` names an option and seeds prioritized `proposed_entries`.

`validate` reports `READY_FOR_SDD` (go), `CLOSED` (no-go) or `AWAITING_USER` (open, reshape or pending decisions). The follow-up sdd/v2 cites the file in `assessment`, starts its Entries from the seeds with the same IDs and priorities, and is blocked if the cited assessment is not a `go`.

## Five Metas and spec-kit

| Meta | Carries | spec-kit counterpart |
| --- | --- | --- |
| Entry | A user story with priority and independent acceptance | User story (P1, P2, …), MVP |
| Module | One functional requirement at its normative source | `FR-###` in `spec.md` |
| Chunk | One coherent batch of steps inside a story's work | A phase of `tasks.md` |
| (step) | One task: touches, after, closes; ordered and parallelized by the handoff | A task line with `[P]` |
| Bundle | One executable SDD and its reads and required Assets | One feature (`specs/###-name/`) |
| Asset | A versioned delivered file: interface, schema, entity model or code | `contracts/`, `data-model.md`, source |
