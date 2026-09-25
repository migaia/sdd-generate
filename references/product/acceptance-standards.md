# Acceptance standards

Load for every implementation SDD together with the platform and language guides. An acceptance case is an executable falsifier of one claim. It is written before implementation, runs inside the loop's limits and fails when the claim is false.

## Anatomy of an acceptance case

| Field | Standard |
| --- | --- |
| Claim | one observable behavior bound to requirement IDs; never "works", "is fast" or "looks good" |
| Method | the cheapest existing command that observes the claim, with exact arguments, run through the package manager the target package declares for itself — never the one the repository root uses. For a `mechanical` or `differential` oracle this field **is** the command: the loop binds argv to it and an execution authorization may name nothing else, so a sentence describing what to check is refused as `ACCEPTANCE_METHOD_NOT_EXECUTABLE` and, before that, is offered to the user as the command they are being asked to permit. Prose belongs to a `judgment` oracle, next to the criteria its reviewer applies |
| Environment | runtime and version, device or simulator and OS/API level, browser, data fixture, network condition |
| Oracle | the precise pass condition: exit code, asserted value, schema, threshold with unit, empty diff |
| Oracle kind | `mechanical` (decidable from exit code or asserted output), `judgment` (explicit criteria plus the evidence the judge records), or `differential` (the command is expected to stay red for what a declared baseline holds; the verdict is the empty difference against it) |
| Baseline | required for a `differential` oracle: where the baseline observation lives, and what an identity is (for a type check: file, expression and code — never the error count) |
| Sensitivity | the mutation or baseline state under which the oracle fails (proves it can detect the defect) |
| Packages | only the packages the oracle observes |
| Timeout | at most 900 seconds; budget counted in the batch's `test_budget` |
| Evidence | the artifact kept: command output tail, report file, size listing, benchmark comparison, persisted in the SDD's evidence companion |

## Standard oracles by quality dimension

| Dimension | Default oracle (replace with repository or product thresholds when they exist) |
| --- | --- |
| Correctness | unit or contract tests naming the claim; property tests for invariants over input ranges |
| Journeys | one UI or end-to-end test per named journey, on a named device or browser |
| Compatibility | the same case on the lowest and highest declared runtime, OS or API level |
| Accessibility | WCAG 2.2 AA: text contrast ≥ 4.5:1 (3:1 large text), every control labeled, focus order and keyboard or switch access, font scaling to the declared maximum without clipping |
| Web performance | Core Web Vitals at p75 on the declared device profile: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; page weight budget for reading pages |
| Mobile and mini-program performance | cold start and first meaningful screen within the declared budget on a named low-end device; package or binary size within budget |
| Service performance | latency percentile and throughput for a stated workload against a stored baseline |
| Security | negative tests for authorization and input validation; secrets absent from built artifacts; dependency audit clean |
| Privacy | collected data matches the store or platform declaration; permission-denied paths render their fallback |
| Resilience | offline, timeout, retry and process-death cases for flows that persist user work |
| Documentation | generated reference documents match core metadata (empty regeneration diff) |
| Release readiness | build, sign or package command succeeds for each shipped target; size and review checklist evidence |

## Platform and language guides

Commands, tools and platform oracles live in each guide: [platforms](platforms.md), [mini program](platforms/mini-program.md), [native mobile](platforms/mobile-native.md), [Flutter](platforms/flutter.md), [HarmonyOS ArkTS](platforms/harmonyos-arkts.md), [desktop](platforms/desktop.md), [native SDK](platforms/native-sdk.md), [JVM](languages/jvm.md), [Rust](languages/rust.md), [Go](languages/go.md), [Python](languages/python.md), [Bun and Node](languages/bun-node.md), [core and adapters](architecture/core-adapters.md).

## The method must be unable to pass on nothing

A command's exit code answers "did the run fail?", never "was anything observed?". A name-filtered
test run that matches no case, a suite whose files were all skipped, a linter given no input and a
query returning an empty set all exit 0. An acceptance whose method can exit 0 without observing
its claim is not a falsifier: deleting the case restores a green result, so the case cannot detect
the loss of the coverage it exists to assert.

Write the method so that absence fails, and verify that it does before admitting it. Runner flags
are usually not enough: Vitest's `--passWithNoTests=false` governs whether any test *file* was
collected, so a name filter matching nothing inside a file that was collected still exits 0. The
reliable form asserts the observed count. Emit machine-readable results and check them, for example
`vitest run … --reporter=json` piped into a check that the passing count is the expected one and the
failing count is zero. State in the Oracle field what a zero observation looks like and why it
cannot be mistaken for a pass.

The decisive check needs no knowledge of the runner: an acceptance whose sensitivity declares
`implementation_timing: IMPLEMENTATION_REQUIRED` must **fail** when run before its implementation
exists. Run it then and record the result. A pre-implementation PASS means the oracle is insensitive
and the case is decorative, whatever its assertions say. The delivery loop enforces this at its SHIP
gate (`ACCEPTANCE_ORACLE_INSENSITIVE`), reading the signed runs already in its journal, so a case
that slips past the authoring warning is still caught before anything ships.

## Two cases never share an identity

Each case's `execution.evidence_boundary` must be unique across the whole contract; the validator normalizes the string before comparing, so "its own test result" written twice is one identity, not two (`ACCEPTANCE_EVIDENCE_BOUNDARY_DUPLICATE`). Name the artifact the case actually leaves — the package and file whose result it is — instead of a sentence that would fit any case.

An `INDEPENDENT` case also owns its target: the `[method, environment]` pair must be unique (`ACCEPTANCE_INDEPENDENT_TARGET_REUSED`). Two claims that would run the same command in the same environment are either one claim, or two claims needing two narrower commands. Finding the collision late usually means a claim was written too broadly — split the claim, do not widen the command to make it look different.

## Sizing to the loop

- One claim per case; a journey is split at its natural checkpoints when the whole run would exceed the timeout.
- Device farms, full cross-browser matrices, long soak tests and fuzzing campaigns are design probes or release gates outside a batch, recorded with their evidence, never an unbounded per-batch test.
- Visual taste is not an oracle. Tokens, measured spacing, contrast, layout at breakpoints and golden images of token-driven components are.

## Anti-patterns

- "Manually verified on my phone" without device, OS, steps and observed result.
- Coverage percentage as the acceptance of a behavior.
- A performance claim without workload, environment and baseline.
- A filtered test command whose runner treats "matched nothing" as success.
- One end-to-end test standing in for every requirement.


## Boundaries on the oracle itself

An oracle's guarantee is the drift it can actually detect, and saying so is part of writing it. A
comparison built on the shapes a repository's own formatter produces detects the drift that
repository can produce — write that boundary down rather than growing the oracle toward "any
possible declaration". A parser nobody trusts is worse than a narrow check whose limit is stated.

The same restraint applies to the checks in this skill: the authoring-time patterns are an early
warning whose guarantee lives elsewhere, and a boundary recorded honestly outranks coverage claimed
loosely.
