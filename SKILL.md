---
name: create-sdd
description: Use when the user asks to create, refactor, merge or audit a Software Design Document (SDD) for a repository or product, or to make a design implementation-ready. Not for ordinary plans, ADR/RFC comments or code-only analysis.
---

# Create SDD

Produce a design contract at the requested maturity: proposed design, document refactor, merge, document-only audit, or implementation-closure audit. Preserve user scope. Never turn a document request into source implementation, repository-wide verification or a commit unless explicitly requested.

## Mainline boundary (hard)

- Scope is the requested deliverable: no unrequested features, refactors, tools, tests, benchmarks or speculative hardening; only a demonstrated blocking prerequisite, within existing authority. Requirements and acceptance cover the user-owned delta; adjacent defects are noted, never Must-Ship.
- Tests are evidence, never the deliverable unless requested: reuse the cheapest relevant evidence and invent no test files or frameworks. A user ban on tests overrides everything here; state the unverified limits. Running a program to check implementation behaviour is testing wherever it runs; type checks, builds and dependency resolution may supply design evidence.
- Obey the global mainline hook and `AGENTS.md`; never evade a denial by another tool, script, agent, renamed probe, policy edit or fabricated consent. Without hook enforcement, say so and keep the boundary.

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
| Bug fix | `intent: bug`: reproduction, root cause, regression acceptance | [bug fix](references/authoring/bug-fix.md) |
| Assessment | Go/no-go before an SDD; a go seeds prioritized Entries | [assessment](references/authoring/assessment.md) |
| Migration design | Close the current consumer and compatibility boundary | [migration](references/v2-migration.md) |
| Program split | Keep independently executable outcomes in narrow child contexts | [multi-SDD](references/v2-program.md) |
| Contract | Default for new implementation work | [sdd/v2](references/v2-contract.md) |
| Review | `review <SDD>`: run the pre-handoff review on a designed SDD now, whatever the recommendation | [review](references/review.md) |

## Workflow

Create, refactor and merge work runs directly in the current task. Keep six authoring phases; [authoring](references/v2-authoring.md) gives each phase's practice and [loading](references/loading.md) only relevant detail. They are a reasoning order, not six required tool calls or receipt gates.

1. **Harvest:** read the request, repository instructions, current code and interfaces. Resolve repository and output paths once; classify facts `USER_STATED | OBSERVED | INFERRED | ASSUMED` (first two normative); name principle files (`AGENTS.md`, a spec-kit constitution) in `principles`, never copy them.
2. **Admit:** settle WHAT and WHY without technology: prioritized, independently acceptable user stories as Entries, measurable success criteria and edge cases. Mark open points `[NEEDS CLARIFICATION: D1 …]` and clarify in one batch. Keep the Entry-to-Module requirement map; choose one SDD or a shallow [multi-SDD program](references/v2-program.md) from outcome, ownership, dependency and context cost.
3. **Design:** state HOW in [sdd/v2](references/v2-contract.md): normative behavior, implementation steps, producer/consumer interfaces, supported failures and one owner per change boundary. Preserve each Module's normative Source location. Read an existing target before editing it; never replace it with a fresh scaffold or discard its IDs without an explicit replacement request.
4. **Verify:** give each Must-Ship requirement an observable Given/When/Then or command acceptance case that could detect its absence, name its deciding test in `oracles`, and review requirement quality as a checklist. Resolve the acceptance-quality candidates ([authoring](references/authoring/verify.md)): per-outcome coverage, discriminating fixtures, boundary oracles, invariant and surface `inventories`. Identify evidence not yet available; a planned check is never a PASS.
5. **Decompose:** keep the five-Meta graph (Entry → Module → Chunk → Bundle → Asset; leaves may let `validate` derive it, and program roots their children's Modules, Chunks and Bundles). Order real dependencies; parallel waves are derived, never hand-marked. The host gets only the root summary, target child and direct dependencies; no leases, fixed roles or minute budgets.
6. **Review and report:** review only on `SDD_V2_REVIEW_RECOMMENDED` or a user `review`, by one fresh-context reviewer (not the author; else a separate session) per [review](references/review.md); otherwise say it was skipped. A leaf with a BC, a scaling gate or a consumed export needs a passing [preflight](references/authoring/report.md) for this revision. Prose names contract facts by ID or in `render.ts` regions; split a leaf over 800 lines or 12 steps. Validate once, analyze what structure cannot see, and pass paths, blockers, open decisions and evidence limits to the host. A host that can start subagents may dispatch the handoff per [dispatch](references/dispatch.md). Record any defect of this skill you meet as an `OD-##` with its root cause in the skill ([intake](rsi/observed-defects.md)); the handoff's `defect_duty` gives the host the same duty.

Load [writing](references/writing.md) for prose and [migration](references/v2-migration.md) only when a public surface changes or is removed. Product and platform guides ([loading](references/loading.md)) supply facts; their v1 gates do not apply.

## Commands

Run as `bun <create-sdd-root>/scripts/<script>`; flags are in each script's header.

| Command | Use |
|---|---|
| `validate.ts validate --sdd <absolute-SDD>` | Check v2 structure; return the host handoff |
| `validate.ts validate --sdd <SDD> --evidence <report> [--replay]` | Converge: causal, oracle-linked proof and design-to-code gaps |
| `validate.ts validate-draft` / `document-check` | Check a proposed SDD / a non-implementation document |
| `init.ts --kind feature\|bug\|assessment\|program\|evidence --out <path>` | Write a skeleton that validates as AWAITING_USER |
| `preflight.ts run --sdd <SDD> [--affected]` | Run the leaf's `preflight` items in disposable copies; testing authorized for such leaves |
| `render.ts --sdd <SDD>` | Rewrite `sdd-generated` regions from the contract |
| `type-probe.ts check --sdd <SDD>` | Optional: flag degenerate exported TypeScript types |
| `rsi.ts update` | Maintain this skill's own rules; independent of SDD readiness |

## Output

- Create, refactor or merge: edit the target SDD; summarize decisions, unresolved items, verification plan and evidence limits. Plan Mode outputs the complete SDD via `validate-draft`, never a short plan.
- Audit: findings by severity with location, consequence and fix; no rewrite unless requested.
- Say what was inspected, what remains unknown, and whether conclusions concern the document, the implementation or both. Multi-SDD output follows [multi-SDD](references/v2-program.md); keep input and output locations independent ([writing](references/writing.md)).
- Deliver at the maturity actual checks support. `validate` proves structure, not semantics, source claims, implementation or agent reading, so inspect live source during Harvest; symbol candidates are regex advice; a proven `--replay` ablation shows a pass depends on the implementation, not that the oracle covers the requirement. A ready SDD grants no authority to test, commit, merge, publish or deploy. Report missing checks and open choices as limits, never as PASS.
