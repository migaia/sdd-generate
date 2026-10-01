import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { V2Result } from './v2-document.ts'
import { list, object, text, type Item, type Report } from './v2-meta.ts'
import { loadPreset } from './v2-preset.ts'
import { TEST } from './v2-readers.ts'
import { replay, scriptRunner, type Oracle, type Replay } from './v2-replay.ts'
import { stepRecords } from './v2-tasks.ts'

/**
 * Convergence status. `CLOSED`: every must-ship acceptance has a PASS with evidence against the
 * current revision. `FAILED`: some result is FAIL, so the SDD or the implementation must change.
 * `OPEN`: anything else missing, stale or blocked.
 */
export type ClosureStatus = 'CLOSED' | 'OPEN' | 'FAILED'

/**
 * Compare a host's evidence report (`sdd-evidence/v1`, kept outside the SDD) with one leaf's
 * acceptance: spec-kit's converge, made mechanical. The report names the SDD id and revision it
 * ran against and one `{acceptance, status, evidence}` row per case. A path-like `evidence` must
 * exist in the repository; a URL or free text is taken as written.
 */
/** Whether `ref` names a commit in `repository`; read-only `git cat-file`. */
const commit = (repository: string, ref: string) =>
  Bun.spawnSync(['git', '-C', repository, 'cat-file', '-e', `${ref}^{commit}`]).exitCode === 0

/**
 * How strongly one PASS row proves behaviour. `verified`: the same `command` failed at `baseline`
 * and passed at `commit`, both commits exist and the baseline is an ancestor (checked with
 * read-only git). `claimed`: a FAIL-then-PASS pair with the command but without checkable commits.
 * `none`: a PASS alone, which may never have been able to fail. A `preserved` case (OD-35) holds
 * before and after by design, so its baseline must PASS instead of FAIL.
 */
function proofOf(
  row: Item,
  repository: string | null,
  preserved: boolean
): { level: string; reason?: string } {
  const base = object(row.baseline) ? row.baseline : null
  const expected = preserved ? 'PASS' : 'FAIL'
  if (!text(row.command) || !base || base.status !== expected || !text(base.evidence))
    return { level: 'none', reason: `no ${expected} baseline run of the same command` }
  if (!text(row.commit) || !text(base.commit)) return { level: 'claimed' }
  if (!repository || !commit(repository, row.commit) || !commit(repository, base.commit))
    return { level: 'none', reason: 'baseline or change commit not found' }
  const ordered = Bun.spawnSync([
    'git',
    '-C',
    repository,
    'merge-base',
    '--is-ancestor',
    base.commit,
    row.commit
  ]).exitCode
  return ordered === 0 && base.commit !== row.commit
    ? { level: 'verified' }
    : { level: 'none', reason: 'baseline is not an earlier commit of the change' }
}

/** The declared oracle for one case: a test path, or a bounded command `{script, exists|stdout}`. */
export function oracleOf(index: Item, id: string): Oracle | null {
  const value = object(index.oracles) ? index.oracles[id] : undefined
  if (text(value)) return value
  if (object(value) && text(value.script) && text(value.exists) !== text(value.stdout))
    return value as Oracle
  return null
}

/**
 * Why a PASS row does not show its oracle ran, or null. A test file must be in the command and
 * name the case; a command oracle must be exactly the derived script command and the row must
 * record what was observed.
 */
function unlinked(oracle: Oracle, id: string, row: Item, repository: string | null): string | null {
  const command = String(row.command ?? '').trim()
  if (typeof oracle !== 'string') {
    const expected = scriptRunner(repository ?? '.', oracle.script).join(' ')
    if (command !== expected) return `command is not ${expected}`
    return text(row.observed) ? null : 'no observed result recorded'
  }
  // A command may run the oracle from its package (`--filter ./pkg`, `--dir pkg`, `-C pkg`,
  // `cd pkg`) with a package-relative path (OD-76).
  const packages = [
    ...command.matchAll(
      /(?:--filter[= ]|--dir[= ]|--prefix[= ]|-C\s+|\bcd\s+)["']?\.?\/?([\w@./-]+)/g
    )
  ].map((match) => match[1]!.replace(/\/$/, ''))
  const runs =
    command.includes(oracle) ||
    packages.some(
      (dir) => oracle.startsWith(`${dir}/`) && command.includes(oracle.slice(dir.length + 1))
    )
  if (!runs) return `command does not run ${oracle}`
  const path = repository ? resolve(repository, oracle) : null
  if (path && !(existsSync(path) && new RegExp(`\\b${id}\\b`).test(readFileSync(path, 'utf8'))))
    return `${oracle} does not name ${id}`
  return null
}

/** The steps that close an acceptance, or else the implementation steps of the requirements owning it. */
function closingSteps(index: Item, id: string) {
  const records = stepRecords(index).records
  const steps = records.filter((record) => record.closes.includes(id))
  if (steps.length) return steps
  const owners = new Set(
    list(index.requirements).flatMap((r) =>
      object(r) && list(r.acceptance).includes(id) ? list(r.implementation) : []
    )
  )
  return records.filter((record) => owners.has(record.id))
}

/** Files a change must touch for this acceptance to flip: its closing steps' touches and Assets. */
function implementing(index: Item, result: V2Result, id: string): string[] {
  const steps = closingSteps(index, id)
  const assets = (result.handoff.execution_slice?.produced_assets ?? []).map((asset) => asset.path)
  return [...new Set([...steps.flatMap((step) => step.touches), ...assets])]
}

/** Paths changed between two commits, with `D` marking deletions. */
function changes(repository: string, base: string, head: string): Map<string, string> {
  const diff = Bun.spawnSync(['git', '-C', repository, 'diff', '--name-status', base, head])
  return new Map(
    diff.stdout
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [kind = '', ...paths] = line.split('\t')
        return [paths.at(-1)!, kind[0]!] as const
      })
  )
}

/** The `test(...)`/`it(...)` titles of one file at one commit. */
function titles(repository: string, at: string, path: string): Set<string> {
  const source = Bun.spawnSync(['git', '-C', repository, 'show', `${at}:${path}`]).stdout.toString()
  return new Set(
    [...source.matchAll(/\b(?:test|it)(?:\.\w+)?\(\s*(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2]!)
  )
}

/** Whether any changed path is one of `files` or lies under one of them. */
const touched = (changed: ReadonlyMap<string, string>, files: readonly string[]) =>
  [...changed.keys()].some((path) => files.some((f) => path === f || path.startsWith(`${f}/`)))

/** The single commit every row names, when the report is consistent about it. */
const only = (values: readonly unknown[]) => {
  const set = new Set(values.filter(text))
  return set.size === 1 ? ([...set][0] as string) : null
}

export function checkClosure(
  result: V2Result,
  index: Item,
  evidence: unknown,
  repository: string | null,
  options: Readonly<{ replay?: boolean }> = {}
) {
  const findings: { code: string; message: string }[] = []
  const report: Report = (code, detail, subtype) =>
    findings.push({ code, message: subtype ? `${subtype}: ${detail}` : detail })
  const input = object(evidence) ? evidence : {}
  if (input.protocol !== 'sdd-evidence/v1' || !Array.isArray(input.results))
    report('SDD_V2_CLOSURE_OPEN', 'not sdd-evidence/v1', 'evidence-invalid')
  else if (input.sdd !== index.id || input.revision !== index.revision)
    report(
      'SDD_V2_CLOSURE_OPEN',
      `${String(input.sdd)}@${String(input.revision)} != ${String(index.id)}@${String(index.revision)}`,
      'evidence-stale'
    )
  const required = new Set(
    list(index.requirements).flatMap((value) =>
      object(value) && value.kind === 'must-ship' ? list(value.acceptance).filter(text) : []
    )
  )
  const known = new Set(list(index.acceptance).filter(text))
  // One row per acceptance: a repeated ID is ambiguous (FAIL then PASS must not close by order),
  // so it blocks and neither row counts.
  const rows = new Map<string, Item>()
  const repeated = new Set<string>()
  for (const row of list(input.results))
    if (object(row) && text(row.acceptance)) {
      if (!known.has(row.acceptance))
        report('SDD_V2_CLOSURE_OPEN', row.acceptance, 'evidence-unknown-acceptance')
      else if (rows.has(row.acceptance)) repeated.add(row.acceptance)
      else rows.set(row.acceptance, row)
    }
  for (const id of repeated) {
    rows.delete(id)
    report('SDD_V2_CLOSURE_OPEN', id, 'evidence-duplicate')
  }
  const passRows = [...rows.values()].filter((row) => row.status === 'PASS')
  const head = only(passRows.map((row) => row.commit))
  const base = only(passRows.map((row) => (object(row.baseline) ? row.baseline.commit : null)))
  const changed =
    repository && head && base && commit(repository, head) && commit(repository, base)
      ? changes(repository, base, head)
      : null
  const replays: Replay[] = []
  const status = new Map<string, string>()
  const unsupported = new Set<string>()
  const proof: { acceptance: string; level: string; reason?: string }[] = []
  const regression = new Set(list(index.regression).filter(text))
  const preserved = new Set(list(index.preserve).filter(text))
  // One baseline failure shared by three or more cases proves the base did not build, not that
  // each case can fail (OD-44). Each such case needs its own perturbation or a proven replay.
  const said = (row: Item) =>
    object(row.baseline) && text(row.baseline.evidence)
      ? row.baseline.evidence.trim().toLowerCase().replace(/\s+/g, ' ')
      : ''
  const counts = new Map<string, number>()
  for (const row of passRows)
    if (required.has(String(row.acceptance)) && said(row))
      counts.set(said(row), (counts.get(said(row)) ?? 0) + 1)
  const shared = (row: Item) => (counts.get(said(row)) ?? 0) >= 3
  const perturbed = (row: Item) =>
    object(row.perturbation) &&
    row.perturbation.status === 'FAIL' &&
    text(row.perturbation.evidence)
  for (const id of known) {
    const row = rows.get(id)
    const value =
      row && ['PASS', 'FAIL', 'BLOCKED'].includes(String(row.status))
        ? String(row.status)
        : repeated.has(id)
          ? 'DUPLICATE'
          : 'MISSING'
    status.set(id, value)
    if (value === 'FAIL') report('SDD_V2_CLOSURE_FAILED', id, 'acceptance-failed')
    else if (value === 'PASS') {
      const ref = row!.evidence
      const local = text(ref) && !/^[a-z]+:\/\//i.test(ref) && !/\s/.test(ref) && ref.includes('/')
      if (!text(ref)) report('SDD_V2_CLOSURE_OPEN', id, 'pass-without-evidence')
      else if (repository && local && !existsSync(resolve(repository, ref)))
        report('SDD_V2_CLOSURE_OPEN', `${id}: ${ref}`, 'evidence-path-missing')
      else {
        const keep = preserved.has(id)
        const baseStatus = object(row!.baseline) ? row!.baseline.status : undefined
        // An honest PASS baseline is a classification question for the author, never a quiet pass.
        if (baseStatus === (keep ? 'FAIL' : 'PASS'))
          report(
            'SDD_V2_CLOSURE_OPEN',
            keep
              ? `${id}: listed in preserve, but its baseline failed`
              : `${id}: its baseline passed; list it in preserve or show a failing baseline`,
            'baseline-class-mismatch'
          )
        let found = proofOf(row!, repository, keep)
        // Causality: the flip must come from a change to the files that implement this case.
        const files = implementing(index, result, id)
        if (found.level === 'verified' && files.length && !keep) {
          const from = (row!.baseline as Item).commit as string
          if (!touched(changes(repository!, from, row!.commit as string), files))
            found = { level: 'none', reason: `change does not touch ${files.join(', ')}` }
        }
        // The declared oracle: every must-ship case needs one, and the host's row must show it ran:
        // a test file that names this case, or the bounded command with its observed result.
        const oracle = oracleOf(index, id)
        if (!oracle && required.has(id)) {
          report('SDD_V2_CLOSURE_OPEN', `${id}: declare its test in oracles`, 'oracle-required')
          proof.push({ acceptance: id, level: 'none', reason: 'no declared oracle' })
          unsupported.add(id)
          continue
        }
        const why = oracle ? unlinked(oracle, id, row!, repository) : null
        if (why) {
          report('SDD_V2_CLOSURE_OPEN', `${id}: ${why}`, 'oracle-unlinked')
          proof.push({ acceptance: id, level: 'none', reason: why })
          unsupported.add(id)
          continue
        }
        if (found.level !== 'none' && shared(row!) && !perturbed(row!) && !options.replay) {
          found = { level: 'claimed', reason: 'baseline evidence shared by several cases' }
          report(
            'SDD_V2_CLOSURE_OPEN',
            `${id}: its baseline failure is shared; add a perturbation run or --replay`,
            'baseline-shared'
          )
          unsupported.add(id)
        }
        proof.push({ acceptance: id, ...found })
        // Replay runs the declared oracle itself: base FAIL, head PASS, head without the change FAIL.
        // A preserved case has no flip to ablate.
        if (options.replay && required.has(id) && !keep) {
          const mine = closingSteps(index, id)
          const replayed =
            found.level === 'verified' && oracle
              ? replay({
                  repository: repository!,
                  acceptance: id,
                  oracle,
                  base: (row!.baseline as Item).commit as string,
                  head: row!.commit as string,
                  implementing: files,
                  steps: mine.map((step) => step.id),
                  others: stepRecords(index).records.filter(
                    (step) => !mine.some((m) => m.id === step.id)
                  ),
                  runners: loadPreset(repository)?.runners,
                  writes: list(index.writes).filter(text),
                  leaf: text(index.id) ? index.id : undefined
                })
              : null
          if (replayed) replays.push(replayed)
          if (replayed?.verdict !== 'proven') {
            const why =
              replayed?.reason ?? 'replay needs a verified proof with commits and an oracle'
            const kind =
              replayed?.verdict === 'environment-failed'
                ? 'replay-environment-failed'
                : 'replay-not-proven'
            report('SDD_V2_CLOSURE_OPEN', `${id}: ${why}`, kind)
            unsupported.add(id)
            continue
          }
        }
        // A regression case must show, with commits and the causal diff, that the fix made it pass.
        if (found.level === 'verified' || !regression.has(id)) continue
        report(
          'SDD_V2_CLOSURE_OPEN',
          `${id}: ${found.reason ?? 'a claimed proof has no commits to check'}`,
          'regression-unproven'
        )
      }
      unsupported.add(id)
    } else if (required.has(id))
      report('SDD_V2_CLOSURE_OPEN', id, value === 'BLOCKED' ? 'blocked' : 'evidence-missing')
  }
  // Converge: the delivered code must still match the design, not only the reported checks.
  // At the reported commit when the report names one, otherwise in the working tree.
  const present = (path: string) =>
    head && repository && commit(repository, head)
      ? Bun.spawnSync(['git', '-C', repository, 'cat-file', '-e', `${head}:${path}`]).exitCode === 0
      : !!repository && existsSync(resolve(repository, path))
  const promised = stepRecords(index).records.flatMap((step) =>
    step.touches.map((path) => ({ step: step.id, path }))
  )
  const gaps = [
    ...(result.handoff.execution_slice?.produced_assets ?? [])
      .filter((asset) => repository && !present(asset.path))
      .map((asset) => `asset ${asset.id} missing at ${asset.path}`),
    ...promised
      .filter(({ path }) => repository && !present(path) && changed?.get(path) !== 'D')
      .map(({ step, path }) => `step ${step} touches ${path}, which does not exist`),
    ...(changed
      ? list(index.requirements).flatMap((r) => {
          if (!object(r) || r.kind !== 'must-ship') return []
          const files = list(r.acceptance).flatMap((id) => implementing(index, result, String(id)))
          return files.length && !touched(changed, files)
            ? [`requirement ${String(r.id)}: no implementing file changed`]
            : []
        })
      : []),
    ...result.handoff.candidates
      .filter((item) => item.code === 'PSEUDOCODE_SYMBOL_UNRESOLVED')
      .map((item) => `step call not in code: ${item.detail}`)
  ]
  for (const gap of gaps) report('SDD_V2_CLOSURE_OPEN', gap, 'design-gap')
  // A test title removed or renamed in the change hides whatever it guarded unless the index says
  // where that guarantee went (OD-39): `replaced-by:<title>`, `superseded-by:BC<n>`, `obsolete-with:<reason>`.
  const dispositions = object(index.title_dispositions) ? index.title_dispositions : {}
  for (const [path, kind] of changed ?? [])
    if (TEST.test(path) && (kind === 'M' || kind === 'D')) {
      const before = titles(repository!, base!, path)
      const after = kind === 'D' ? new Set<string>() : titles(repository!, head!, path)
      const given = object(dispositions[path]) ? dispositions[path] : {}
      for (const title of before)
        if (!after.has(title)) {
          const said = given[title]
          if (
            !text(said) ||
            !/^(?:replaced-by:.+|superseded-by:BC\d+|obsolete-with:.+)$/.test(said)
          )
            report(
              'SDD_V2_CLOSURE_OPEN',
              `${path}: "${title}" removed; record replaced-by, superseded-by or obsolete-with in title_dispositions`,
              'test-title-removed'
            )
        }
    }
  const pass = (id: string) => status.get(id) === 'PASS' && !unsupported.has(id)
  const slice = result.handoff.execution_slice
  const entries = (slice?.entries ?? []).map((entry) => ({
    id: entry.id,
    closed: entry.acceptance.length > 0 && entry.acceptance.every(pass)
  }))
  const mvp = slice?.mvp ?? []
  return {
    protocol: 'create-sdd-closure/v1',
    status: findings.some((item) => item.code === 'SDD_V2_CLOSURE_FAILED')
      ? 'FAILED'
      : findings.length || !result.valid
        ? 'OPEN'
        : 'CLOSED',
    findings,
    acceptance: [...known].map((id) => ({
      id,
      required: required.has(id),
      status: status.get(id)!
    })),
    entries,
    proof,
    gaps,
    replays,
    // Proven means a causal, commit-checked FAIL-then-PASS of the declared oracle (and, with
    // --replay, the oracle observed failing again when the implementation is removed); for a
    // preserved case, a commit-checked PASS-then-PASS of the same command.
    behaviour_proven: [...required].every(
      (id) =>
        pass(id) &&
        proof.some((p) => p.acceptance === id && p.level === 'verified') &&
        (!options.replay ||
          preserved.has(id) ||
          replays.some((r) => r.acceptance === id && r.verdict === 'proven'))
    ),
    mvp_closed: mvp.length ? mvp.every((id) => entries.find((e) => e.id === id)?.closed) : null,
    evidence_limits: [
      'Without --replay the rows are the host’s claim: commits, order, causal diff and oracle link are checked, not the runs themselves.',
      'With --replay the validator runs only the declared oracle; a proven ablation shows the pass depends on the implementing files, not that the oracle covers every behaviour of the requirement.'
    ]
  }
}
