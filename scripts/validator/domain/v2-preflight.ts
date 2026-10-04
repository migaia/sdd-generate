import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { escape, list, object, pathForm, text, type Item, type Report } from './v2-meta.ts'
import { SCALING } from './v2-scope.ts'
import { stepText } from './v2-symbols.ts'

/**
 * The executable preflight (OD-65): before handoff, what already runs against the current code is
 * run — existing acceptance, each BC's candidate change, each scaling gate clean and perturbed, and
 * every gate command — by `scripts/preflight.ts`, which records a report. `validate` does not run
 * anything; it checks that the SDD declares the items its risks require, that the report was made
 * for exactly this revision of the document, and that every item passed.
 *
 * Contract fields:
 * - `preflight`: `[{"id": "P1", "covers": ["A3"], "command": "…", "expect": "pass" | "fail",
 *   "patch"?: "<patch relative to the SDD>", "cwd"?: "<repository-relative dir>", "gate"?: true,
 *   "inputs"?: ["<git-ignored path a gate reads>"], "fails_with"?: "<regex>",
 *   "timeout_s"?: 600}]`. `expect: "fail"` with a patch is a perturbation: the gate must catch it.
 *   `fails_with` states what the failure must show (an acceptance marker or assertion text), so
 *   an install, build or import error is not taken for the expected RED (OD-90).
 * - `preflight_report` (optional): the report path relative to the SDD; the default is
 *   `<sdd file>.preflight.json` beside it.
 */
export type PreflightItem = Readonly<{
  id: string
  covers: readonly string[]
  command: string
  expect: 'pass' | 'fail'
  patch?: string
  cwd?: string
  /** Repository-relative paths (usually git-ignored) copied into the disposable tree (OD-78). */
  inputs?: readonly string[]
  gate?: boolean
  /** Pattern the output of an `expect: "fail"` run must match; a non-matching failure is ERROR. */
  fails_with?: string
  timeout_s?: number
}>

/**
 * When and against what one item ran. Each item keeps its own record, so a partial re-run never
 * restamps results it did not produce and a start-of-leaf base run survives a completion run
 * (OD-87, OD-91); `patch_sha` binds a PASS to the patch bytes it applied (OD-92); `log` is the full
 * output beside the report, relative to it (OD-97).
 */
export type PreflightRun = Readonly<{
  at: string
  head: string | null
  dirty: boolean
  patch_sha?: string
  log?: string
  log_sha?: string
}>

/** One executed item in `sdd-preflight/v1`. `outcome` PASS means the result matched `expect`. */
export type PreflightResult = Readonly<{
  id: string
  covers: readonly string[]
  expect: 'pass' | 'fail'
  exit: number | null
  outcome: 'PASS' | 'FAIL' | 'ERROR'
  writes_outside: readonly string[]
  reason?: string
  /** Absent in reports before OD-92. */
  run?: PreflightRun
}>

export type PreflightReport = Readonly<{
  protocol: 'sdd-preflight/v1'
  sdd: string
  sdd_sha: string
  repository: string
  repository_head: string | null
  dirty: boolean
  clause_hashes: Readonly<Record<string, string>>
  /** Digest of the preflight items and `writes` the run used; absent in reports before OD-77. */
  inputs_sha?: string
  items: readonly PreflightResult[]
  status: 'PASSED' | 'FAILED'
}>

/** The document digest a report is bound to; the same function `telemetry.ts` uses. */
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12)

/** What a run depends on besides clause prose: the items as declared and the write scope. */
export const inputsDigest = (index: Item) =>
  digest(JSON.stringify({ preflight: index.preflight ?? [], writes: index.writes ?? [] }))

/** Package scripts a touched package's own gates run: every `test*` and `typecheck*` script. */
const GATE_SCRIPT = /^(?:test|typecheck)(?:$|:)/

/**
 * The gate scripts of each package a leaf writes (OD-79): the nearest `package.json` above each
 * `writes` path, below the repository root. A change can break any of them, so each needs a gate.
 */
export function packageGateScripts(repository: string, writes: readonly string[]): string[] {
  const scripts = new Set<string>()
  for (const path of writes) {
    for (let dir = path.replace(/\/$/, ''); dir && dir !== '.'; dir = dirname(dir)) {
      const manifest = join(repository, dir, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        const names = Object.keys(
          (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: object }).scripts ?? {}
        )
        for (const name of names.filter((n) => GATE_SCRIPT.test(n))) scripts.add(`${dir}:${name}`)
      } catch {
        // An unreadable manifest has no scripts to require.
      }
      break
    }
  }
  return [...scripts]
}

/** A declared behaviour change: a list item that starts with its ID (`- BC3 old behaviour: …`). */
const DECLARED_BC = /^\s*[-*]\s+(BC\d+[a-z]?)\b/gm
/** Every BC the prose declares, in order. */
export const declaredChanges = (body: string) => [
  ...new Set([...body.matchAll(DECLARED_BC)].map((match) => match[1]!))
]

/** Acceptance of a must-ship requirement that states a scaling outcome. */
function scalingAcceptance(index: Item, body: string): string[] {
  return list(index.requirements)
    .filter(object)
    .filter((r) => r.kind === 'must-ship' && text(r.id))
    .filter((r) => SCALING.test(stepText(body, r.id as string).split('\n')[0] ?? ''))
    .flatMap((r) => list(r.acceptance).filter(text))
}

/** Why this leaf needs a preflight; empty when it does not. */
export function preflightReasons(index: Item, body: string): string[] {
  const reasons: string[] = []
  const changes = declaredChanges(body)
  if (changes.length) reasons.push(`behaviour change ${changes.join(', ')}`)
  if (list(index.consumes).length) reasons.push('consumed export')
  if (scalingAcceptance(index, body).length) reasons.push('scaling gate')
  return reasons
}

/** Every clause ID a revision can change: requirements, steps, acceptance and declared BCs. */
export function clauseIds(index: Item, body: string): string[] {
  const id = (value: unknown) => (object(value) ? value.id : value)
  return [
    ...new Set(
      [
        ...list(index.requirements).map(id),
        ...list(index.steps).map(id),
        ...list(index.acceptance),
        ...declaredChanges(body)
      ].filter(text)
    )
  ]
}

/** One hash per clause, from its prose; a report keeps them so a later run knows what changed. */
export function clauseHashes(index: Item, body: string): Record<string, string> {
  return Object.fromEntries(
    clauseIds(index, body).map((id) => [
      id,
      digest(stepText(body, id).split(/\s+/).join(' ').trim())
    ])
  )
}

/**
 * Amendment closure (item 3): the clauses whose prose changed since `before`, and the unchanged
 * clauses that cite one of them. Both must be re-checked before the SDD returns to the host.
 */
export function affectedClauses(
  index: Item,
  body: string,
  before: Readonly<Record<string, string>>
): { changed: string[]; citing: string[] } {
  const now = clauseHashes(index, body)
  const changed = Object.keys(now).filter((id) => before[id] !== now[id])
  const gone = Object.keys(before).filter((id) => !(id in now))
  const all = [...changed, ...gone]
  const cites = (id: string, target: string) =>
    new RegExp(`(?<![\\w-])${target}(?![\\w-])`).test(stepText(body, id))
  const citing = Object.keys(now).filter(
    (id) => !changed.includes(id) && all.some((target) => cites(id, target))
  )
  return { changed: all, citing }
}

/** The declared items, shape-checked; a malformed item is reported and skipped. */
export function preflightItems(index: Item, report?: Report, path = ''): PreflightItem[] {
  const items: PreflightItem[] = []
  for (const value of list(index.preflight)) {
    const ok =
      object(value) &&
      text(value.id) &&
      text(value.command) &&
      (value.expect === 'pass' || value.expect === 'fail') &&
      list(value.covers).every(text) &&
      list(value.inputs).every((path) => text(path) && pathForm(path)) &&
      (value.fails_with === undefined || text(value.fails_with))
    if (!ok) {
      report?.('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${JSON.stringify(value)}`, 'preflight-item')
      continue
    }
    items.push(value as unknown as PreflightItem)
  }
  return items
}

/** Where the report for `sdd` lives. */
export const reportPath = (index: Item, sdd: string) =>
  resolve(
    dirname(sdd),
    text(index.preflight_report) ? index.preflight_report : `${basename(sdd)}.preflight.json`
  )

/**
 * Check the preflight of one leaf. Blocking, so a leaf whose risks need a preflight is not valid
 * until the items cover them and a passing report exists for this exact revision:
 * - SDD_V2_PREFLIGHT_REQUIRED: items missing, a risk uncovered, a patch missing, or no report;
 * - SDD_V2_PREFLIGHT_STALE: the report was made for another revision (lists what to re-run);
 * - SDD_V2_PREFLIGHT_FAILED: an item did not pass, errored, or wrote outside `writes`.
 * Returns the handoff summary.
 */
export function checkPreflight(
  index: Item,
  body: string,
  documentText: string,
  sdd: string,
  report: Report,
  repository: string | null = null
): { required: boolean; reasons: string[]; report: string; status: string } {
  const reasons = preflightReasons(index, body)
  const at = sdd === '<stdin>' ? '' : reportPath(index, sdd)
  const summary = { required: reasons.length > 0, reasons, report: at, status: 'NOT_REQUIRED' }
  const items = preflightItems(index, report, sdd)
  if (!reasons.length && !items.length) return summary
  const need = (detail: string, subtype: string) => {
    report('SDD_V2_PREFLIGHT_REQUIRED', `${sdd}: ${detail}`, subtype)
    summary.status = 'INCOMPLETE'
  }
  if (!items.length) need(reasons.join('; '), 'preflight-items-missing')
  const covering = (id: string, test: (item: PreflightItem) => boolean) =>
    items.some((item) => item.covers.includes(id) && test(item))
  for (const change of declaredChanges(body))
    if (!covering(change, (item) => !!item.patch && item.expect === 'pass'))
      need(`${change} needs its candidate change as a patch that passes`, 'bc-candidate-uncovered')
  for (const id of list(index.preserve).filter(text))
    if (!covering(id, (item) => !item.patch && item.expect === 'pass'))
      need(`${id} needs a run against the current code`, 'preserve-uncovered')
  for (const id of scalingAcceptance(index, body)) {
    if (!covering(id, (item) => !item.patch && item.expect === 'pass'))
      need(`${id} needs a clean run of its gate`, 'scaling-clean-uncovered')
    if (!covering(id, (item) => !!item.patch && item.expect === 'fail'))
      need(`${id} needs a perturbation its gate must catch`, 'scaling-perturbed-uncovered')
  }
  // OD-75: a change acceptance must be seen failing at base, or it may already hold (and prove nothing).
  const preserved = new Set(list(index.preserve).filter(text))
  const changes = list(index.requirements)
    .filter(object)
    .filter((r) => r.kind === 'must-ship')
    .flatMap((r) => list(r.acceptance).filter(text))
    .filter((id) => !preserved.has(id))
  for (const id of new Set(changes))
    if (!covering(id, (item) => !item.patch && item.expect === 'fail'))
      need(`${id} needs a run of its oracle at base that fails`, 'change-base-uncovered')
  const gates = items.filter((item) => item.gate)
  for (const script of repository
    ? packageGateScripts(repository, list(index.writes).filter(text))
    : []) {
    const name = script.slice(script.indexOf(':') + 1)
    const runs = new RegExp(`(?:^|[\\s/])${escape(name)}(?=$|[\\s;&|'"])`)
    if (!gates.some((item) => runs.test(item.command)))
      need(
        `${script} is a gate of a touched package; run it in a gate item`,
        'gate-script-uncovered'
      )
  }
  const relied = object(index.relies_on) ? Object.keys(index.relies_on) : []
  for (const id of relied)
    if (!covering(id, () => true)) need(`${id} relies on a consumed export`, 'consumed-uncovered')
  if (items.length && !items.some((item) => item.gate))
    need('declare the repository gate commands as items with "gate": true', 'gate-missing')
  for (const item of items)
    if (item.patch && sdd !== '<stdin>' && !existsSync(resolve(dirname(sdd), item.patch)))
      need(`${item.id} patch ${item.patch}`, 'patch-not-found')
  if (sdd === '<stdin>') return summary
  if (!existsSync(at)) {
    need(
      `run bun <create-sdd-root>/scripts/preflight.ts run --sdd ${sdd}`,
      'preflight-report-missing'
    )
    return summary
  }
  let recorded: PreflightReport
  try {
    recorded = JSON.parse(readFileSync(at, 'utf8')) as PreflightReport
  } catch {
    need(`${at} is not JSON`, 'preflight-report-invalid')
    return summary
  }
  // OD-77: history (Clarifications, implementation records) and revision bumps do not stale a
  // report; a changed clause or a changed item, patch path or write scope does.
  const { changed, citing } = affectedClauses(index, body, recorded.clause_hashes ?? {})
  const shape = (list: readonly { id: string; covers: readonly string[]; expect: string }[]) =>
    JSON.stringify(list.map(({ id, covers, expect }) => [id, covers, expect]))
  const inputsChanged = recorded.inputs_sha
    ? recorded.inputs_sha !== inputsDigest(index)
    : shape(recorded.items ?? []) !== shape(items)
  if (recorded.sdd_sha !== digest(documentText) && (changed.length || inputsChanged)) {
    report(
      'SDD_V2_PREFLIGHT_STALE',
      `${sdd}: changed ${changed.join(', ') || '(prose outside clauses)'}; citing ${citing.join(', ') || '(none)'}: run preflight.ts run --affected, then re-validate${index.review ? ' and re-review those clauses' : ''}`
    )
    summary.status = 'STALE'
    return summary
  }
  const results = new Map((recorded.items ?? []).map((item) => [item.id, item]))
  // OD-92: a result is bound to the patch bytes it applied; an edited patch needs a new run.
  const repatched = items.filter((item) => {
    const ran = results.get(item.id)?.run?.patch_sha
    const file = item.patch ? resolve(dirname(sdd), item.patch) : ''
    return !!ran && existsSync(file) && ran !== digest(readFileSync(file, 'utf8'))
  })
  if (repatched.length) {
    report(
      'SDD_V2_PREFLIGHT_STALE',
      `${sdd}: patch changed since its run: ${repatched.map((item) => `${item.id} ${item.patch}`).join(', ')}; run preflight.ts run --only ${repatched.map((item) => item.id).join(',')}`
    )
    summary.status = 'STALE'
    return summary
  }
  const failed = items
    .map((item) => ({ item, result: results.get(item.id) }))
    .filter(({ result }) => result?.outcome !== 'PASS')
    .map(({ item, result }) =>
      result
        ? `${item.id} ${result.outcome}${result.reason ? ` (${result.reason})` : ''}${result.writes_outside.length ? ` writes ${result.writes_outside.join(', ')}` : ''}`
        : `${item.id} not run`
    )
  if (failed.length) {
    report('SDD_V2_PREFLIGHT_FAILED', `${sdd}: ${failed.join('; ')}`)
    summary.status = 'FAILED'
  } else if (summary.status !== 'INCOMPLETE') summary.status = 'PASSED'
  return summary
}

/** The host's first obligation (item 4), carried in every handoff that has a preflight. */
export const HOST_PROTOCOL = [
  'Before the first step, run bun <create-sdd-root>/scripts/preflight.ts run --sdd <this SDD> --repository <root> against the current code and report every FAIL, conflict and unrunnable item in one batch.',
  'Stop mid-implementation only for a conflict the preflight could not have observed; say why it could not.',
  'When prose and a Clarifications entry disagree, the latest-dated Clarifications entry wins until the author amends the clause.'
] as const
