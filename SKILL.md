---
name: create-sdd
description: Use when the user asks to create, refactor, merge or audit a Software Design Document (SDD) for a repository or product, or to make a design implementation-ready. Not for ordinary plans, ADR/RFC comments or code-only analysis.
---

# Create SDD

Produce a design contract at the requested maturity: proposed design, document refactor, merge, document-only audit, or implementation-closure audit. Preserve user scope. Never turn a document request into source implementation, repository-wide verification or a commit unless explicitly requested.

## Mainline boundary (hard)

- The user's intent and requested deliverable are scope limits. Do not branch into unrequested features, refactors, tools, test development, coverage campaigns, benchmarks or speculative hardening. Only a demonstrated prerequisite that blocks the requested result may be handled, inside existing modification authority.
- Tests serve business outcomes and are never the deliverable unless requested. Reuse the cheapest relevant evidence; invent no test files, frameworks or acceptance obligations to satisfy generic guidance. A user prohibition on creating, editing or running tests overrides every recommendation here; state the unverified limits instead. Classify execution by what it does, not its name or location: running a program to check implementation behaviour is testing, including in a scratch consumer; type checks, builds and dependency resolution may supply design evidence within the user's authority.
- Requirements, pseudocode and acceptance cover the user-owned delta. Adjacent defects are recorded briefly, never promoted to Must-Ship.
- Inherit the global mainline hook and `AGENTS.md` restrictions. Never evade a denial through another tool, script, agent, renamed probe, policy edit or fabricated consent. If hook enforcement is unavailable, say so and keep obeying the boundary.

## Design standard

Optimize for the host that will implement the document: it should read less context, make fewer unstated decisions, follow requirements through steps to acceptance, and see the owner of every supported boundary. Keep one authority for each fact or contract. Trade off as **usability/implementability > measured performance > feature breadth > test machinery >> optional hardening**; add abstraction or defensive machinery only for a current requirement or a demonstrated failure, and justify it in the principle check ([authoring](references/v2-authoring.md)). Load [invariants](references/invariants.md) only for an audit or a real conflict; do not turn its catalog into extra document sections.

## Repository fit

Read applicable `AGENTS.md` files and repository SDD templates first. Repository conventions override this skill's default shape (a `.create-sdd/preset.json` states them mechanically: [presets](references/v2-presets.md)); preserve an existing document's language, terminology, headings and IDs unless replacement is requested. Without the repository or implementation, limit claims to supplied evidence and mark unknowns; never invent owners, paths, commands or completion evidence.

## Modes

Choose the narrowest matching mode; state the assumption when intent stays ambiguous after reading the supplied context.

| Mode | What it does | Load |
|---|---|---|
| Create or refactor | Revise in place unless replacement is requested | [writing](references/writing.md) |
| Merge | Consolidate, keeping decisions, provenance and IDs | [writing](references/writing.md), [merge](references/merge.md) |
| Document-only audit | Completeness, ownership, testability, open decisions; no implementation claims | [audit](references/audit.md) |
| Implementation or closure audit | Compare clauses with source, tests and reproducible evidence | [audit](references/audit.md), [closure evidence](references/closure-evidence.md) |
| Bug fix | `intent: bug`: reproduction, root cause, regression acceptance | [bug fix](references/v2-authoring.md#bug-fix--the-same-six-phases-proving-the-defect) |
| Assessment | Go/no-go before an SDD; a go seeds prioritized Entries | [assessment](references/v2-authoring.md#assessment--deciding-before-specifying) |
| Migration design | Close the current consumer and compatibility boundary | [migration](references/v2-migration.md) |
| Program split | Keep independently executable outcomes in narrow child contexts | [multi-SDD](references/v2-program.md) |
| Contract | Default for new implementation work | [sdd/v2](references/v2-contract.md) |
| Review | `review <SDD>`: run the pre-handoff review on a designed SDD now, whatever the recommendation | [review](references/review.md) |

## Workflow

Create, refactor and merge work runs directly in the current task. Keep six authoring phases; [authoring](references/v2-authoring.md) gives each phase's practice and [loading](references/loading.md) only relevant detail. They are a reasoning order, not six required tool calls or receipt gates.

1. **Harvest:** read the request, repository instructions, current code and interfaces. Resolve repository and output paths once; classify facts `USER_STATED | OBSERVED | INFERRED | ASSUMED` (first two normative); name principle files (`AGENTS.md`, a spec-kit constitution) in `principles`, never copy them.
2. **Admit:** settle WHAT and WHY without technology: prioritized, independently acceptable user stories as Entries, measurable success criteria and edge cases. Mark open points `[NEEDS CLARIFICATION: D1 …]` and clarify in one batch. Keep the Entry-to-Module requirement map; choose one SDD or a shallow [multi-SDD program](references/v2-program.md) from outcome, ownership, dependency and context cost.
3. **Design:** state HOW in [sdd/v2](references/v2-contract.md): normative behavior, implementation steps, producer/consumer interfaces, supported failures and one owner per change boundary. Preserve each Module's normative Source location. Read an existing target before editing it; never replace it with a fresh scaffold or discard its IDs without an explicit replacement request.
4. **Verify:** give each Must-Ship requirement an observable Given/When/Then or command acceptance case that could detect its absence, name its deciding test in `oracles`, and review requirement quality as a checklist. Resolve the acceptance-quality candidates ([authoring](references/v2-authoring.md#4-verify--observable-acceptance)): per-outcome coverage, discriminating fixtures, boundary oracles, invariant and surface `inventories`. Identify evidence not yet available; a planned check is never a PASS.
5. **Decompose:** keep the five-Meta graph (Entry → Module → Chunk → Bundle → Asset; leaves may let `validate` derive it, and program roots their children's Modules, Chunks and Bundles). Order real dependencies; parallel waves are derived, never hand-marked. The host gets only the root summary, target child and direct dependencies; no leases, fixed roles or minute budgets.
6. **Review and report:** review is optional. Run it when `validate` reports `SDD_V2_REVIEW_RECOMMENDED` (a behaviour change, a consumed export or five or more Must-Ship requirements) or the user asks for it (`review`); otherwise skip it and say so in the report. To review, hand the SDD path, repository root and [review](references/review.md) to one fresh-context reviewer (not the author; without subagents, a separate session), record its findings file and a disposition per finding in `review`, and re-review only changed clauses, once. For a BC, scaling gate or consumed export, run the [preflight](references/v2-authoring.md#6-report--analyze-hand-off-converge) first. Then validate the Meta and requirement-to-acceptance links once, analyze what structure cannot see (ambiguity, duplication, coverage, principle conflicts), and pass resolved paths, design blockers, open decisions and evidence limits to the chosen host. The host implements and compares actual results with the SDD's acceptance. Record any defect this skill's checks and review missed as an `OD-##` entry in `rsi/observed-defects.md`.

Load [writing](references/writing.md) for prose and [migration](references/v2-migration.md) only when a public surface changes or is removed. Product and platform guides ([loading](references/loading.md)) supply facts; their v1 gates do not apply.

## Commands

Run as `bun <create-sdd-root>/scripts/<script>`; flags are in each script's header.

| Command | Use |
|---|---|
| `validate.ts validate --sdd <absolute-SDD> [--repository <absolute-root>]` | Check v2 structure and return one compact host handoff; structural readiness still needs semantic review |
| `validate.ts validate --sdd <SDD> --evidence <report.json> [--replay]` | Converge: oracle-linked, causal behaviour proof and design-to-code gaps; `--replay` runs each oracle at base, change and with the change removed |
| `init.ts --kind feature\|bug\|assessment\|program\|evidence --out <path>` | Write a skeleton (or evidence report) that validates as AWAITING_USER; never overwrites; `--branch`, `--oracle-stubs` |
| `validate.ts validate-draft` | Check a proposed SDD before writing it |
| `validate.ts document-check` | Check a document that does not target implementation |
| `type-probe.ts check --sdd <SDD>` | Optional: type-check exported TypeScript fences for degenerate public types |
| `rsi.ts update` | Maintain this skill's own rules and evidence; independent of SDD readiness |

## Output

- Create, refactor or merge: edit the target SDD and summarize decisions, unresolved items, verification plan and evidence limits. Plan Mode outputs the complete proposed SDD via `validate-draft`, never a short plan.
- Audit: findings ordered by severity with location, consequence and fix; no rewrite unless requested.
- Report what was inspected, what remains unknown, and whether conclusions concern the document, the implementation or both.
- SDDs are delivered at the maturity their actual checks support. Missing or unrun required checks stay disclosed and do not permit a readiness claim.
- Multi-SDD output and program roots follow [multi-SDD](references/v2-program.md).
- Keep repository input and output location independent ([writing](references/writing.md)).
- For v2, `validate` is the single structural handoff; it does not prove source claims, so inspect live source during Harvest.

## What these checks do not prove

Structure and source checks do not prove semantic completeness, implementation, agent reading or permission enforcement. Symbol candidates are regex-based advice. Without `--replay`, proofs check commits, order and diff; with it, a proven ablation shows the pass depends on the implementation, not that the oracle covers all of the requirement. A design-ready SDD grants no authority to run tests, commit, merge, publish or deploy. Report missing checks and open choices as limits, not as PASS.
