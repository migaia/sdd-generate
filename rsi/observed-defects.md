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

## OD-89 change-base RED is demanded for pure-new modules, so hosts write existence stubs that pass it

Observed 2026-09-29/30 (codex, migai rpc program I9 `rpc-streaming`, I13 `rpc-remote`): for acceptances whose
entry module does not exist at base, the only base failure available is "module/export missing". The original
streaming P0 used 13 existence sentinels, not the §7 oracles (ledger K168); the program had to add X14 rule 2
(`SDD_BASE_RED_CONTRACT:<A#>` markers) and then the r32 override exempted pure-additive modules from base-RED,
proving discrimination by audit mutation instead. After the additive K185 increment `validate` still reports
`change-base-uncovered` for streaming A14 (codex impl log 2026-09-30 row "K185 指纹"), so the ruling and the
validator cannot both hold. Evidence: `docs/rpc/rpc-program.defect-ledger.md` K162/K168, `rpc-program.sdd.md` §9 X14.
Why missed: `scripts/validator/domain/v2-preflight.ts:235-244` requires a no-patch `expect:"fail"` item for every
must-ship acceptance not in `preserve`; there is no third acceptance class (new surface) and no alternative proof
(perturbation or mutation of the change, as OD-44 proposed for closure). The base run only proves absence.
Needs: let an acceptance whose subject is absent at base (new file/export in `writes`) satisfy the check with a
perturbation item on the candidate (patch + `expect:"fail"`) instead of a base run, and report stubs whose only
failure is load/resolve (see OD-90).
**Root cause:** `scripts/validator/domain/v2-preflight.ts` — the obligation rule knows two acceptance classes (change: base fails; preserve: base passes) and assumes a base run can discriminate; for a subject absent at base it can only prove absence, so it demands evidence that cannot exist and invites stubs.

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

## OD-95 claims about an implemented dependency's API are never checked against its public exports or behaviour

Observed 2026-09-30 (codex, migai I13 `rpc-remote`; ledger K184/K185/K187, impl log "S2 预查"): the frozen leaf
required (a) a JSON Schema 2020-12 constraint that key equals `value.plugin`, which the dialect cannot express;
(b) a stream-open `IRpcContext`, but `IRpcStreamRun` received only `{signal}`; (c) a trusted-plugin check through a
symbol the package does not export (split out as OD-102); (d) plugin name `migaia.remote.serve#`, which `definePlugin` rejects (dots). Each stopped
implementation after two design review rounds; (b) and (c) forced public API changes in other packages.
Why missed: `type-probe.ts` compiles only the SDD's own exported fences; preflight is required only for BCs, program `consumes` and scaling gates
(`v2-preflight.ts:113-120,257-259`), and cross-program/standalone producers must keep `consumes` empty (OD-85), so
no feasibility item ever calls the dependency.
Needs: type-check declared calls against the real dependency types; require a preflight item for each stated
external capability or constraint (name format, schema keyword) the design depends on.
**Root cause:** `scripts/validator/domain/v2-preflight.ts` — executable obligations trigger only on BCs, consumed exports and scaling gates; claims about an implemented dependency (API shape, export reachability, schema or naming rules) are checked as text and never executed against it.

Additional evidence 2026-10-01 (I16 `rpc-process-resilience`, ledger K207): the start-of-leaf API check verified
`pending.accept` and the existing channel offer but not the offer built inside the opaque client
`IProcessPluginEstablish` closure (`packages/rpc/test/process/plugin-native.test.ts:94-107`,
`src/process/plugin/types.ts:34-69`). Resilience A5 needs to audit the offer before spawn/dial, so S2 stopped. A claim
check must follow values that a dependency builds inside caller-supplied callbacks, not only the declared signatures.

## OD-102 a step's dependency symbol resolves anywhere in the workspace, not through the package's exports

Split from OD-95 (c). Observed 2026-09-30 (codex, migai I13 `rpc-remote`; ledger K187): the frozen leaf's trusted-plugin
check called `readDefinedPluginDefinition`, which is defined in `packages/plugin-host/src/define-plugin.ts:366` but not
exported from the package entry. `validate` accepted the call; implementation stopped, and K187 had to add a public
`isDefinedPlugin` to `@migaia/plugin-host` (see OD-98).
Why missed: the OD-74 fallback in `scripts/validator/domain/v2-symbols.ts` (around line 78) accepts a symbol defined
anywhere under a dependency package without checking that the package's `exports`/entry re-exports it.
Needs: resolve a dependency symbol through the owning package's `exports` (or `main`/`types` entry) and report an
internal-only hit as a candidate. Mechanical, so it can be a detector pinned by a case.
**Root cause:** `scripts/validator/domain/v2-symbols.ts` — dependency symbols are resolved by definition site rather than by the package's public entry, so an internal symbol counts as available API.

## OD-96 no review lens checks what untrusted input reaches errors, summaries or logs

Observed 2026-09-30 (migai `rpc-handshake-redaction`, ledger K173/K176): the verified redaction design still
projected peer-controlled field names and `kind/step/protocol/codec` values into the error summary and `cause`,
and 9 nested cause sites carried raw remote values; `util.inspect`/`serializeRpcError` leaked a planted token.
Redaction A6 itself asserted the leaking shape. Two design review rounds and a verified implementation missed it;
a later Claude review found it with a probe. Evidence: `docs/rpc/rpc-program.defect-ledger.md` K173/K176, scratch
`probe-redact*.ts`.
Why missed: `references/review.md:11-35` defines only L1 (behaviour-change sweep), L2 (discrimination against wrong
implementations) and L3 (dry-run); none asks where untrusted input flows, and the authoring guidance requires
cause-chain placement of errors (`references/v2-authoring.md:41`) without any allowlist rule for what the cause may
carry. `closure-evidence.md:33` covers secret scanning only at closure.
Needs: a trust-boundary lens (or a recommendation trigger) for leaves that parse peer/user input: enumerate every
sink (message, `cause`, summary, log, serialized error) and require each to be allowlist-projected, with an
acceptance that plants a sentinel in every input position and asserts it never appears.
**Root cause:** `references/review.md` — the lenses are a fixed generic set (behaviour change, discrimination, dry-run) not derived from the design's risk surfaces, so where untrusted input reaches errors, logs or disk is never asked.

Additional evidence 2026-10-01 (Claude I15 audit, `docs/rpc/audit-m1/i15-plugin-out.txt` P7): the persisted process
descriptor (R7) stores `env.set.API_TOKEN=…` and `args --token=…` literally, because its secret check matches only the
literal key `token` at any depth. That check also wrongly rejects legitimate features, methods or plugins named
`token`. Untrusted or secret values flowing to disk belong to the same missing lens. The user ruled that the env
descriptor stores references only.

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

## OD-100 timing gates are "isolated" from other test files but not from host load, so moved benches still fail

Observed 2026-10-01 (Claude I15 audit, migai): after K167, K174 and K199 moved wall-clock ratio oracles out of the
default suites into dedicated serial bench scripts, which is what OD-69 / `SDD_V2_TIMING_ORACLE_UNISOLATED` asks for,
the benches still failed on the same machine under load 16–20. `bench:mutation` gave PHV3-T10 ratios of 10.28, 10.92
and 10.97 against a limit of 10; `bench:resume` gave 2.80 against a limit of 2. Evidence: `docs/rpc/audit-m1/i15-gate-ph-bench-mutation*.log`,
`i15-gate-cap-bench-resume.log`; ledger K199. A wall-clock threshold judged in a single run on a shared host is
non-deterministic, whatever the file isolation.
Why missed: `scripts/validator/domain/v2-scope.ts:189-195` accepts any "dedicated serial script or project" as
isolated, and `references/v2-authoring.md:46` says the same. Nothing asks the oracle to state a noise protocol: warm-up,
repetitions, the statistic, and what happens when the host is loaded.
Needs: a timing oracle must declare its noise protocol: repetitions and statistic (median of N runs, or a ratio
computed inside one run on interleaved sizes), and a host-load guard that reports ERROR (environment), not FAIL, when
the host is not idle. Gates must not run timing oracles in parallel with other gates.
**Root cause:** `scripts/validator/domain/v2-scope.ts` — the timing rule treats file isolation as sufficient and assumes one wall-clock run is deterministic; it never asks the oracle for a noise protocol.

## OD-101 no lens asks whether an old handle still has authority after replacement or a new generation

Observed 2026-10-01 (Claude audits of migai I13 `rpc-remote` and I15 `rpc-process-plugin`): three product defects
shared one shape. In each, a reference obtained before a replacement or generation change kept acting with the old
authority:
- I13 P1: the proxy bound to a departed generation and stayed ready;
- I13 P5: stale per-connection Host handles leaked `PLUGIN_NOT_INSTALLED` instead of `REMOTE_CLOSED`;
- I15 R8: after start-then-switch, the old definition could still call `replace()` and swap out the live
  registration, including one with the same name that it did not own.
All three SDDs passed review and every check. Their §5 lifecycle sections listed close/dispose races, but none
stated what an old handle may do after the thing it pointed to was replaced. Evidence:
`docs/rpc/rpc-program.claude-*` audit notes, `docs/rpc/audit-m1/i13-audit-probe.test.ts` P1/P5,
`docs/rpc/audit-m1/i15-plugin-out.txt` P4.
Why missed: `references/review.md:11-35` has no lens on handle authority across replacement or generations.
`SDD_V2_STATE_SPACE_UNSTATED` (`references/v2-authoring.md:46`) covers new status vocabularies, not the validity of
references held across a state transition, and `FAILURE_CLAUSE_UNBOUND` only binds clauses that were written.
Needs: when an SDD defines replace/restart/generation/re-adopt operations, require a "stale reference" table. It lists
every handle or definition a caller can hold, by operation, after each transition: its allowed operations, the error
it gets, and the acceptance that proves it. Review then asks for the old-handle case of each mutating operation.
**Root cause:** `references/review.md` — the same fixed lens set: no lens is derived from state transitions, so what an old handle may do after replacement or a new generation is never asked.
