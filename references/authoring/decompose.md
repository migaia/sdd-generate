# 5 Decompose — tasks as a derived view

- An acceptance must be able to pass when its closing steps finish: if it names a path or symbol only a later step produces, `validate` reports `SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY`; move the case, the step or the batch order.
- Chunks (batches) group the steps of one coherent change. Order them so the P1 Entries' Chunks can finish first, and declare real `depends_on` edges.
- Each step is a task. Write it as a record when the host needs more than its prose: `{"id": "S2", "touches": ["packages/a/api.ts"], "after": ["S1"], "closes": ["A1"]}`. `touches` must lie inside `writes`; `after` names steps in the same leaf, and an `after` that crosses batches needs a matching batch `depends_on`; `closes` names the acceptance the step completes. A bare string ID stays valid.
- Do not write a tasks.md or parallel markers. The handoff derives them:
  - `tasks`: steps ordered by batch waves, then Entry priority, then `after`. Each task carries its Chunk, Entries, touches (marked `existing` or `new`), closes and `parallel_with` (tasks with no order between them and disjoint touches).
  - `mvp_tasks`: the smallest ordered set that closes every acceptance of the MVP Entries — the first checkpoint.
  - `waves` (Chunk layers) and, for a program root, `parallel_children` (child layers; child write boundaries are already conflict-checked, and children ordered by `depends_on` may write the same paths in sequence).
- Keep one SDD unless an independently deliverable outcome with its own owner makes a child narrow the context a host must read ([multi-SDD](../v2-program.md)).
