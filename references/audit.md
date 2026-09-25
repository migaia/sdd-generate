# SDD audit

An audit request does not authorize source or document edits unless the user also asks for fixes.

## Depth

- **Document-only:** internal consistency, completeness, ownership, dependency direction, ambiguity, testability and unresolved decisions; implementation state is unknown.
- **Implementation:** additionally source, tests, exports, dependencies, consumers, generated artifacts and reproducible commands.
- **Closure:** additionally reconcile every normative clause and deferred item against current evidence with [closure evidence](closure-evidence.md).

Do not silently escalate from document-only to a repository-wide implementation audit.

## Checks

Apply the six authoring phases of [authoring](v2-authoring.md) and the structural checks of `validate`. Then check what only an audit sees:

- statuses claim no more maturity than evidence supports; tests and evidence prove behavior rather than mention IDs;
- deferred items keep destination, trigger, owner and acceptance impact;
- post-approval amendments did not add or remove packages, requirements, oracles or outcomes without explicit user approval, and did not legitimize already-expanded work;
- no side list, batch table or packet set duplicates the requirement and acceptance graph as a second authority;
- every proposed user authorization has a non-empty authority-effect delta; custody authority is bound to the artifact envelope, not to attempt counters;
- docs, exports, package metadata, lockfiles, registries and consumers agree where inspected.

## Finding format

Order by consequence. **High:** incorrect implementation, unsafe migration, reverse dependency, data loss, security failure or false completion. **Medium:** incomplete, ambiguous, untestable or likely to drift. **Low:** maintainability, organization or evidence-quality weakness. Each finding names location, problem, consequence and a specific correction, and separates confirmed defects from unknowns and optional improvements.
