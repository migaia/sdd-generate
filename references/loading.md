# Six-phase loading for new SDDs

Harvest → Admit → Design → Verify → Decompose → Report is the authoring order. These are internal reasoning phases, not separate commands, mandatory receipts or host execution roles. Read only the material needed for the present task; the host receives the finished SDD and compact handoff, not this phase history.

| Phase | Read when needed | Produce |
| --- | --- | --- |
| Harvest | User request, live repository instructions, relevant source and public interfaces; consult a product or language guide only for a supported platform in scope | Observed facts, assumptions, repository/output paths and normative Source locations |
| Admit | [multi-SDD](v2-program.md) when a split can reduce context; [migration](v2-migration.md) when a public surface changes | Owned scope, Entry-to-Module requirement map, selected cut, material open user decisions |
| Design | [writing](writing.md) and [sdd/v2](v2-contract.md); source contracts for real producers and consumers | Normative behavior, steps, interfaces, failures, write boundaries, current Module sources and original origins |
| Verify | The SDD's own claims and the repository's actual verification commands | An observable acceptance for each Must-Ship claim and honest evidence limits; planned Asset validation remains planned |
| Decompose | The five-Meta graph, child dependencies, coherent batches and exact producer outputs | Module-to-Chunk-to-Bundle ownership and versioned Assets; each child needs only root summary and direct dependencies |
| Report | Existing validate command; semantic source review from Harvest | One resolved host handoff with graph diagnostics or named blockers |

## Guides that supply facts

Load a guide only when its condition holds in the user-owned scope. Guides supply platform and language facts; their v1 delivery gates (receipts, lanes, test budgets) do not apply to a new SDD.

| Condition | Load |
| --- | --- |
| The product has a user interface | [experience contract](product/experience-contract.md) |
| Content publication (blog, docs, knowledge base) | [content site](product/content-site.md) |
| Mini program, iOS/Android, Flutter, HarmonyOS, desktop or native SDK | [platforms](product/platforms.md), then the matching guide in `product/platforms/` |
| A language is in scope (only those present) | [Rust](product/languages/rust.md), [Go](product/languages/go.md), [Python](product/languages/python.md), [Bun and Node](product/languages/bun-node.md), [JVM](product/languages/jvm.md) |
| TypeScript build or publication responsibility changes | [TypeScript toolchain](design/typescript-toolchain.md) |
| One capability exposed through several surfaces | [core and adapters](product/architecture/core-adapters.md) |
| A choice may need user authority | [decision authority](design/decision-authority.md) |

## When `validate` blocks a v2 document

Each code is a family; the message starts with the specific relation that failed (for example `asset-outside-write-scope: T1`).

| Code | Read |
| --- | --- |
| `SDD_V2_INDEX_SHAPE_INVALID`, `SDD_V2_REQUIRED_FIELD_EMPTY`, `SDD_V2_ID_DUPLICATE` | [compact index](v2-contract.md#compact-index) |
| `SDD_V2_PROSE_DEFINITION_MISSING`, `SDD_V2_PROSE_DEFINITION_DUPLICATE` | [ID definitions](v2-contract.md#compact-index) and [writing](writing.md) |
| `SDD_V2_REFERENCE_MISSING`, `SDD_V2_DEPENDENCY_CYCLE`, `SDD_V2_MUST_SHIP_CHAIN_INCOMPLETE`, `SDD_V2_COVERAGE_MISSING` | [compact index](v2-contract.md#compact-index), then [decompose](v2-authoring.md#5-decompose--tasks-as-a-derived-view) |
| `SDD_V2_META_SOURCE_MISMATCH`, `SDD_V2_OWNER_CONFLICT` | [five-Meta graph](v2-program.md#five-meta-relation-graph) |
| `SDD_V2_INTERFACE_MISMATCH`, `SDD_V2_PROGRAM_LINK_INVALID`, `SDD_V2_INTEGRATION_OWNER_REQUIRED`, `SDD_V2_SECTION_MISSING` | [multi-SDD](v2-program.md) |
| `SDD_V2_PATH_INVALID`, `SDD_V2_PATH_ESCAPE`, `SDD_V2_PATH_NOT_FOUND`, `REPOSITORY_NOT_FOUND` | [host handoff](v2-contract.md#direct-host-handoff) |
| `SDD_V2_PRESET_INVALID`, `SDD_V2_PRESET_BLOCKED`, `preset-*` subtypes | [presets](v2-presets.md) |
| `SDD_V2_CLARIFICATION_UNTRACKED` | [clarify](v2-authoring.md#2-admit--what-and-why) |
| Candidates `SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY`, `SDD_V2_ERROR_TEXT_READER_UNDECLARED`, `SDD_V2_SHAPE_READER_UNDECLARED` | [design](v2-authoring.md#3-design--how-under-the-principles), [decompose](v2-authoring.md#5-decompose--tasks-as-a-derived-view) |
| `SDD_V2_CLOSURE_OPEN`, `SDD_V2_CLOSURE_FAILED` (under `closure`) | [converge](v2-authoring.md#6-report--analyze-hand-off-converge) |
| Codes from an `intent: bug` leaf or an `sdd-assessment/v1` document | [bug fix](v2-authoring.md#bug-fix--the-same-six-phases-proving-the-defect), [assessment](v2-authoring.md#assessment--deciding-before-specifying) |

Keep the repository's current rules authoritative. Do not copy its instructions into a second template. Do not turn a guide's possible platform dimensions into universal requirements when the user-owned path cannot reach them.

RSI maintenance is a separate skill-improvement activity and does not enter this table.
