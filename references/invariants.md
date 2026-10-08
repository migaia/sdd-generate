# Design invariants

Treat a design failure as a violation of one of these invariants and correct its cause instead of adding an incident-specific clause. Each invariant names where its operational rule lives.

1. **Problem truth:** evidence establishes the current behavior and gap, or the greenfield need, before a solution becomes normative. [Harvest](authoring/harvest.md)
2. **Single authority:** each semantic invariant and product decision has one accountable owner; projections and adapters never become parallel truth. [Design](authoring/design.md), [five-Meta graph](v2-program.md#five-meta-relation-graph)
3. **Causal closure:** scope and acceptance stop at the owned delta and demonstrably affected consumers; permission to observe a package never grants permission to modify it. [Admit](authoring/admit.md)
4. **Proportionality:** the smallest conventional route that satisfies the observable outcome; complexity, compatibility layers, new primitives and broad gates need evidence. [Design standard](../SKILL.md#design-standard), [principle check](authoring/design.md)
5. **Falsifiable evidence:** every material choice names its evidence and the cheapest check that could disprove it; a guard-backed claim proves its oracle flips when the guard is bypassed; one incident never becomes a universal rule without a minimal contrast. [Verify](authoring/verify.md), [behavior evaluation](behavior-evaluation.md)
6. **One work graph:** the SDD owns requirements, dependencies, acceptance and batches; tasks are a derived view. [Decompose](authoring/decompose.md)
7. **Decision closure:** every known Must-Ship choice about public contracts, ownership, dependency direction, breaking behavior or user authority is resolved before implementation or is an explicit open decision. [Decision authority](design/decision-authority.md)
8. **Artifact custody:** every protected artifact has one executable generator → signer → installer → verifier chain. [Design](authoring/design.md)
9. **Context economy:** the SDD is the single contract; the host gets only the root summary, its target child and direct dependencies. [Report](authoring/report.md)
10. **Test topology convergence:** tests follow stable behavior, module and runtime boundaries, never delivery history. [Verify](authoring/verify.md)
11. **Incremental integrity:** revise in place, preserving IDs, decisions and routing; files are locations, not owners. [Design](authoring/design.md)
12. **Semantic fidelity:** a user constraint is normalized without strengthening it. [Admit](authoring/admit.md)
13. **Propagation closure:** work on anything a shared mechanism manages is classified by its effects, not by the command name, and closes every manager and write point along the authority chain. [Design](authoring/design.md)
14. **Inventory/environment separation:** source inventory stays authoritative without installed dependencies; runtime resolution is fingerprint-bound and drift is inconclusive, not product failure. [Harvest](authoring/harvest.md)
15. **Promise–branch traceability:** every stated guarantee is a branch in a step and an observed acceptance. [Verify](authoring/verify.md)
16. **Irreversible-state safety:** destructive steps follow confirmed commits, and unrecognized data is preserved. [Design](authoring/design.md)
