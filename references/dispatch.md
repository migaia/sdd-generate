# Dispatch to subagents

Optional, for a host that can start subagents; no roles, leases or extra state.

- **Unit:** one subagent per program child (by `parallel_children` layer) or leaf Chunk (by `execution_slice.waves` layer). Work inline when there is one small unit or the parent already holds its context.
- **Order:** units in a layer share the tree (`validate` orders overlapping `writes`; `shared_writes` edit own key only). Start a layer once its `required_assets` exist at version with passing acceptance.
- **Prompt:** a STRUCTURALLY_READY handoff carries `dispatch`; send each unit `shared_prefix + scope_prefix + text` unchanged. Text runs most-stable first (program, document, unit) with sorted lists and no timestamps, so siblings share byte-identical leading text a prefix-matching prompt cache can reuse. Start one unit of a layer first, then its siblings, so they find the cache written. Briefs carry paths and IDs, never copied text or prior transcripts.
- **Close:** a unit returns changed paths and an `sdd-evidence/v1` report; on failure the parent re-dispatches, amends or asks the user. The integration owner runs integration acceptance; one fresh reviewer that implemented nothing checks the diff; `validate --evidence` decides closure.
