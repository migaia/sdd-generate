# SDD writing guide

Load when writing or revising SDD prose. Documents follow [sdd/v2](v2-contract.md); this page covers how they read.

## Plain prose

An SDD is read by people and agents who act on every sentence. Write claims, not staging:

- State the decision directly; no "not X but Y" framing, dramatic closers, aphorisms or run-ups that announce a point before making it.
- No inflated significance or sales words (pivotal, robust, seamless, comprehensive); name the concrete property and its measure.
- No stacked hedges; state an uncertainty once as an unknown with its falsifier.
- Name actors and owners; avoid passive constructions that hide who does what.
- Bold only defined labels; headings carry content, and the first sentence does not repeat the heading.
- Describe current and target behavior, not the history of earlier drafts.
- Never invent a fact, name, number, quote or source to make prose complete. State a missing fact plainly; put a material choice requiring the user in `unresolved_user_decisions`.

## Normative text and everything else

Distinguish normative requirements from rationale, examples, implementation suggestions and non-goals. Use RFC-style `MUST`/`SHOULD` only when the repository already uses them or the document defines them. Keep one compact design basis for the whole document instead of repeating rationale inside every requirement.

## Traceability

A traceability table may repeat IDs whose definitions are headings or list items ([sdd/v2](v2-contract.md)). Use the five-Meta relation graph to trace Entry → Module and its original requirement Source → Chunk/batch → Bundle/child SDD → Asset/output, with implementation steps and observable acceptance at the leaf. Proposed implementation locations and Asset versions may appear in a design-stage SDD; never present them as existing delivery evidence.

## Host handoff boundary

The SDD is the normative design. Requirements, steps, dependencies and acceptance let the chosen host implement a bounded slice without inventing product decisions. It stores no runtime assignments, progress, retry counters or checkpoint history. The host may group work but cannot add a requirement, oracle, consumer, write authority or external-action permission absent from the user request and document.

## Output location

Keep repository input and output location independent. Read the actual system `$TMPDIR` when the user asks for a sample there and write it there directly; absolute output paths are supported. Source paths stay repository-relative, and a cross-document link resolves from the document that refers to it. For a new SDD kept outside the repository it describes, pass both: `validate.ts validate --sdd <absolute-SDD> --repository <absolute-repository>`, so where the document lives never changes which repository its claims are checked against.
