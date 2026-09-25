# Repository presets and `init`

A repository adapts this skill without editing it through `.create-sdd/preset.json` (spec-kit's presets). `validate`, `init` and convergence read it from the resolved repository; a malformed preset is reported as `SDD_V2_PRESET_INVALID` and ignored.

```json
{
  "protocol": "create-sdd-preset/v1",
  "principles": ["AGENTS.md", ".specify/memory/constitution.md"],
  "sections": { "feature": ["Security Review|安全评审"], "bug": ["Rollback"] },
  "blocking_candidates": ["SDD_V2_PATH_GIT_IGNORED"],
  "runners": { ".ts": ["pnpm", "vitest", "run", "{oracle}"] },
  "templates": { "feature": "docs/templates/feature.sdd.md" }
}
```

- `principles`: files every SDD must list in `principles` (and therefore check under `## Principle Check`); a missing one is `preset-principle-missing`.
- `sections`: headings each kind (`feature`, `bug`, `program`; `assessment` for templates) must contain; alternatives are joined by `|`. A missing one is `preset-section-missing`.
- `blocking_candidates`: advisory candidate codes this repository treats as blockers; each hit becomes `SDD_V2_PRESET_BLOCKED`.
- `runners`: the replay command per oracle extension; `{oracle}` is the only substitution. Without one, replay derives the runner (`bun test`, `vitest`, `jest`, `pytest`, `go test`).
- `extends`: shared packs, applied before the repository's own entries (see below).
- `templates`: repository skeletons `init` writes instead of the built-in ones; `{{id}}` is substituted. A template must carry a recognised index block; `init` refuses one that does not.

## Sharing a preset

`bun <create-sdd-root>/scripts/preset.ts pack --repository <root> --out <dir> [--name <n>] [--version <v>]` writes a pack: `pack.json` with the preset's merged rules and the templates it names under `templates/`. Another repository vendors the directory (for example as `.create-sdd/packs/security`) and lists it in its own preset: `"extends": [".create-sdd/packs/security"]`. Packs apply first; the repository's lists add to theirs and its runners and templates override theirs. A missing or malformed pack is `SDD_V2_PRESET_INVALID`, and nothing is applied.

## `init`

`bun <create-sdd-root>/scripts/init.ts --kind feature|bug|assessment|program --out <absolute .md> [--id <id>] [--repository <root>]` writes a skeleton the validator accepts: IDs anchored in prose, a derived Meta graph, `oracles`, preset principles and sections, and the open decision `D1`. `D1` keeps it at `AWAITING_USER` until the author replaces the placeholders, so a skeleton can never be handed to a host as a design. `program` writes the root and its first child, linked both ways. `--kind evidence --sdd <leaf> --out <report.json>` writes the `sdd-evidence/v1` report a host fills in after implementation, one row per acceptance with the replay runner prefilled. Every file is validated in memory first; if any would not validate (a malformed preset, or a template without a recognised block), nothing is written and `init` fails with `INIT_PREFLIGHT_FAILED`, so a corrected retry is never blocked by a half-written skeleton. Existing files are never overwritten. `--branch [name]` creates and switches to a branch (default `sdd/<id>`) after every check passed and before any file is written; an existing branch stops `init` with nothing written. `--oracle-stubs` also writes a failing test for every declared oracle that does not exist yet, using the repository's runner (bun, vitest, jest or pytest), so the baseline fails as convergence requires; `--kind oracles --sdd <leaf>` does the same for an existing SDD once its real oracles are named.
