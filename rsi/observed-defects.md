# Observed defects — the RSI intake queue

Record here, as `## OD-<n> <title>`, any defect a real authoring or delivery run found that this
skill's checks missed: what was observed, the evidence, why the checks missed it, and one
`**Root cause:** <asset> — <mechanism>` line.

Record when, during authoring or delivery, any of these happens: a check or review passes a result
later shown wrong; a check blocks a design or implementation that is correct; the author or host
invents a marker, override, wrapper or threshold change the skill does not define, or stops because
the skill gives no path; two instructions of this skill cannot both hold. Do not record defects of
the target repository or SDD content that the checks did catch.

The root cause names the asset whose gap or wrong assumption lets this whole kind of symptom
through — a `SKILL.md`, `references/`, `scripts/` or `cases/` path (`:line` allowed) or a ledger
rule code — and why. Ask why until the answer is in this skill; a restated symptom ("validate
reported X") is not a cause, and one fix per symptom never converges. The asset is the unit RSI
converges by: when it matches a queued entry, add the evidence there instead of opening another
(`health` lists `shared_roots`). Success is fewer host stops per delivery (sdd-bench `stops`), not
more detectors.

The file is a queue, not a history. Each update works it through `rsi.ts update`: inside a round,
`rsi.ts settle --id OD-<n> --as detector|lens|ruling|rejected --evidence <text>` decides every
entry by fixing its root asset (a detector names the frozen case that pins it; only `rejected`, for
a cause outside this skill, needs no existing root asset), and `close` archives each settled entry's
text into `rsi/rounds/<round>.json` and removes it here. After an update this file holds only this
header; anything below it is waiting to be settled.

## OD-88 step gates cover only the touched package, so consumer-graph gates go red between commits

Observed 2026-09-29 (codex, migai I6–I8, 15 commits across `guarded-property-read`, `abort-reason-read`,
`pipeline-internal-cleanup`, `plugin-host-async-prepare`): each step ran the gates of the package it changed and
passed, while `packages/rpc` A9 (root bundle size, a direct-consumer gate) was red at those commits and only
fixed later by a threshold adjustment. The leaves listed rpc as a direct consumer but their step gates did not
include its bundle check. A detector would require every step that changes a package in a consumer's retained
graph to run that consumer's declared scaling gates.
**Root cause:** `scripts/validator/domain/v2-document.ts` — the same ownership model as OD-94/OD-98: a leaf's obligations derive only from its own `writes`, never from the consumers that retain those files, so a consumer's scaling gate is no step's gate (`references/v2-authoring.md` §6 states the same scope).

## OD-93 export fingerprints hash raw clause prose, so editorial edits force whole-chain re-pins

Observed 2026-09-29/30 (migai rpc program): `process-plugin` R5–R8/A4/A5/A7/A8/A10 kept obsolete layer numbers
because correcting them would change `process-plugin@1` and force resilience/host/conformance re-pins outside the
writable scope; the author added a §0 mapping table instead (`rpc-program.claude-review-preimpl-A.md` XA5). CR-24
(`rpc-program.claude-review-r1.md:68`) shows a transitional note changing `wire-error@1`; delta review C re-pinned 18
consumers, and r32 ruling C batches re-pins per milestone to contain the cost. Conversely RA3 (same file) found §4
signature, error-code and wire-table edits outside the listed clauses do not change the fingerprint.
Why missed: `scripts/validator/domain/v2-semantics.ts:15-18` hashes each listed clause's full text as captured by
`stepText` (`v2-symbols.ts:38-55`, everything up to the next heading/list item/table), collapsing whitespace only;
there is no notion of normative content versus annotations (layer/revision labels, K-refs, notes).
Needs: fingerprint a normalized normative form (strip program layer/revision tokens, ledger refs and parenthetical
history), or fingerprint the exported contract (signature fences, codes) that consumers actually rely on.
**Root cause:** `scripts/validator/domain/v2-semantics.ts` — an export fingerprint hashes clause prose rather than the contract consumers rely on, so editorial text is treated as interface and real interface edits outside listed clauses are not.

## OD-94 a shared generated file in `writes` serializes every writer; there is no mergeable co-write

Observed 2026-09-30 (migai rpc program root r26–r27, ledger K160; delta review A §validate): every runtime leaf
lists repo-root `coverage-baseline.json` (F8) in `writes`; `validate` reported `SDD_V2_OWNER_CONFLICT` for
ipc-plugins↔handshake-redaction and handshake-redaction↔error-text-cleanup, and the root added ordering edges only
to satisfy it, fixing a single total write order (`rpc-program.sdd.md` §6 "写入与共享文件"). The same pattern holds
for `export-mapping.test.ts`, README/USEGUIDE and `package.json` (I15–I20 rows), stretching the plan to 20 levels.
Why missed: `scripts/validator/domain/v2-document.ts:751-766` treats every path overlap between unordered children as
exclusive ownership (OD-71 only exempted already-ordered pairs); `writes` cannot say that a path is keyed/append-only
per owner (one package's entry in a baseline, one row in a registry).
Needs: a co-write declaration (e.g. `shared_writes: [{path, key}]`) whose writers touch disjoint keys, checked by
preflight's `writes_outside` diff at key granularity, so such writers need no ordering edge.
**Root cause:** `scripts/validator/domain/v2-document.ts` — `writes` models only exclusive whole-path ownership per leaf; keyed shared writes and bounded writes into another leaf have no form, so every overlap becomes forced ordering.

## OD-98 no path amends a delivered producer from inside a consumer leaf, so its gates and status drift

Observed 2026-09-30/10-01 (codex and Claude, migai rpc M1): three blocks were solved by small additive changes to
already-delivered producers while implementing a consumer:
- K185 added a `context` field to `IRpcStreamRun` in verified `rpc-streaming` (`24c788f`);
- K187 added a public `isDefinedPlugin` to `@migaia/plugin-host`, which belongs to another program and to no open
  leaf (`ba39387`);
- K197 extracted an internal assembly function in verified `rpc-remote` for I15 (`7a95436`).
Each was handled ad hoc by user or Claude ruling. The producer's own gates were not re-run as a unit: after K185,
`validate` on streaming reported `change-base-uncovered` (see OD-89); after K197, the coverage baseline was not
re-signed until the next leaf's start preflight failed (K198). K187's change had no owning SDD revision at all; it
was recorded as a Clarification line in an unrelated leaf.
Why missed: `references/v2-authoring.md:63` (Amendment closure) and `:94` assume the amended leaf is the one being
delivered. Leaf `writes` are exclusive (`v2-document.ts:751-766`, OD-94), so a consumer cannot declare a bounded
write into its producer, and nothing marks the producer's closure stale when another leaf's commit touches its
files. Cross-program producers have no mechanism at all (OD-85 ruling).
Needs: a declared "producer amendment" item in the consumer leaf: producer leaf or package, the exact symbols or
files, additive-only flag, and the producer gates to re-run, including custody and exports baselines. Validate then
marks the producer revision stale until those gates pass. At minimum, `validate` should report a delivered leaf
whose `writes` files changed after its closure evidence head.
**Root cause:** `scripts/validator/domain/v2-document.ts` — the same exclusive ownership model: a consumer cannot declare a bounded write into a delivered producer, and a producer's closure is never staled by another leaf's commit to its writes.
