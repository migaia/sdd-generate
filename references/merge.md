# SDD Merge

Read this reference only when consolidating multiple SDDs.

1. Inventory source documents, status, owner, scope, decisions, IDs, unresolved items, and supersession relationships.
2. Choose an owning document or a linked document set based on repository ownership; do not force unrelated packages into one owner.
3. Preserve decision provenance and reconcile each source's problem evidence, route assumptions, causal boundary, and exclusions. Resolve contradictions explicitly instead of silently choosing the newest wording or unioning every source scope.
4. Preserve stable IDs. When IDs collide, keep the authoritative ID and record aliases or a moved-ID table; never silently renumber referenced IDs.
5. Deduplicate rationale and examples, but do not copy detailed contracts that remain owned by another live SDD.
6. Mark superseded source documents and redirect readers only when the user authorized those edits.
7. Audit the merged result for orphan references, conflicting statuses, duplicated normative clauses or semantic owners, causal expansion, and lost deferred items.
