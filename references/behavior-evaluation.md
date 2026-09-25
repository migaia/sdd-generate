# Behavior evaluation

Use this reference only when changing `create-sdd` policy or investigating a demonstrated Skill-behavior failure. It does not alter normal SDD structure.

## Evidence levels

- `report`: sanitized request, proposed action, expected decision, and reason.
- `trace`: report plus starting state, decisive evidence, and event sequence.
- `repro`: pinned public repository or minimal fixture with repeatable checks.
- `paired-eval`: isolated comparison with executable task-completion and counterexample checks.

Do not promote a report or one successful trace into a universal hard rule. A controller-enforced rule needs at least a reproducible minimal contrast; an effectiveness claim needs paired evaluation.

## Minimal contrast

Every policy change names one case in `cases/behavior-cases.json`. The Bad and Good arms keep the task shape stable and change one decisive fact. Passing means:

1. the Bad action is rejected, deferred, or escalated as expected;
2. the Good action remains allowed;
3. the requested result still completes;
4. no new prompt, retry, successor, or authorization loop appears.

File count, diff size, token count, elapsed time, and failure count are observations, not authority evidence.

## Evaluation arms

- `stable`: currently released Skill and controller.
- `candidate-skill`: candidate Skill text with the stable controller.
- `candidate-full`: candidate Skill text and candidate controller.

Run each Bad/Good arm in a fresh isolated workspace with pinned model, reasoning effort, permissions, repository revision, and applicable instructions. Keep infrastructure failures, negative results, and null results. All Good cases must complete before claiming improvement. The sibling loop Skill provides a dry-run plan generator; it never starts paid sessions itself.

## Pressure scenarios and rationalizations

A rule that agents skip under pressure needs a pressure scenario, not more emphasis:

1. Run the Bad arm without the new guidance under realistic pressure (time, sunk cost, a plausible shortcut) and record the exact rationalization the agent used.
2. Write the smallest guidance that answers that rationalization; match the form to the failure: a prohibition with the rationalization and its rebuttal for skipped rules, a positive recipe for wrong output shape, a required-field template for omissions, and a condition on an observable predicate for context-dependent behavior.
3. Rerun both arms; a new rationalization becomes the next case rather than a longer paragraph.

Loop retrospectives (`evolution-digest` `trace` proposals targeting create-sdd) are the preferred source of Bad arms: they carry cited delivery evidence.

## Who owns this format

`skill-behavior-cases/v1` is defined here and implemented by `scripts/behavior-eval.ts` in this
skill: the format's definition and its implementation live in the same place on purpose.

## Mechanical defect cases

A defect case is decided by running one command and comparing the codes it reports: no agent, no
judge, no credits. `bun <create-sdd-root>/scripts/rsi.ts suite` runs them all; `cases/defect-cases.json`
holds them. Each one names a fixture where the code must fire and a repaired fixture where it must
not, and the second half is what makes a pass mean anything — a detector that fired on everything
would satisfy the first half alone.

Most fixtures are the worked example with one thing changed, written as an overlay rather than a
copy. A hand-written pair of five-hundred-line documents drifts apart in a dozen incidental ways and
then a pass no longer says which difference mattered; an overlay on a shared base cannot.

For a mechanically decided case, **optimising for the test and fixing the defect are the same
action**. That is the whole reason to prefer them: reward hacking needs somewhere to hide, and a
comparison of code sets offers nowhere. Behaviour cases, which need a judge, keep a weaker evidence
level for exactly the same reason.

## The improvement loop and what it can enforce

`rsi.ts open → baseline → evaluate → prune → close` runs one change per round. Its guards differ in
strength and the difference is stated here rather than implied:

| Mechanism | Strength |
|---|---|
| Previously passing cases stay passing in improvement, budget-change and consolidation rounds (`evaluate`) | Real, and needs no trust: a rule relaxed to admit a new case breaks an old one immediately |
| sha256 commitments taken at `open` over every case file | Real: a change becomes visible in the round record |
| `evaluate` refuses when the round's diff weakens a detector's expected code or a completion oracle | Real, and it reads untracked files too — reading only the diff once let a round edit an expected code unnoticed |
| Held-out cases under `cases/held-out/` | Real as detection, **not** as prevention |
| An improvement round may not amend a frozen case; a clean `--kind case-amendment` round is `RECORDED` | Real that changing the target cannot earn an `ACCEPTED` repair; whether the amendment is honest is a human judgement |
| "The improver does not read the held-out set" | **Convention only.** Same machine, same permissions, no sandbox. Do not describe it as enforced |
| Sandboxing or a read-only mount | **Not provided.** A published self-improving system has been observed hacking its own reward function and fabricating logs, so this gap is real and is recorded rather than papered over |

`prune` is not optional. An addition must name what it supersedes or say why it supersedes nothing
(`rsi/supersession.json`), and six measured ceilings in `rsi/budget.json` bound SKILL.md, the
references, the validator, scripts, tests and the behaviour-case count. A ceiling moves only in a `--kind
budget-change` round, so every raise is a decision somebody made rather than a drift nobody saw.

Defects observed in real runs queue in `rsi/observed-defects.md`. Each update settles every queued entry inside a round (`rsi.ts settle`: a detector names its frozen case, or a ruling or rejection says why not); `close` archives the settled text into the round record and drains the queue, and `health` reports `unsettled_observations` until it is empty.

Only an `improvement` round with a changed source version and a failing frozen case repaired can
close as `ACCEPTED`; closing reruns the same candidate and held-out cases. Clean maintenance rounds
close as `RECORDED`.

## What a green round does not prove

That the change improved anything outside the mechanical cases. That an authoring agent reads,
understands or follows any rule involved. That nobody could have edited a case — only that the edit
would show.
