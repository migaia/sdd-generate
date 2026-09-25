import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { list, object, text, type Item, type Report } from './v2-meta.ts'
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
 *   "timeout_s"?: 600}]`. `expect: "fail"` with a patch is a perturbation: the gate must catch it.
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
  gate?: boolean
  timeout_s?: number
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
}>

export type PreflightReport = Readonly<{
  protocol: 'sdd-preflight/v1'
  sdd: string
  sdd_sha: string
  repository: string
  repository_head: string | null
  dirty: boolean
  clause_hashes: Readonly<Record<string, string>>
  items: readonly PreflightResult[]
  status: 'PASSED' | 'FAILED'
}>

/** The document digest a report is bound to; the same function `telemetry.ts` uses. */
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12)

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
      list(value.covers).every(text)
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
  report: Report
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
  if (recorded.sdd_sha !== digest(documentText)) {
    const { changed, citing } = affectedClauses(index, body, recorded.clause_hashes ?? {})
    report(
      'SDD_V2_PREFLIGHT_STALE',
      `${sdd}: changed ${changed.join(', ') || '(prose outside clauses)'}; citing ${citing.join(', ') || '(none)'}: run preflight.ts run --affected, then re-validate${index.review ? ' and re-review those clauses' : ''}`
    )
    summary.status = 'STALE'
    return summary
  }
  const results = new Map((recorded.items ?? []).map((item) => [item.id, item]))
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
