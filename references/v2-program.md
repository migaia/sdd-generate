# Multi-SDD program (`sdd-program/v2`)

Split a task when independent outcomes have stable ownership and a child SDD materially narrows the context an implementing agent must read. Keep tightly coupled behavior in one child; do not split by file, layer, requirement count or desired agent count. A user-requested split is already a decision. Otherwise state the proposed cut and ask only when alternative cuts materially change the promised outcome or authority.

The root is a shallow roadmap: total goal, shared constraints, child IDs and paths, dependencies, the five-Meta relation graph, and overall integration acceptance. Put shared constraints under `## Shared Constraints` or `## 共享约束` (write `None` or `无` when there are none) so the child handoff can carry them without loading the full root. When the root declares integration, define its acceptance IDs under `## Integration Acceptance` or `## 整体验收`; this section reaches the integration owner. The root does not copy a child's normative requirement, behavior, batch design or runtime progress; an integration acceptance cites the child acceptances it combines in the root's `relies_on` (`{"A-total": [{"document": "host", "acceptance": "A6"}]}`), and one that names a child's exported symbols without citing is a `SDD_V2_ROOT_RESTATES_CHILD` candidate. Each child owns those clauses, its steps, write boundary, interfaces and acceptance through [sdd/v2](v2-contract.md). Every shared write and cross-child integration has one execution child as owner. A consumer waits for the producer's real output and exact version; interface agreement is not implementation evidence.

## Five-Meta relation graph

Keep Entry, Module, Chunk, Bundle and Asset. They are design relations, not five document levels, an execution role system or a second prose authority. Entry binds a user outcome defined in the root body to descendant Modules. A Module's `source_id` names the currently authoritative child requirement, while `origin:{document,requirement_id}` preserves its original Source identity; the origin document path is relative to the program root and can differ from the child when an existing SDD is split. Local requirement IDs may repeat in different children. A Chunk binds a business-coherent child batch through its `source_id` and lists its Modules. A Bundle names exactly one executable child and contains its Chunks; optional `reads` lists concrete repository-relative inputs. An Asset binds a repository-relative delivered file or directory to its producing Bundle, planned version and the producer child's observable acceptance. `requires` links a consuming Bundle to the exact producer Assets it needs. These relations preserve the original requirement identity while letting the host read only the target child and direct dependencies. The root may omit Module, Chunk and Bundle: each child then derives `M:<child>:<R>`, `K:<child>:<C>` and `B:<child>`, whose `requires` are the sibling Assets its `consumes` name, so a child edit never forces a hand-copied root index. The root still declares its Entries (which may list the derived `M:` IDs) and Assets (produced by `B:<child>`).

The child SDD body is the authority for requirement, batch, step, interface and acceptance semantics. The program index stores only IDs, paths, versions and relationships. One Module represents each executable child requirement, one Chunk each child batch, and one Bundle each child. Every Must-Ship requirement must have a path through Module, Chunk and Bundle to its implementation and acceptance; every promised delivered output has a producing Asset. A requirement can participate in ordered Chunks within its own Bundle; this does not create a second execution owner. Source is a location in a normative document or repository source, not a sixth Meta and not a copy of the clause. When splitting an existing SDD, keep the original requirement Source file available for `origin` resolution; moving its authority to a child must not erase its recorded provenance.

## Root index

Put one JSON block between `<!-- sdd-program:start -->` and `<!-- sdd-program:end -->`:

```json
{
  "protocol": "sdd-program/v2",
  "id": "feature-program",
  "revision": "1",
  "children": [
    { "id": "foundation", "sdd": "foundation.sdd.md", "depends_on": [] },
    { "id": "consumer", "sdd": "consumer.sdd.md", "depends_on": ["foundation"] }
  ],
  "metas": [
    { "id": "E1", "kind": "Entry", "members": ["M-foundation", "M-consumer"] },
    { "id": "M-foundation", "kind": "Module", "owner": "foundation", "source_id": "R1", "origin": { "document": "foundation.sdd.md", "requirement_id": "R1" } },
    { "id": "K-foundation", "kind": "Chunk", "owner": "foundation", "source_id": "C1", "members": ["M-foundation"] },
    { "id": "B-foundation", "kind": "Bundle", "owner": "foundation", "members": ["K-foundation"], "requires": [], "reads": ["packages/foundation"] },
    { "id": "T-foundation", "kind": "Asset", "producer": "B-foundation", "path": "packages/foundation/index.ts", "version": "1", "acceptance": ["A1"] },
    { "id": "M-consumer", "kind": "Module", "owner": "consumer", "source_id": "R1", "origin": { "document": "consumer.sdd.md", "requirement_id": "R1" } },
    { "id": "K-consumer", "kind": "Chunk", "owner": "consumer", "source_id": "C1", "members": ["M-consumer"] },
    { "id": "B-consumer", "kind": "Bundle", "owner": "consumer", "members": ["K-consumer"], "requires": ["T-foundation"], "reads": ["packages/consumer"] },
    { "id": "T-consumer", "kind": "Asset", "producer": "B-consumer", "path": "packages/consumer/index.ts", "version": "1", "acceptance": ["A1"] }
  ],
  "integration": { "owner": "consumer", "implementation": ["S-integrate"], "acceptance": ["A-total"] },
  "unresolved_user_decisions": []
}
```

The root body defines `E1` as the user outcome. The foundation child exports the interface with `{"id":"public-api","version":"1","asset":"T-foundation"}`. The consumer child consumes `{"document":"foundation","export":"public-api","version":"1"}`. Both children define their local `R1`, `C1` and `A1` in prose; their original identities remain distinct by document path. The root prose defines `A-total` as an observable end-to-end result. The `consumer` child defines `S-integrate` as the step that assembles or demonstrates the combined behavior. A multi-child program needs an integration owner and an owned step even when integration is small. Children point back to the root with `root`; paths resolve from the referring document.

`validate` checks path resolution, missing children, cycles, duplicate Meta IDs, unowned or conflicting requirement/batch/write ownership, broken Module origins, Bundle/Asset dependency edges, producer/consumer versions and integration ownership. It cannot prove that the split is semantically complete or that a claimed Asset has been built. A root handoff lists child paths, dependency edges and `parallel_children` (children grouped in dependency layers; a layer may start once earlier layers have delivered) without loading every child's full text. A root may declare `principles` and Entry `priority` as a leaf does. A child handoff carries the root summary and constraints, its Bundle/Chunks/Module Sources, and the direct dependency Assets and exact versions; its implementing host then reads that child and those direct dependencies. Host scheduling, parallelism, permissions and progress remain the host's responsibility.

Do not restore mandatory minute ranges, test allocations, leases, fixed roles, reading receipts or a second program state.
