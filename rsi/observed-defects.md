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

## OD-87 completion preflight overwrites the start report, so base-red evidence disappears

Observed 2026-09-29 (codex, migai `pipeline-internal-cleanup`, `plugin-host-async-prepare`): the host ran preflight
before implementation (base RED / candidate PASS) and again at completion; the completion run rewrote the single
report file, and `validate` then reported `change-base-uncovered` for acceptances whose base failure had been
shown only in the overwritten report. For `plugin-host-async-prepare` the host never ran the base oracles at all
and still marked the leaf verified, because nothing distinguishes "base red proven earlier" from "never proven".
A fix would keep the start report (or its base-red receipts) alongside the completion report and let closure
read both.
**Class:** blast-radius

## OD-88 step gates cover only the touched package, so consumer-graph gates go red between commits

Observed 2026-09-29 (codex, migai I6–I8, 15 commits across `guarded-property-read`, `abort-reason-read`,
`pipeline-internal-cleanup`, `plugin-host-async-prepare`): each step ran the gates of the package it changed and
passed, while `packages/rpc` A9 (root bundle size, a direct-consumer gate) was red at those commits and only
fixed later by a threshold adjustment. The leaves listed rpc as a direct consumer but their step gates did not
include its bundle check. A detector would require every step that changes a package in a consumer's retained
graph to run that consumer's declared scaling gates.
**Class:** gate-scope

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
**Class:** feasibility

## OD-90 `expect:"fail"` counts any non-zero exit as RED, so prep, install, build and import failures pass

Observed 2026-09-30 (Claude delta reviews A-2/A-6/A-7/A-15 and B F2/F4/F9 on 11 rpc leaves; ledger K161/K162):
base-RED items passed because the copy lacked a fresh dist (`withDistFreshness` throws `DIST_STALE`), a new module
failed to import, or the discriminator itself threw and exited 1. Every leaf had to hand-roll a Vitest-JSON
discriminator wrapped in `try{…}catch{process.exit(0)}` (root X14 rules 1–2) to make "red" mean an assertion failure.
Why missed: `scripts/preflight.ts:144` judges `expect:"fail"` as `run.exitCode !== 0`; the result records only exit
and a 240-char tail (`:145-158`). The OD-44 shared-cause detector exists only for `--evidence` closure
(`scripts/validator/domain/v2-closure.ts:206-278`), not for preflight reports, so it never fired here.
Needs: a fail item states what must fail (the acceptance ID marker, or an assertion-failure pattern) and the runner
checks it; an exit with no matching marker, a signal, or a failure before any test ran is ERROR, not PASS. Reuse the
closure's shared-baseline rule across items of one report.
**Class:** feasibility

## OD-91 `--only` reruns mark un-run items ERROR or silently keep stale ones, so no clean completion record exists

Observed 2026-09-30 (codex, migai I12 `rpc-error-text-cleanup` completion, ledger K183; ipc P3 likewise): following
the OD-87 workaround (start report kept via `--out`, completion via `--only P4`), P4 passed but P0–P3/P5/P6 were
written as `ERROR "not run"`, status FAILED, exit 1; the separate report was not the default path, so `validate`
still said `SDD_V2_PREFLIGHT_REQUIRED`. Without `--out`, `--only` instead copies the start run's results into the
completion report under the new `repository_head`/`sdd_sha`, so start-time and end-time results are indistinguishable.
Why missed: `scripts/preflight.ts:191-194,211-223` fills unselected items from the previous report at `out` or with
ERROR, and `:224-240` stamps one head/dirty/digest for all items; `v2-preflight.ts:189-193,266-310` reads one report.
Needs: per-item run metadata (head, dirty, time, sdd digest) plus a "not selected" outcome that neither fails nor
passes, and a validator that accepts a start report + completion report pair (the OD-87 fix) as one record.
**Class:** blast-radius

## OD-92 a preflight report is not bound to the patch bytes it ran, so a PASS cannot be tied to its patch

Observed 2026-09-30 (codex/Claude, migai I10 `rpc-handshake-redaction` evidence custody): the default report was
written 08:56 with P0–P5 PASS for `red`/BC1/BC2 patch paths whose files are dated 09:07; at 09:23 the host renamed and
aggregated reports into `…preflight.start.json`/`start-failed.json` after the implementation commits. Nothing in any
report proves which patch bytes produced the PASS; custody had to be rebuilt by SHA256 and `cmp` against commits.
Evidence: `docs/rpc/rpc-handshake-redaction.sdd.md` §8 row "证据保管时间与补丁身份", revision 4 Clarifications.
Why missed: `scripts/validator/domain/v2-preflight.ts:65-67` digests only the declared items and `writes` (patch
*path*, not content), `:285-288` therefore never stales on a patch edit, and `scripts/preflight.ts:227-240` records no
patch hash, run time or input hash, so reports are freely renameable and mergeable (OD-87's overwrite is one case).
Needs: record each item's patch/inputs SHA and run time in the result, include patch content in `inputs_sha`, and
have `validate` recompute patch hashes and report a mismatch as STALE.
**Class:** blast-radius

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
**Class:** blast-radius

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
**Class:** gate-scope

## OD-95 claims about an implemented dependency's API are never checked against its public exports or behaviour

Observed 2026-09-30 (codex, migai I13 `rpc-remote`; ledger K184/K185/K187, impl log "S2 预查"): the frozen leaf
required (a) a JSON Schema 2020-12 constraint that key equals `value.plugin`, which the dialect cannot express;
(b) a stream-open `IRpcContext`, but `IRpcStreamRun` received only `{signal}`; (c) a trusted-plugin check via
`readDefinedPluginDefinition`, exported only inside `packages/plugin-host/src/define-plugin.ts:366`, not from the
package entry; (d) plugin name `migaia.remote.serve#`, which `definePlugin` rejects (dots). Each stopped
implementation after two design review rounds; (b) and (c) forced public API changes in other packages.
Why missed: `scripts/validator/domain/v2-symbols.ts:78-98` accepts a symbol defined anywhere in the workspace (OD-74
fallback) without checking it is reachable through the owning package's `exports`; `type-probe.ts` compiles only the
SDD's own exported fences; preflight is required only for BCs, program `consumes` and scaling gates
(`v2-preflight.ts:113-120,257-259`), and cross-program/standalone producers must keep `consumes` empty (OD-85), so
no feasibility item ever calls the dependency.
Needs: resolve each step's imported symbol through the dependency's package entry/exports and report internal-only
hits; type-check declared calls against the real dependency types; require a preflight item for each stated
external capability or constraint (name format, schema keyword) the design depends on.
**Class:** feasibility

Additional evidence 2026-10-01 (I16 `rpc-process-resilience`, ledger K207): the start-of-leaf API check verified
`pending.accept` and the existing channel offer but not the offer built inside the opaque client
`IProcessPluginEstablish` closure (`packages/rpc/test/process/plugin-native.test.ts:94-107`,
`src/process/plugin/types.ts:34-69`). Resilience A5 needs to audit the offer before spawn/dial, so S2 stopped. A claim
check must follow values that a dependency builds inside caller-supplied callbacks, not only the declared signatures.

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
**Class:** gate-scope

Additional evidence 2026-10-01 (Claude I15 audit, `docs/rpc/audit-m1/i15-plugin-out.txt` P7): the persisted process
descriptor (R7) stores `env.set.API_TOKEN=…` and `args --token=…` literally, because its secret check matches only the
literal key `token` at any depth. That check also wrongly rejects legitimate features, methods or plugins named
`token`. Untrusted or secret values flowing to disk belong to the same missing lens. The user ruled that the env
descriptor stores references only.

## OD-97 a failed preflight item keeps a 240-character tail and no log, so hosts misattribute the failure

Observed 2026-10-01 (codex, migai rpc I15 `rpc-process-plugin` start preflight): P2 failed twice. The report reason
held only the last lines, so the host first suspected an unrelated PluginHost timing flake (PHV3-T10, seen in a
separate custody run) and stopped the leaf. The real cause, found only after re-running the command by hand and
saving the full output (`docs/rpc/scratch/k198-p2-full.log`), was a coverage-custody total drift: rpc functions went
2017→2018 after an interstitial commit (`7a95436`, K197) and the baseline had not been re-signed (ledger K198).
Why missed: `scripts/preflight.ts:145-158` keeps `slice(-3)` lines of stderr-or-stdout, cut to 240 characters, as
`reason`. The full output is discarded, and stdout is dropped whenever stderr is non-empty. A multi-gate item (fmt →
lint → … → custody) whose failing gate prints early cannot be attributed from its report.
Needs: write each item's full stdout and stderr to a log file next to the report, recorded by path and hash in the
item result, and name the first failing sub-command when the item is a `&&` chain. Related: OD-90 (what counts as
RED) and OD-92 (run identity) need the same per-run artifact.
**Class:** feasibility

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
**Class:** gate-scope

## OD-99 new detectors are never swept over delivered or legacy SDDs, so known-bad oracles keep failing downstream

Observed 2026-09-30/10-01 (codex, migai): three timing-ratio flakes in default test suites stopped unrelated leaves:
- K167, capability A17;
- K174, plugin-host A18/A27;
- K199, plugin-host PHV3-T10, ratio 11.5–12.5 against a limit of 10 under load.
Each was fixed by hand, by moving the ratio to a bench script.
Re-running `validate` today gives `SDD_V2_TIMING_ORACLE_UNISOLATED` on `docs/capability/capability-dependency-planner.sdd.md`
and `docs/plugin-host/plugin-host-r3.sdd.md`. Both are delivered leaves whose oracles predate OD-69, and nobody
re-validated them after the detector landed. PHV3-T10 lives in `docs/plugin-host/plugin-host-v3.sdd.md`, a legacy
v1-format document that the v2 detector never sees.
Why missed: `scripts/validator/domain/v2-scope.ts:189-195` (OD-69) runs only when a document is validated. RSI rounds
that add a detector do not sweep existing documents, and the legacy route does not apply v2 quality checks.
Needs: when a round adds or tightens a detector, run it across the repository's SDDs (`validate` over `docs/**`) and
report the hits as follow-up debt with owners. For legacy documents, run at least the timing-isolation and
scaling-oracle checks as a lint over their acceptance tables.
**Class:** blast-radius

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
**Class:** feasibility

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
**Class:** feasibility
