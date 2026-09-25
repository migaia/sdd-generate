# Closure Evidence

Read this reference only for implementation-completeness or closure audits, or when the repository explicitly requires quantitative acceptance metrics. For an sdd/v2 leaf, first run `validate --evidence --replay` ([converge](v2-authoring.md#6-report--analyze-hand-off-converge)): it settles the mechanical part (every acceptance reported at the current revision, evidence locations present); this page covers what it cannot judge.

## Evidence rules

For every non-deferred normative clause inside the admitted causal boundary, record the strongest current evidence and classify it as `current`, `stale`, `indirect`, `missing`, or `environment-failed`. A planned command, test name, status label, or source inspection alone does not prove runtime behavior. Report unrelated repository failures separately; they do not become closure blockers unless they falsify or mask a named acceptance oracle.

Prefer reproducible CI runs or checked-in evidence artifacts. Dirty-worktree results may support local progress but are not durable closure evidence unless the repository explicitly accepts them. Never require a commit when the user did not request one.

## Acceptance inventories

Use only dimensions relevant to the system and repository policy:

- `REQ`: normative requirements and their implementation/verification evidence;
- `INT`: observable interaction scenarios and ordered state/output assertions;
- `ERR`: reachable failure branches, state consistency, cleanup, and error-chain assertions;
- `RED`: reviewed duplication, compatibility, alias, dead-export, and copied-mechanism candidates;
- `SEC`: trust boundaries, threats, mitigations, verification, and residual risks;
- `HIGH`: high-impact failures, blast radius, prevention or recovery, and evidence.

One verification case may support several dimensions when each mapping names the distinct contract it proves. Do not duplicate evidence rows merely to inflate coverage.

## Quantitative metrics

Calculate percentages only when the inventory is demonstrably bounded and the repository requests or relies on the metric. Record numerator, denominator, exclusions, procedure, evidence, date/context, and owner of open items. Otherwise report item counts and uncovered rows without a percentage.

Never claim completeness from a self-authored denominator without auditing it for omissions. In particular:

- interaction and exception inventories are not automatically exhaustive;
- redundant LOC is not objectively measurable without a defined classifier, so report reviewed findings rather than a LOC rate by default;
- security uses severity counts and residual-risk ownership, not a percentage;
- secret exposure may be reported as zero only with a named scanner, scope, configuration, and successful result;
- an empty inventory is `N/A` with justification, not implicit success for future implementation phases.

Design approval does not require implementation metrics to pass. Closure may be declared only under repository-defined closure gates with all required dimensions covered or explicitly deferred.
