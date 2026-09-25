/**
 * The rule ledger and its health report.
 *
 * Every rule in this skill costs prose to state, code to enforce and tests to hold in place, and
 * every one of them arrived because something went wrong once. Nothing has ever measured which of
 * them still catches anything, so the only available move has been to add another — thirteen
 * commits, +14000 lines, -730. `audit` is the first thing here that can answer "does this rule earn
 * its keep", and `catalog` is what gives it something to answer about.
 *
 * The ledger is derived from the sources, not hand-maintained: a hand-written list of 227 codes
 * would be stale within a week, and a stale ledger is worse than none because it reads as evidence.
 *
 *   rsi.ts catalog [--render]      derive the rule ledger; --render writes rsi/rules.json
 *   rsi.ts audit   [--window <n>]  report rule health from the telemetry ledger
 *
 * Exit codes: 0 clean, 1 the ledger on disk disagrees with the sources, 2 usage.
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  mkdirSync
} from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { readTelemetry, type TelemetryEntry } from './lib/telemetry.ts'
import { applyOverlay, contractOf, withContract, type Json } from './lib/example-overlay.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = join(import.meta.dir, '..')
const RULES_FILE = join(ROOT, 'rsi', 'rules.json')
const CASES_FILE = join(ROOT, 'cases', 'defect-cases.json')
const HELD_OUT = join(ROOT, 'cases', 'held-out')
const OPEN_ROUND = join(ROOT, 'rsi', 'open-round.json')
const ROUNDS = join(ROOT, 'rsi', 'rounds')
const BUDGET_FILE = join(ROOT, 'rsi', 'budget.json')
const SUPERSESSION = join(ROOT, 'rsi', 'supersession.json')
const USAGE = [
  'usage:',
  '  rsi.ts catalog [--render]            derive the rule ledger',
  '  rsi.ts audit   [--window <n>]        rule health from the telemetry ledger',
  '  rsi.ts health                        advisory rule evidence and budget status',
  '  rsi.ts update                        self-check and the ordered agenda for the next round',
  '  rsi.ts suite                         run every mechanical defect case',
  '  rsi.ts open --kind <k> --goal <t>    start a round and commit to its case files',
  '  rsi.ts baseline                      record the champion result for the open round',
  '  rsi.ts evaluate                      re-run the suite and compare against the baseline',
  '  rsi.ts prune                         check supersession and the budget ceilings',
  '  rsi.ts settle --id <OD-n> --as detector|lens|class|ruling|rejected --evidence <text>',
  '                                       settle a queued observation in the open round',
  '  rsi.ts close --confirm <token>       record the verdict and end the round'
].join('\n')

/**
 * Only `improvement` may be ACCEPTED for a repair on frozen cases. Other clean kinds are RECORDED;
 * `consolidation` additionally has to leave the skill smaller than it found it.
 */
const KINDS = ['improvement', 'case-amendment', 'budget-change', 'consolidation'] as const
type Kind = (typeof KINDS)[number]

/** Retention decisions for dormant rules, so a consolidation can keep a guard without re-arguing it. */
const DISPOSITIONS = join(ROOT, 'rsi', 'dispositions.json')

/** How many recent runs a health figure looks back over. */
const DEFAULT_WINDOW = 50

/** Capture literal issue, error, and report codes (a formatter may wrap the first argument); dynamic report arguments need review. */
const CODE_PATTERNS = [
  /code: '([A-Z][A-Z0-9_]{3,})'/g,
  /Error\('([A-Z][A-Z0-9_]{3,})/g,
  /\breport\(\s*'([A-Z][A-Z0-9_]{3,})'(?=,|\))/g
]

/** A code written as a standalone quoted string, as test tables and expectations do. */
const TEST_CODE_PATTERN = /['"`]([A-Z][A-Z0-9_]{3,})['"`]/g

export type Rule = Readonly<{
  id: string
  /** Where the rule lives, in the form the supersession record refers to it by. */
  asset: string
  kind: 'issue-code'
  /** Files that raise it, repository-relative to the skill root. */
  sites: readonly string[]
  /** Lines of implementation and test that exist to serve it, as a first-order cost estimate. */
  weight: Readonly<{ sites: number; mentions: number; test_mentions: number }>
}>

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith('.ts')) yield full
  }
}

/** Derive the current rule set from the sources that raise the codes. */
export function catalog(root = ROOT): readonly Rule[] {
  const sites = new Map<string, Set<string>>()
  const mentions = new Map<string, number>()
  const testMentions = new Map<string, number>()
  for (const dir of ['scripts', 'tests']) {
    let entries: Generator<string>
    try {
      entries = walk(join(root, dir))
    } catch {
      continue
    }
    for (const file of entries) {
      const text = readFileSync(file, 'utf8')
      const relativePath = relative(root, file)
      // A test also names a code as a bare expected string (`['od15', 'SDD_…']`). Those count only
      // for codes a script already reports, and each source offset counts once across patterns.
      const seen = new Set<number>()
      const patterns = dir === 'tests' ? [...CODE_PATTERNS, TEST_CODE_PATTERN] : CODE_PATTERNS
      for (const pattern of patterns)
        for (const match of text.matchAll(pattern)) {
          const code = match[1]!
          const at = match.index! + match[0].indexOf(code)
          if (seen.has(at) || (pattern === TEST_CODE_PATTERN && !sites.has(code))) continue
          seen.add(at)
          if (dir === 'scripts') {
            if (!sites.has(code)) sites.set(code, new Set())
            sites.get(code)!.add(relativePath)
          }
          const bucket = dir === 'scripts' ? mentions : testMentions
          bucket.set(code, (bucket.get(code) ?? 0) + 1)
        }
    }
  }
  const codes = [...new Set([...sites.keys(), ...testMentions.keys()])].sort()
  return codes.map((code, index) => ({
    id: `RL-${String(index + 1).padStart(4, '0')}`,
    asset: `code:${code}`,
    kind: 'issue-code' as const,
    sites: [...(sites.get(code) ?? [])].sort(),
    weight: {
      sites: sites.get(code)?.size ?? 0,
      mentions: mentions.get(code) ?? 0,
      test_mentions: testMentions.get(code) ?? 0
    }
  }))
}

export type RuleHealth = Readonly<{
  asset: string
  fires_window: number
  documents_window: number
  last_seen?: string
  age_without_fire: number
  cost_per_fire: number | null
  redundant_with: readonly string[]
}>

/**
 * Turn the telemetry ledger into per-rule health.
 *
 * One document revision is one observation even if several tools or processes inspect it. This
 * keeps repeated checks from manufacturing evidence that a rule fired or stayed dormant.
 */
export function health(
  rules: readonly Rule[],
  entries: readonly TelemetryEntry[],
  window = DEFAULT_WINDOW
): readonly RuleHealth[] {
  const revisions = [...new Set(entries.map((entry) => entry.sdd_sha))]
  const recentRevisions = new Set(revisions.slice(-window))
  const recent = entries.filter((entry) => recentRevisions.has(entry.sdd_sha))
  const docsByCode = new Map<string, Set<string>>()
  const lastByCode = new Map<string, string>()
  for (const entry of recent)
    for (const code of [...entry.codes, ...entry.candidate_codes]) {
      if (!docsByCode.has(code)) docsByCode.set(code, new Set())
      docsByCode.get(code)!.add(entry.sdd_sha)
      if (!lastByCode.has(code) || lastByCode.get(code)! < entry.ts) lastByCode.set(code, entry.ts)
    }
  const jaccard = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0
    let shared = 0
    for (const value of a) if (b.has(value)) shared += 1
    return shared / (a.size + b.size - shared)
  }
  return rules.map((rule) => {
    const code = rule.asset.slice('code:'.length)
    const docs = docsByCode.get(code) ?? new Set<string>()
    const fires = docs.size
    const cost = rule.weight.mentions + rule.weight.test_mentions
    const redundant = rules
      .filter((other) => other.asset !== rule.asset)
      .filter((other) => {
        const otherDocs = docsByCode.get(other.asset.slice('code:'.length))
        return otherDocs ? jaccard(docs, otherDocs) > 0.9 : false
      })
      .map((other) => other.asset)
    return {
      asset: rule.asset,
      fires_window: fires,
      documents_window: docs.size,
      ...(lastByCode.get(code) ? { last_seen: lastByCode.get(code)! } : {}),
      age_without_fire: fires ? 0 : recentRevisions.size,
      cost_per_fire: fires ? Number((cost / fires).toFixed(2)) : null,
      redundant_with: redundant
    }
  })
}

/* ------------------------------------------------------------------ improvement evidence */

/**
 * Historical levels remain readable in closed rounds. Current debt is advisory until its signals
 * have been calibrated against actual repair outcomes; it cannot freeze a new repair round.
 */
export const DEBT_LEVELS = ['NONE', 'NOTICE', 'REQUIRED', 'FREEZE'] as const
export type DebtLevel = (typeof DEBT_LEVELS)[number]

/**
 * Each unresolved rule decision is visible until that rule is justified or retired. No accepted
 * consolidation resets unrelated history, and a number of rounds is not evidence of a defect.
 */
export const DEBT_THRESHOLDS = {
  additions_without_evidence: [1],
  undisposed_dormant_rules: [1],
  unsettled_observations: [1]
} as const satisfies Record<string, readonly number[]>
export type DebtSignalName = keyof typeof DEBT_THRESHOLDS

/**
 * A rule becomes a dormancy candidate only after it has had a chance to fire: its introduction must
 * be older than this many days, and telemetry must hold a full window of distinct revisions.
 */
export const DORMANCY_MIN_AGE_DAYS = 14

export type ClosedRound = Readonly<{
  id: string
  kind: Kind
  verdict: string
  closed_at?: string
  snapshot?: Readonly<{ supersession_additions: number }>
}>

export type Addition = Readonly<{
  asset: string
  added_at?: string
  supersedes?: readonly string[]
  supersedes_nothing_because?: string
  counterexample?: string
  scope?: string
  tradeoff?: string
}>

export type Disposition = Readonly<{
  asset: string
  disposition: 'retain' | 'replace' | 'delete'
  replacement?: string
  counterexample?: string
  scope?: string
  tradeoff?: string
  decided_in: string
  revisions_at_decision?: number
  review_after_revisions?: number
}>

/** A decision needs a concrete failure, its supported scope and the cost of this choice. */
const hasDecisionEvidence = (entry: {
  counterexample?: string
  scope?: string
  tradeoff?: string
}): boolean =>
  Boolean(entry.counterexample?.trim() && entry.scope?.trim() && entry.tradeoff?.trim())

export type DebtSignal = Readonly<{
  signal: DebtSignalName
  value: number
  thresholds: readonly number[]
  level: DebtLevel
}>

/** Level a value reaches against the supplied ordered thresholds. */
export function levelOf(value: number, thresholds: readonly number[]): DebtLevel {
  let index = 0
  thresholds.forEach((threshold, at) => {
    if (value >= threshold) index = at + 1
  })
  return DEBT_LEVELS[index]!
}

/** The higher of two levels. */
const maxLevel = (a: DebtLevel, b: DebtLevel): DebtLevel =>
  DEBT_LEVELS.indexOf(a) >= DEBT_LEVELS.indexOf(b) ? a : b

/**
 * Dormant rules no one has decided about.
 *
 * Dormant means: never fired in the audit window, known to be older than the minimum age, and
 * pinned by no mechanical or held-out case — a pinned rule has evidence of a defect it catches. A `retain`
 * disposition with specific evidence takes a rule off the list until its review is due. Revisions,
 * rather than repeated process runs, measure whether the corpus had another chance to exercise it.
 */
export function undisposedDormant(input: {
  health: readonly RuleHealth[]
  pinned: ReadonlySet<string>
  additions: readonly Addition[]
  dispositions: readonly Disposition[]
  runs: number
  window: number
  now: Date
}): readonly string[] {
  if (input.runs < input.window) return []
  const youngest = new Map(input.additions.map((entry) => [entry.asset, entry.added_at]))
  const cutoff = input.now.getTime() - DORMANCY_MIN_AGE_DAYS * 86_400_000
  const decided = new Map(
    input.dispositions
      .filter((entry) => entry.disposition === 'retain' && hasDecisionEvidence(entry))
      .map((entry) => [entry.asset, entry])
  )
  return input.health
    .filter((rule) => rule.fires_window === 0)
    .filter((rule) => !input.pinned.has(rule.asset.slice('code:'.length)))
    .filter((rule) => {
      const added = youngest.get(rule.asset)
      return added !== undefined && Date.parse(added) <= cutoff
    })
    .filter((rule) => {
      const entry = decided.get(rule.asset)
      return (
        !entry ||
        entry.revisions_at_decision === undefined ||
        entry.review_after_revisions === undefined ||
        entry.revisions_at_decision > input.runs ||
        input.runs >= entry.revisions_at_decision + entry.review_after_revisions
      )
    })
    .map((rule) => rule.asset)
}

/**
 * Debt signals and the level they put the skill at.
 *
 * Only unresolved decisions count. A short consolidation cannot erase earlier additions, and
 * dormant-rule decisions require their own evidence rather than a shared template explanation.
 */
export function debt(input: {
  rounds: readonly ClosedRound[]
  additions: readonly Addition[]
  dispositions?: readonly Disposition[]
  currentAssets?: ReadonlySet<string>
  undisposed: number
  /** Entries still queued in rsi/observed-defects.md; an update settles every one of them. */
  observations?: number
}): { level: DebtLevel; signals: readonly DebtSignal[] } {
  const retired = new Set(
    (input.dispositions ?? [])
      .filter(
        (entry) =>
          (entry.disposition === 'replace' || entry.disposition === 'delete') &&
          hasDecisionEvidence(entry) &&
          input.currentAssets !== undefined &&
          !input.currentAssets.has(entry.asset)
      )
      .map((entry) => entry.asset)
  )
  const values: Record<DebtSignalName, number> = {
    additions_without_evidence: new Set(
      input.additions
        .filter((entry) => !hasDecisionEvidence(entry) && !retired.has(entry.asset))
        .map((entry) => entry.asset)
    ).size,
    undisposed_dormant_rules: input.undisposed,
    unsettled_observations: input.observations ?? 0
  }
  const signals = (Object.keys(DEBT_THRESHOLDS) as DebtSignalName[]).map((signal) => ({
    signal,
    value: values[signal],
    thresholds: DEBT_THRESHOLDS[signal],
    level: levelOf(values[signal], DEBT_THRESHOLDS[signal])
  }))
  return { level: signals.reduce<DebtLevel>((a, s) => maxLevel(a, s.level), 'NONE'), signals }
}

/**
 * What a consolidation has to show before it may close: no measured dimension grew, and the skill
 * lost rules or lines. Keeping a rule with a written reason is a disposition, not a consolidation —
 * a round that only records decisions has removed nothing and cannot claim to have converged.
 */
export function consolidationFindings(
  before: Readonly<{ measured: Record<string, number>; rules: number }>,
  after: Readonly<{ measured: Record<string, number>; rules: number }>
): string[] {
  const findings: string[] = []
  for (const [dimension, value] of Object.entries(after.measured))
    if (value > (before.measured[dimension] ?? value))
      findings.push(`${dimension} grew from ${before.measured[dimension]} to ${value}`)
  if (after.rules > before.rules) findings.push(`rules grew from ${before.rules} to ${after.rules}`)
  const lines = (m: Record<string, number>) =>
    Object.entries(m)
      .filter(([key]) => key.endsWith('.lines'))
      .reduce((sum, [, value]) => sum + value, 0)
  if (after.rules >= before.rules && lines(after.measured) >= lines(before.measured))
    findings.push('neither the rule count nor the measured lines went down')
  return findings
}

/** Parse a JSON file, or return the fallback when it is absent. */
const readJson = <T>(file: string, fallback: T): T =>
  existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback

/** Every closed round on disk. */
export function closedRounds(dir = ROUNDS): readonly ClosedRound[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as ClosedRound)
}

/** Codes a mechanical or held-out case expects; those rules have evidence of what they catch. */
export function pinnedCodes(): ReadonlySet<string> {
  return new Set([...defectCases(), ...heldOutCases()].map((entry) => entry.detector.expected_code))
}

export type SkillHealth = Readonly<{
  protocol: 'skill-rsi-health/v1'
  level: DebtLevel
  signals: readonly DebtSignal[]
  undisposed_dormant: readonly string[]
  redundant_pairs: readonly (readonly [string, string])[]
  measured: Record<string, number>
  over_budget: readonly { dimension: string; ceiling: number; measured: number }[]
  /** Pre-handoff review precision per lens, from recorded dispositions (one entry per revision). */
  review_lenses: Readonly<Record<string, LensHealth>>
  /** Settled observations per defect class, the unit RSI converges by. */
  defect_classes?: Readonly<Record<string, number>>
  limits: readonly string[]
}>

export type LensHealth = Readonly<{
  fixed: number
  ruled_invalid: number
  out_of_scope: number
  open: number
  /** fixed / (fixed + ruled-invalid); null until a finding is closed either way. */
  precision: number | null
}>

/**
 * Per-lens review outcomes across document revisions. Only the latest entry for a revision counts,
 * so revalidating a document does not multiply its findings. A lens below 50% precision is a rewrite
 * candidate; one that never produces a finding is a consolidation candidate.
 */
export function reviewLenses(entries: readonly TelemetryEntry[]): Record<string, LensHealth> {
  const latest = new Map<string, NonNullable<TelemetryEntry['review']>>()
  for (const entry of entries) if (entry.review) latest.set(entry.sdd_sha, entry.review)
  const totals: Record<
    string,
    { fixed: number; ruled_invalid: number; out_of_scope: number; open: number }
  > = {}
  for (const review of latest.values())
    for (const [lens, counts] of Object.entries(review)) {
      const total = (totals[lens] ??= { fixed: 0, ruled_invalid: 0, out_of_scope: 0, open: 0 })
      for (const key of ['fixed', 'ruled_invalid', 'out_of_scope', 'open'] as const)
        total[key] += counts[key] ?? 0
    }
  return Object.fromEntries(
    Object.entries(totals).map(([lens, total]) => {
      const closed = total.fixed + total.ruled_invalid
      return [lens, { ...total, precision: closed ? total.fixed / closed : null }]
    })
  )
}

/**
 * The skill's unresolved improvement decisions, read-only and independent of SDD maturity.
 */
/** Queue of defects observed in real runs, written by authors and hosts; settled by rounds. */
const OBSERVED = join(ROOT, 'rsi', 'observed-defects.md')
/**
 * How a round settles an observation: a detector pinned by a case, a review lens accepted by the
 * external review benchmark, a written ruling, or rejection. Semantic defects (clauses that cannot
 * all hold, acceptance a wrong implementation passes) settle as lenses; only a mechanical criterion
 * with no false positives becomes a detector.
 */
const SETTLEMENTS = ['detector', 'lens', 'class', 'ruling', 'rejected'] as const

/**
 * The four defect classes (OD-65 item 6) and the class-level mechanism that answers each. An
 * observation declares its class with a `**Class:** <class>` line. `--as class` settles it by the
 * mechanism, with no new detector, when the evidence names that mechanism; RSI succeeds by fewer
 * host stops per delivery (sdd-bench `stops`), not by more detectors.
 */
export const CLASS_MECHANISM = {
  duplication: 'SDD_V2_CONTRACT_FIELD_RESTATED',
  'blast-radius': 'SDD_V2_PREFLIGHT_STALE',
  feasibility: 'SDD_V2_PREFLIGHT_FAILED',
  'gate-scope': 'writes_outside'
} as const
export type DefectClass = keyof typeof CLASS_MECHANISM

/** The class an observation declares, or null. */
export function classOf(text: string): DefectClass | null {
  const found = /\*\*Class:\*\*\s*`?([\w-]+)/.exec(text)?.[1]
  return found && found in CLASS_MECHANISM ? (found as DefectClass) : null
}

/** Settled observations per class across closed rounds; older ones without a class are counted apart. */
export function classCounts(rounds: readonly ClosedRound[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const round of rounds)
    for (const entry of (round as { settled_observations?: { text?: string }[] })
      .settled_observations ?? [])
      counts[classOf(entry.text ?? '') ?? 'unclassified'] =
        (counts[classOf(entry.text ?? '') ?? 'unclassified'] ?? 0) + 1
  return counts
}
export type Settlement = Readonly<{
  id: string
  as: (typeof SETTLEMENTS)[number]
  evidence: string
}>

/**
 * Observation sections of the queue: each `## OD-<n> <title>` heading and its text up to the next
 * second-level heading. Other second-level sections are commentary on the queued entries.
 */
export function observations(text: string): { id: string; text: string }[] {
  const parts = text.split(/^(?=## )/m).slice(1)
  return parts.flatMap((part) => {
    const id = /^## (OD-\d+)\b/.exec(part)?.[1]
    return id ? [{ id, text: part.trimEnd() }] : []
  })
}

/**
 * Remove settled entries from the queue. Once no entry remains, commentary about them goes too, so
 * after an update the file is its header alone and every settled text lives in a round record.
 */
export function drainObservations(text: string, settled: ReadonlySet<string>): string {
  const [header = '', ...parts] = text.split(/^(?=## )/m)
  const kept = parts.filter((part) => {
    const id = /^## (OD-\d+)\b/.exec(part)?.[1]
    return id ? !settled.has(id) : true
  })
  const open = kept.some((part) => /^## OD-\d+\b/.test(part))
  return `${[header.trimEnd(), ...(open ? kept.map((part) => part.trimEnd()) : [])].join('\n\n')}\n`
}

export function skillHealth(now = new Date()): SkillHealth {
  const entries = readTelemetry()
  const rules = catalog()
  const report = health(rules, entries, DEFAULT_WINDOW)
  const additions = readJson<{ additions?: Addition[] }>(SUPERSESSION, {}).additions ?? []
  const dispositions =
    readJson<{ dispositions?: Disposition[] }>(DISPOSITIONS, {}).dispositions ?? []
  const runs = new Set(entries.map((entry) => entry.sdd_sha)).size
  const queued = existsSync(OBSERVED) ? observations(readFileSync(OBSERVED, 'utf8')).length : 0
  const undisposed = undisposedDormant({
    health: report,
    pinned: pinnedCodes(),
    additions,
    dispositions,
    runs,
    window: DEFAULT_WINDOW,
    now
  })
  const { level, signals } = debt({
    rounds: closedRounds(),
    additions,
    dispositions,
    currentAssets: new Set(rules.map((rule) => rule.asset)),
    undisposed: undisposed.length,
    observations: queued
  })
  const ceilings = readJson<{ ceilings?: Record<string, number> }>(BUDGET_FILE, {}).ceilings ?? {}
  const measured = measure()
  const pairs = new Map<string, readonly [string, string]>()
  for (const rule of report)
    for (const other of rule.redundant_with) {
      const pair = [rule.asset, other].sort() as [string, string]
      pairs.set(pair.join('|'), pair)
    }
  return {
    protocol: 'skill-rsi-health/v1',
    level,
    signals,
    undisposed_dormant: undisposed,
    redundant_pairs: [...pairs.values()],
    measured,
    over_budget: Object.entries(ceilings)
      .filter(([key, limit]) => (measured[key] ?? 0) > limit)
      .map(([key, limit]) => ({ dimension: key, ceiling: limit, measured: measured[key] ?? 0 })),
    review_lenses: reviewLenses(entries),
    defect_classes: classCounts(closedRounds()),
    limits: [
      'dormant means unfired in this corpus, not useless: a structural guard is dormant whenever documents are well formed',
      'debt is advisory until calibrated against repair outcomes; it does not gate SDD readiness or repair rounds',
      `dormancy requires ${DEFAULT_WINDOW} distinct document revisions; this corpus has ${runs}`
    ]
  }
}

/**
 * The ordered agenda a developer gets from `rsi.ts update`: finish an open round, reconcile drift,
 * then use concrete evidence to choose a consolidation or repair.
 */
export function updateAgenda(
  state: Readonly<{
    health: SkillHealth
    open_round?: string
    catalog_drifted: boolean
  }>
): { step: string; command?: string; detail: string }[] {
  const steps: { step: string; command?: string; detail: string }[] = []
  const { health: h } = state
  if (state.open_round)
    steps.push({
      step: 'finish-open-round',
      command: 'bun scripts/rsi.ts evaluate && bun scripts/rsi.ts prune',
      detail: `round ${state.open_round} is still open; close it before starting another`
    })
  const queued = h.signals.find((s) => s.signal === 'unsettled_observations')?.value ?? 0
  if (queued)
    steps.push({
      step: 'settle-observations',
      command:
        'bun scripts/rsi.ts settle --id <OD-n> --as class|detector|lens|ruling|rejected --evidence <text>',
      detail: `${queued} observation(s) queued in rsi/observed-defects.md: settle every one inside a round; prefer --as class when the class mechanism (${Object.entries(
        CLASS_MECHANISM
      )
        .map(([c, m]) => `${c}: ${m}`)
        .join(
          ', '
        )}) catches it, a detector only for what no mechanism sees; close archives them into the round record and empties the queue`
    })
  if (state.catalog_drifted)
    steps.push({
      step: 'reconcile-ledger',
      command: 'bun scripts/rsi.ts catalog --render',
      detail:
        'the rule ledger disagrees with the sources; every new code also needs a supersession entry'
    })
  if (h.level !== 'NONE')
    steps.push({
      step: 'consider-consolidation',
      command:
        'bun scripts/rsi.ts open --kind consolidation --goal <what is merged, retired or ablated>',
      detail: [
        `level ${h.level}: ${h.signals
          .filter((s) => s.level !== 'NONE')
          .map((s) => `${s.signal}=${s.value}`)
          .join(', ')}`,
        `${h.undisposed_dormant.length} dormant rule(s) to delete, replace or retain with a per-rule counterexample, scope and trade-off in rsi/dispositions.json`,
        `${h.redundant_pairs.length} rule pair(s) firing on the same documents`,
        'a consolidation also needs a demonstrated repair and no regression; a smaller file alone does not settle earlier decisions'
      ].join('; ')
    })
  steps.push({
    step: 'consider-enhancement',
    command: 'bun scripts/rsi.ts open --kind improvement --goal <defect it catches>',
    detail:
      'only for a defect observed in a real run (rsi/observed-defects.md); the baseline must show a failing case before the candidate may claim its repair'
  })
  if (h.over_budget.length)
    steps.push({
      step: 'over-budget',
      detail: `${h.over_budget.map((o) => `${o.dimension} ${o.measured}>${o.ceiling}`).join(', ')}; a budget change must record its trade-off and still cannot claim a repair without a repaired case`
    })
  return steps
}

/* ------------------------------------------------------------------ mechanical suite */

/**
 * A fixture is either a file, or the worked example with one thing broken.
 *
 * The second form exists because a case is only evidence when its two sides differ by one fact. A
 * hand-written pair of 500-line documents drifts apart in a dozen incidental ways, and then a pass
 * no longer says which of them mattered; an overlay on a shared base cannot.
 */
export type Fixture = string | Readonly<{ base: string; overlay: Json }>

export type DefectCase = Readonly<{
  id: string
  fixture: Fixture
  negative_fixture?: Fixture
  /**
   * A fixture workspace this case's detector reads, copied into the scratch directory per run.
   *
   * It is materialised rather than kept ready on disk because the checks that need one require a
   * `.git` marker at its root, and a second git directory inside this repository would read to git
   * as a submodule. `<repository>` in the detector command is replaced with the copy's path.
   */
  repository?: string
  detector: Readonly<{ command: string; expected_code: string; must_fire: boolean }>
  negative_expectation?: Readonly<{ must_fire: boolean }>
}>

export type CaseResult = Readonly<{
  id: string
  fired: boolean
  negative_fired: boolean | null
  pass: boolean
  codes: readonly string[]
}>

/**
 * Every code anywhere in a detector's JSON output.
 *
 * `code` fields are the obvious half. The other half is that `SDD_CONTRACT_INVALID` is an umbrella
 * whose message carries the code that actually fired, so reading only the fields would report one
 * rule where twenty fired — the same undercount that first made 210 rules look dead.
 */
export function codesIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) codesIn(entry, into)
  else if (value && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'code' && typeof inner === 'string') into.add(inner)
      else if ((key === 'message' || key === 'detail') && typeof inner === 'string')
        // A path fragment is not a code: temp directory suffixes and case IDs sit between `-`, `/`
        // or `.`, and reading them made a rerun of the same candidate report different codes.
        for (const match of inner.matchAll(/(?<![\w/.-])([A-Z][A-Z0-9_]{3,})(?![\w/.-])/g))
          into.add(match[1]!)
      else codesIn(inner, into)
    }
  return into
}

/**
 * The document a fixture stands for, as a path on disk; an overlay is composed into `scratch`.
 *
 * A case with a fixture workspace writes its document inside that workspace, because a check that
 * reads a repository resolves it from where the document sits.
 */
function materialise(fixture: Fixture, scratch: string, name: string, repository?: string): string {
  if (typeof fixture === 'string') return join(ROOT, fixture)
  const text = readFileSync(join(ROOT, fixture.base), 'utf8')
  const document = /^````(?:markdown)?\n([\s\S]*?)\n````$/m.exec(text)?.[1] ?? text
  const file = join(repository ?? scratch, `${name}.md`)
  writeFileSync(file, withContract(document, applyOverlay(contractOf(document), fixture.overlay)))
  return file
}

/** Copy a fixture workspace into the scratch directory and give it the `.git` marker checks want. */
function materialiseRepository(source: string, scratch: string, name: string): string {
  const target = join(scratch, `repo-${name}`)
  cpSync(join(ROOT, source), target, { recursive: true })
  const history = join(target, 'history.json')
  if (!existsSync(history)) {
    mkdirSync(join(target, '.git'), { recursive: true })
    return target
  }
  // A workspace that ships `history.json` becomes a real repository: the copied files are the
  // first commit, then each entry writes (or, with null, deletes) files and commits with its
  // message. Fixed identity and dates keep the hashes, and so every rerun, identical.
  const commits = (
    JSON.parse(readFileSync(history, 'utf8')) as {
      commits: { message: string; files: Record<string, string | null> }[]
    }
  ).commits
  unlinkSync(history)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'rsi',
    GIT_AUTHOR_EMAIL: 'rsi@example.invalid',
    GIT_COMMITTER_NAME: 'rsi',
    GIT_COMMITTER_EMAIL: 'rsi@example.invalid',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
  }
  const git = (...args: string[]) => Bun.spawnSync(['git', '-C', target, ...args], { env })
  git('init', '-q')
  for (const [at, commit] of commits.entries()) {
    for (const [path, content] of Object.entries(commit.files)) {
      if (content === null) rmSync(join(target, path), { force: true })
      else {
        mkdirSync(join(target, path, '..'), { recursive: true })
        writeFileSync(join(target, path), content)
      }
    }
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', commit.message || `commit ${at}`)
  }
  return target
}

/** Run one detector command with its placeholders bound to paths, and collect the codes reported. */
function runDetector(command: string, fixture: string, repository?: string): Set<string> {
  const argv = command
    .replace('<fixture>', fixture)
    .replace('<repository>', repository ?? '')
    .split(/\s+/)
  if (argv[0] !== 'bun') throw Error('DEFECT_CASE_DETECTOR_NOT_BUN')
  // A fixture run is not an observation of the corpus; recording it filled the dormancy window.
  const run = Bun.spawnSync([process.execPath, ...argv.slice(1)], {
    cwd: ROOT,
    env: { ...process.env, CREATE_SDD_TELEMETRY: '0' },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const out = run.stdout.toString()
  const start = out.indexOf('{')
  if (start < 0) throw Error(`DEFECT_CASE_DETECTOR_NO_OUTPUT:${run.stderr.toString().trim()}`)
  return codesIn(JSON.parse(out.slice(start)) as unknown)
}

/**
 * Decide every mechanical case by running its detector.
 *
 * A case passes when the code fires on the fixture and stays silent on the repaired one. The second
 * half is what makes the result mean anything: a detector that fires on everything would satisfy the
 * first half alone, and that is exactly the shape a rule takes when it is written to be seen passing
 * rather than to catch something.
 */
export function runSuite(cases: readonly DefectCase[]): readonly CaseResult[] {
  const scratch = mkdtempSync(join(tmpdir(), 'defect-suite-'))
  try {
    return cases.map((entry) => runCase(entry, scratch))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function runCase(entry: DefectCase, scratch: string): CaseResult {
  {
    const repository = entry.repository
      ? materialiseRepository(entry.repository, scratch, entry.id)
      : undefined
    const codes = runDetector(
      entry.detector.command,
      materialise(entry.fixture, scratch, `${entry.id}-positive`, repository),
      repository
    )
    const fired = codes.has(entry.detector.expected_code)
    let negativeFired: boolean | null = null
    if (entry.negative_fixture)
      negativeFired = runDetector(
        entry.detector.command,
        materialise(entry.negative_fixture, scratch, `${entry.id}-negative`, repository),
        repository
      ).has(entry.detector.expected_code)
    const wantNegative = entry.negative_expectation?.must_fire ?? false
    return {
      id: entry.id,
      fired,
      negative_fired: negativeFired,
      pass:
        fired === entry.detector.must_fire &&
        (negativeFired === null || negativeFired === wantNegative),
      codes: [...codes].sort()
    }
  }
}

export function defectCases(file = CASES_FILE): readonly DefectCase[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { cases?: DefectCase[] }).cases ?? []
}

/**
 * Cases kept out of the visible suite.
 *
 * `rsi.ts suite` never reads these, so ordinary work is done without them in view; `evaluate` runs
 * them and reports them apart from the rest. The separation is what gives a round a result the work
 * was not aimed at. It is detection, not prevention: the same account can open these files, and the
 * commitments taken at `open` make that visible rather than impossible.
 */
export function heldOutCases(dir = HELD_OUT): readonly DefectCase[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap(
      (name) =>
        (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { cases?: DefectCase[] }).cases ?? []
    )
}

/* ------------------------------------------------------------------ round protocol */

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Digest the skill version that an evaluation actually ran, excluding local observations/history. */
function skillVersion(): string {
  const hash = createHash('sha256')
  const add = (path: string) => {
    if (!existsSync(path)) return
    const name = relative(ROOT, path)
    if (name === 'rsi/telemetry.jsonl' || name === 'rsi/open-round.json' || name === 'rsi/rounds')
      return
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry === 'node_modules' || entry === 'coverage' || entry.startsWith('.')) continue
        add(join(path, entry))
      }
      return
    }
    hash.update(name).update('\0').update(readFileSync(path)).update('\0')
  }
  add(ROOT)
  return hash.digest('hex')
}

/** Files a round commits to, so a change to any of them during the round is visible afterwards. */
function commitments(): Record<string, string> {
  const files: Record<string, string> = {}
  // Fixture workspaces are directories, so this walks rather than listing: a case whose verdict
  // depends on a lockfile is only committed to if that lockfile is committed to as well.
  const add = (path: string) => {
    if (!existsSync(path)) return
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) add(join(path, entry))
      return
    }
    files[relative(ROOT, path)] = sha256(readFileSync(path, 'utf8'))
  }
  add(CASES_FILE)
  add(join(ROOT, 'cases', 'behavior-cases.json'))
  add(join(ROOT, 'cases', 'fixtures'))
  add(HELD_OUT)
  return files
}

/**
 * The dimensions the skill is not allowed to grow along without saying so.
 *
 * `validator.lines` alone once left repo-facts, lifecycle and this file — over half the scripts —
 * outside every ceiling, so growth simply moved there. `scripts.lines` and `tests.lines` cover all of
 * it; the validator figure stays because its ceiling history is recorded against it.
 */
export function measure(): Record<string, number> {
  const lines = (dir: string) => {
    let total = 0
    const walkAll = (base: string, match: (name: string) => boolean) => {
      for (const entry of readdirSync(base)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue
        const full = join(base, entry)
        if (statSync(full).isDirectory()) walkAll(full, match)
        else if (match(entry)) total += readFileSync(full, 'utf8').split('\n').length
      }
    }
    walkAll(dir, (name) => name.endsWith('.md') || name.endsWith('.ts'))
    return total
  }
  const behaviour = existsSync(join(ROOT, 'cases', 'behavior-cases.json'))
    ? ((
        JSON.parse(readFileSync(join(ROOT, 'cases', 'behavior-cases.json'), 'utf8')) as {
          cases?: unknown[]
        }
      ).cases?.length ?? 0)
    : 0
  return {
    'SKILL.md.characters': readFileSync(join(ROOT, 'SKILL.md'), 'utf8').length,
    'references.lines': lines(join(ROOT, 'references')),
    'review.md.characters': existsSync(join(ROOT, 'references', 'review.md'))
      ? readFileSync(join(ROOT, 'references', 'review.md'), 'utf8').length
      : 0,
    'validator.lines': lines(join(ROOT, 'scripts', 'validator')),
    'scripts.lines': lines(join(ROOT, 'scripts')),
    'tests.lines': existsSync(join(ROOT, 'tests')) ? lines(join(ROOT, 'tests')) : 0,
    behavior_cases: behaviour
  }
}

type Round = {
  id: string
  kind: Kind
  goal: string
  opened_at: string
  head: string
  commitments: Record<string, string>
  budget: Record<string, number>
  /** These inputs and the champion version are fixed when the round opens. */
  source_at_open: string
  rule_assets_at_open: string[]
  ceilings_at_open: Record<string, number>
  /** Rule count when the round opened; a consolidation must end below or at it. */
  rules_at_open?: number
  /** Advisory debt level when the round opened. */
  debt_at_open?: DebtLevel
  /** Observations this round settles; close moves their text from the queue into the record. */
  settles?: Settlement[]
  baseline?: { at: string; results: readonly CaseResult[]; heldOut?: readonly CaseResult[] }
  candidate?: {
    at: string
    source_version: string
    results: readonly CaseResult[]
    regressions: string[]
    repairs: string[]
    missing_cases: string[]
    heldOut?: readonly CaseResult[]
  }
  prune?: {
    source_version: string
    over_budget: readonly unknown[]
    unjustified_additions: readonly string[]
    undecided_removals: readonly string[]
    not_net_negative: readonly string[]
  }
}

/** Compare outcomes only for cases already present in the opened baseline. */
function caseDelta(before: readonly CaseResult[], after: readonly CaseResult[]) {
  const initial = new Map(before.map((result) => [result.id, result.pass]))
  const observed = new Map(after.map((result) => [result.id, result.pass]))
  const missing_cases = [...initial.keys()].filter((id) => !observed.has(id))
  const regressions = after
    .filter((result) => initial.get(result.id) === true && !result.pass)
    .map((result) => result.id)
  const repairs = after
    .filter((result) => initial.get(result.id) === false && result.pass)
    .map((result) => result.id)
  return { regressions, repairs, missing_cases }
}

const git = (...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    .stdout.toString()
    .trim()

/**
 * Held-out case files whose contents no longer match what the round committed to.
 *
 * This is a real check: the digests were written before the change and the comparison reads the
 * files now. What it is not is prevention — the same account that runs the round can edit these
 * files, and nothing here stops it. It makes the edit visible, and that is the whole claim.
 */
export function heldOutTampering(
  commitments: Readonly<Record<string, string>>,
  root = ROOT
): readonly string[] {
  return Object.entries(commitments)
    .filter(([path]) => path.startsWith('cases/held-out/'))
    .filter(
      ([path, digest]) =>
        !existsSync(join(root, path)) || sha256(readFileSync(join(root, path), 'utf8')) !== digest
    )
    .map(([path]) => path)
}

/** An improvement may add evidence, but cannot rewrite cases used to set its baseline. */
function changedCommittedCases(commitments: Readonly<Record<string, string>>): string[] {
  return Object.entries(commitments)
    .filter(
      ([path, digest]) =>
        !existsSync(join(ROOT, path)) || sha256(readFileSync(join(ROOT, path), 'utf8')) !== digest
    )
    .map(([path]) => path)
}

function openRound(): Round {
  if (!existsSync(OPEN_ROUND)) throw Error('RSI_NO_OPEN_ROUND')
  return JSON.parse(readFileSync(OPEN_ROUND, 'utf8')) as Round
}

const saveRound = (round: Round) => writeFileSync(OPEN_ROUND, `${JSON.stringify(round, null, 2)}\n`)

/**
 * Paths a round may not touch, and why each one is on the list.
 *
 * Changing a held-out case, a completion oracle or a detector's expected code inside the same round
 * that claims an improvement would let the round move the target it is being measured against. The
 * check is real enforcement of *that* — it reads the diff — and it is not enforcement of anything
 * else: an author with write access can still change these in a round of their own, which is what
 * `--kind case-amendment` is for. Say so plainly rather than implying a sandbox exists.
 */
function forbiddenChanges(round: Round): string[] {
  if (round.kind !== 'improvement') return []
  // Untracked files do not appear in a diff, and a new case file is untracked by definition, so the
  // guard reads the working tree as well — reading only the diff once let a round edit a detector's
  // expected code unnoticed.
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'cases')
    .split('\n')
    .filter(Boolean)
  const changed = [
    ...git('diff', '--name-only', round.head).split('\n').filter(Boolean),
    ...untracked
  ]
  return weakenings(changed, git('diff', round.head, '--', 'cases'))
}

/**
 * Changes that would move the target a round is measured against.
 *
 * Only a removed or rewritten line counts: adding a case raises the bar, so a purely additive diff
 * is not a finding. A file git has never seen has no prior version to compare against, so nothing in
 * it can be judged here — that is a limit of the check, stated rather than guessed around.
 */
export function weakenings(changed: readonly string[], diff: string): string[] {
  const findings: string[] = []
  // Prose about the directory is not a case; only the cases themselves are held out.
  for (const path of changed)
    if (path.startsWith('cases/held-out/') && !path.endsWith('.md')) findings.push(path)
  const guarded: readonly (readonly [string, string])[] = [
    ['completion_oracle', 'a completion oracle'],
    ['expected_code', "a detector's expected code"]
  ]
  for (const [needle, label] of guarded)
    if (
      diff
        .split('\n')
        .some((line) => line.startsWith('-') && !line.startsWith('---') && line.includes(needle))
    )
      findings.push(`${label} was removed or rewritten inside an improvement round`)
  return findings
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv
  if (command === 'catalog') {
    const rules = catalog()
    if (rest.includes('--render')) {
      mkdirSync(join(ROOT, 'rsi'), { recursive: true })
      writeFileSync(
        RULES_FILE,
        `${JSON.stringify({ protocol: 'skill-rule-ledger/v1', derived_from: 'scripts and tests of this skill', rules }, null, 2)}\n`
      )
      console.log(
        JSON.stringify({
          protocol: 'skill-rule-ledger/v1',
          written: RULES_FILE,
          rules: rules.length
        })
      )
      return 0
    }
    let stored: { rules?: readonly Rule[] } = {}
    try {
      stored = JSON.parse(readFileSync(RULES_FILE, 'utf8')) as { rules?: readonly Rule[] }
    } catch {
      stored = {}
    }
    const drifted = JSON.stringify(stored.rules ?? []) !== JSON.stringify(rules)
    console.log(
      JSON.stringify({
        protocol: 'skill-rule-ledger/v1',
        rules: rules.length,
        stored: stored.rules?.length ?? 0,
        drifted,
        hint: drifted ? 'run rsi.ts catalog --render' : undefined
      })
    )
    return drifted ? 1 : 0
  }
  if (command === 'audit') {
    const windowIndex = rest.indexOf('--window')
    const window = windowIndex >= 0 ? Number(rest[windowIndex + 1]) : DEFAULT_WINDOW
    const entries = readTelemetry()
    const rules = catalog()
    const report = health(rules, entries, window)
    const never = report.filter((rule) => rule.fires_window === 0)
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-rule-audit/v1',
          window,
          observations: entries.length,
          runs: new Set(entries.map((entry) => entry.sdd_sha)).size,
          observation_unit: 'distinct document revision',
          rules: rules.length,
          never_fired: never.length,
          top_cost_per_fire: [...report]
            .filter((rule) => rule.cost_per_fire !== null)
            .sort((a, b) => (b.cost_per_fire ?? 0) - (a.cost_per_fire ?? 0))
            .slice(0, 5),
          fired: report.filter((rule) => rule.fires_window > 0),
          never_fired_assets: never.map((rule) => rule.asset),
          limits: [
            'a code that never fired may still be correct: this corpus may simply not contain its defect',
            'a fired code is not thereby proven useful; it is proven reachable',
            'redundancy is computed over documents seen in the window, not over the space of documents'
          ]
        },
        null,
        2
      )
    )
    return 0
  }

  if (command === 'health') {
    const current = skillHealth()
    console.log(JSON.stringify(current, null, 2))
    return 0
  }
  if (command === 'update') {
    const current = skillHealth()
    const stored = readJson<{ rules?: readonly Rule[] }>(RULES_FILE, {})
    const drifted = JSON.stringify(stored.rules ?? []) !== JSON.stringify(catalog())
    const open = existsSync(OPEN_ROUND) ? openRound().id : undefined
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-rsi-update/v1',
          level: current.level,
          signals: current.signals,
          agenda: updateAgenda({
            health: current,
            ...(open ? { open_round: open } : {}),
            catalog_drifted: drifted
          }),
          undisposed_dormant: current.undisposed_dormant,
          redundant_pairs: current.redundant_pairs,
          limits: current.limits
        },
        null,
        2
      )
    )
    return 0
  }
  if (command === 'suite') {
    const results = runSuite(defectCases())
    const failed = results.filter((result) => !result.pass)
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-defect-suite/v1',
          cases: results.length,
          failed: failed.length,
          results
        },
        null,
        2
      )
    )
    return failed.length ? 1 : 0
  }
  if (command === 'open') {
    if (existsSync(OPEN_ROUND)) {
      console.error(`a round is already open: ${OPEN_ROUND}`)
      return 1
    }
    const kindIndex = rest.indexOf('--kind')
    const goalIndex = rest.indexOf('--goal')
    const kind = rest[kindIndex + 1] as Kind
    if (kindIndex < 0 || !KINDS.includes(kind) || goalIndex < 0) {
      console.error(USAGE)
      return 2
    }
    const current = skillHealth()
    const rules = catalog()
    const round: Round = {
      id: `R-${new Date()
        .toISOString()
        .replace(/[^0-9]/g, '')
        .slice(0, 14)}`,
      kind,
      goal: rest.slice(goalIndex + 1).join(' '),
      opened_at: new Date().toISOString(),
      head: git('rev-parse', 'HEAD'),
      commitments: commitments(),
      budget: measure(),
      source_at_open: skillVersion(),
      rule_assets_at_open: rules.map((rule) => rule.asset),
      ceilings_at_open:
        readJson<{ ceilings?: Record<string, number> }>(BUDGET_FILE, {}).ceilings ?? {},
      rules_at_open: rules.length,
      debt_at_open: current.level
    }
    mkdirSync(join(ROOT, 'rsi'), { recursive: true })
    saveRound(round)
    console.log(
      JSON.stringify({ protocol: 'skill-rsi-round/v1', opened: round.id, round }, null, 2)
    )
    return 0
  }
  if (command === 'baseline') {
    const round = openRound()
    if (round.baseline) {
      console.error('the opened baseline is immutable; start a new round to change it')
      return 1
    }
    if (!round.source_at_open || round.source_at_open !== skillVersion()) {
      console.error('the skill changed after open; start a new round before recording its baseline')
      return 1
    }
    const results = runSuite(defectCases())
    const heldOut = runSuite(heldOutCases())
    if (round.source_at_open !== skillVersion()) {
      console.error('the skill changed while measuring the baseline; start a new round')
      return 1
    }
    round.baseline = { at: new Date().toISOString(), results, heldOut }
    saveRound(round)
    const failed = round.baseline.results.filter((result) => !result.pass)
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-rsi-round/v1',
          round: round.id,
          baseline_cases: round.baseline.results.length,
          baseline_failures: failed.map((result) => result.id),
          note: 'The champion is allowed to fail cases; the comparison is against this record, not against perfection.'
        },
        null,
        2
      )
    )
    return 0
  }
  if (command === 'evaluate') {
    const round = openRound()
    if (!round.baseline) {
      console.error('no baseline: run rsi.ts baseline before changing anything')
      return 1
    }
    const forbidden = forbiddenChanges(round)
    const tampered = heldOutTampering(round.commitments)
    const changedCases =
      round.kind === 'improvement' ? changedCommittedCases(round.commitments) : []
    if (forbidden.length || tampered.length || changedCases.length) {
      console.log(
        JSON.stringify(
          {
            protocol: 'skill-rsi-round/v1',
            round: round.id,
            refused: true,
            forbidden_changes: forbidden,
            held_out_changed: tampered,
            committed_cases_changed: changedCases,
            note: 'A round may not move the target it is measured against. Amend cases in a --kind case-amendment round, which cannot claim an improvement.'
          },
          null,
          2
        )
      )
      return 1
    }
    const version = skillVersion()
    const results = runSuite(defectCases())
    const heldOut = runSuite(heldOutCases())
    if (version !== skillVersion()) {
      console.error('the skill changed while evaluating the candidate; rerun evaluate')
      return 1
    }
    const heldOutFailures = heldOut.filter((result) => !result.pass).map((result) => result.id)
    const { regressions, repairs, missing_cases } = caseDelta(round.baseline.results, results)
    round.candidate = {
      at: new Date().toISOString(),
      source_version: version,
      results,
      regressions,
      repairs,
      missing_cases,
      heldOut
    }
    saveRound(round)
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-rsi-round/v1',
          round: round.id,
          cases: results.length,
          regressions,
          repairs,
          missing_cases,
          unchanged: results.length - regressions.length - repairs.length,
          held_out_cases: heldOut.length,
          held_out_failures: heldOutFailures,
          note:
            round.kind === 'case-amendment'
              ? 'This round records case changes without claiming a repair; held-out cases must still pass.'
              : 'Previously passing and present cases must remain so; only an improvement on frozen cases may claim a repair.'
        },
        null,
        2
      )
    )
    const protectedCaseFailures =
      round.kind === 'case-amendment' ? 0 : regressions.length + missing_cases.length
    return protectedCaseFailures ||
      heldOutFailures.length ||
      (round.kind === 'improvement' && !repairs.length)
      ? 1
      : 0
  }
  if (command === 'prune') {
    const round = openRound()
    const ceilings = round.ceilings_at_open
    if (!ceilings || !round.rule_assets_at_open) {
      console.error('this round has no frozen rule and budget snapshot; open a new round')
      return 1
    }
    const now = measure()
    const over = Object.entries(ceilings)
      .map(([key, ceiling]) => ({
        dimension: key,
        ceiling,
        opened: round.budget[key] ?? ceiling,
        measured: now[key] ?? 0
      }))
      .filter(({ ceiling, opened, measured }) => measured > Math.max(ceiling, opened))
    // Compare with the opened rule set: rendering the current ledger cannot erase this delta.
    const currentAssets = new Set(catalog().map((rule) => rule.asset))
    const blessed = new Set(round.rule_assets_at_open)
    const added = [...currentAssets].filter((asset) => !blessed.has(asset))
    const removed = round.rule_assets_at_open.filter((asset) => !currentAssets.has(asset))
    const record = existsSync(SUPERSESSION)
      ? (JSON.parse(readFileSync(SUPERSESSION, 'utf8')) as {
          additions?: Addition[]
        })
      : {}
    const unjustified = added.filter(
      (asset) =>
        !(record.additions ?? []).some(
          (entry) =>
            entry.asset === asset &&
            ((entry.supersedes ?? []).length > 0
              ? entry.supersedes!.every((replaced) => blessed.has(replaced))
              : Boolean(entry.supersedes_nothing_because?.trim())) &&
            hasDecisionEvidence(entry)
        )
    )
    const dispositions =
      readJson<{ dispositions?: Disposition[] }>(DISPOSITIONS, {}).dispositions ?? []
    const undecidedRemovals = removed.filter(
      (asset) =>
        !dispositions.some(
          (entry) =>
            entry.asset === asset &&
            entry.decided_in === round.id &&
            hasDecisionEvidence(entry) &&
            (entry.disposition === 'delete' ||
              (entry.disposition === 'replace' &&
                !!entry.replacement &&
                currentAssets.has(entry.replacement)))
        )
    )
    const net =
      round.kind === 'consolidation'
        ? consolidationFindings(
            { measured: round.budget, rules: round.rules_at_open ?? Number.POSITIVE_INFINITY },
            { measured: now, rules: catalog().length }
          )
        : []
    const blocking = [
      ...(round.kind === 'budget-change' ? [] : over),
      ...unjustified,
      ...undecidedRemovals,
      ...net
    ]
    round.prune = {
      source_version: skillVersion(),
      over_budget: over,
      unjustified_additions: unjustified,
      undecided_removals: undecidedRemovals,
      not_net_negative: net
    }
    saveRound(round)
    console.log(
      JSON.stringify(
        {
          protocol: 'skill-rsi-prune/v1',
          round: round.id,
          measured: now,
          over_budget: over,
          unjustified_additions: unjustified,
          undecided_removals: undecidedRemovals,
          ...(round.kind === 'consolidation'
            ? {
                code: net.length ? 'RSI_CONSOLIDATION_NOT_NET_NEGATIVE' : undefined,
                not_net_negative: net
              }
            : {}),
          note: 'Inherited overage remains in health; this list contains only dimensions worsened beyond the opened measurement and frozen ceiling. Only a budget-change round may move a ceiling.'
        },
        null,
        2
      )
    )
    return blocking.length ? 1 : 0
  }
  if (command === 'settle') {
    const round = openRound()
    const value = (flag: string) => {
      const at = rest.indexOf(flag)
      return at >= 0 ? rest[at + 1] : undefined
    }
    const [id, as, evidence] = [value('--id'), value('--as'), value('--evidence')]
    const queue = existsSync(OBSERVED) ? observations(readFileSync(OBSERVED, 'utf8')) : []
    if (!id || !queue.some((entry) => entry.id === id)) {
      console.error(`OBSERVATION_NOT_QUEUED: ${String(id)}`)
      return 1
    }
    if (!(SETTLEMENTS as readonly string[]).includes(String(as)) || !evidence?.trim()) {
      console.error(
        'usage: rsi.ts settle --id <OD-n> --as detector|lens|class|ruling|rejected --evidence <text> [--review-results <rounds.json>]'
      )
      return 1
    }
    // Every observation declares its class, so settlements converge by class (OD-65 item 6).
    const cls = classOf(queue.find((entry) => entry.id === id)!.text)
    if (!cls) {
      console.error(
        `SETTLEMENT_CLASS_REQUIRED: ${id} needs a **Class:** line (${Object.keys(CLASS_MECHANISM).join(', ')})`
      )
      return 1
    }
    if (as === 'class' && !evidence.includes(CLASS_MECHANISM[cls])) {
      console.error(
        `SETTLEMENT_MECHANISM_REQUIRED: a class settlement shows ${CLASS_MECHANISM[cls]} catching ${id}`
      )
      return 1
    }
    // A detector settlement must name the frozen case that pins it.
    const cases = new Set(defectCases().map((entry) => entry.id))
    if (
      as === 'detector' &&
      ![...evidence.matchAll(/\bCSDD-[\w-]+/g)].some((m) => cases.has(m[0]))
    ) {
      console.error('SETTLEMENT_CASE_REQUIRED: a detector settlement names its defect case')
      return 1
    }
    // A lens settlement names an accepted round of the external review benchmark, read from the
    // `sdd-review-rounds/v1` file the author passes; the skill never locates the benchmark itself.
    if (as === 'lens') {
      const file = value('--review-results')
      const rounds =
        file && existsSync(file)
          ? readJson<{ rounds?: Record<string, unknown>[] }>(file, {}).rounds
          : []
      const accepted = new Set(
        (rounds ?? [])
          .filter((entry) => /^ACCEPTED\b/.test(String(entry.verdict ?? '')))
          .map((entry) => String(entry.id))
      )
      if (![...evidence.matchAll(/\bRR-[\w-]+/g)].some((m) => accepted.has(m[0]))) {
        console.error(
          'SETTLEMENT_LENS_ROUND_REQUIRED: a lens settlement names an ACCEPTED review round in --review-results'
        )
        return 1
      }
    }
    const settles = [...(round.settles ?? []).filter((entry) => entry.id !== id)]
    settles.push({ id, as: as as Settlement['as'], evidence })
    writeFileSync(OPEN_ROUND, `${JSON.stringify({ ...round, settles }, null, 2)}\n`)
    console.log(
      JSON.stringify({ protocol: 'skill-rsi-settle/v1', round: round.id, settles }, null, 2)
    )
    return 0
  }

  if (command === 'close') {
    const round = openRound()
    const confirmIndex = rest.indexOf('--confirm')
    if (!round.baseline || !round.candidate || !round.prune) {
      console.error('run rsi.ts evaluate and rsi.ts prune before closing')
      return 1
    }
    if (confirmIndex < 0 || rest[confirmIndex + 1] !== round.id) {
      console.error(`close requires a human confirmation: rsi.ts close --confirm ${round.id}`)
      return 1
    }
    const version = skillVersion()
    if (
      !round.candidate.source_version ||
      !round.prune.source_version ||
      version !== round.candidate.source_version ||
      version !== round.prune.source_version
    ) {
      console.error('the candidate or prune evaluation is stale; rerun evaluate and prune')
      return 1
    }
    const forbidden = forbiddenChanges(round)
    const tampered = heldOutTampering(round.commitments)
    const changedCases =
      round.kind === 'improvement' ? changedCommittedCases(round.commitments) : []
    if (forbidden.length || tampered.length || changedCases.length) {
      console.error('case commitments changed; restore them and rerun evaluate and prune')
      return 1
    }
    const results = runSuite(defectCases())
    const heldOut = runSuite(heldOutCases())
    if (version !== skillVersion()) {
      console.error('the skill changed during close; rerun evaluate and prune')
      return 1
    }
    if (
      JSON.stringify(results) !== JSON.stringify(round.candidate.results) ||
      JSON.stringify(heldOut) !== JSON.stringify(round.candidate.heldOut)
    ) {
      console.error('the same candidate produced different results; rerun evaluate and prune')
      return 1
    }
    const { regressions, repairs, missing_cases } = caseDelta(round.baseline.results, results)
    const heldOutFailures = heldOut.filter((result) => !result.pass).map((result) => result.id)
    const pruneFindings = [
      ...(round.kind === 'budget-change' ? [] : round.prune.over_budget),
      ...round.prune.unjustified_additions,
      ...round.prune.undecided_removals,
      ...round.prune.not_net_negative
    ]
    const protectedCaseFailures =
      round.kind === 'case-amendment' ? [] : [...regressions, ...missing_cases]
    const checksPassed =
      !protectedCaseFailures.length && !heldOutFailures.length && !pruneFindings.length
    const sourceChanged = !!round.source_at_open && version !== round.source_at_open
    const verdict = !checksPassed
      ? 'REJECTED'
      : round.kind === 'improvement'
        ? repairs.length && sourceChanged
          ? 'ACCEPTED'
          : 'REJECTED'
        : 'RECORDED'
    mkdirSync(ROUNDS, { recursive: true })
    const closed = {
      ...round,
      closed_at: new Date().toISOString(),
      verdict,
      repair_ids: verdict === 'ACCEPTED' ? repairs : [],
      rejection_reasons:
        verdict === 'REJECTED'
          ? [
              ...(round.kind === 'improvement' && !repairs.length
                ? ['no frozen baseline failure was repaired']
                : []),
              ...(round.kind === 'improvement' && !sourceChanged
                ? ['candidate source is unchanged from the opened version']
                : []),
              ...(round.kind === 'case-amendment'
                ? []
                : [
                    ...regressions.map((id) => `regressed: ${id}`),
                    ...missing_cases.map((id) => `baseline case removed: ${id}`)
                  ]),
              ...heldOutFailures.map((id) => `held-out case failed: ${id}`),
              ...pruneFindings.map((finding) => `prune finding: ${JSON.stringify(finding)}`)
            ]
          : [],
      not_proven: [
        'that the change makes the skill better at anything not covered by a mechanical case',
        'that an authoring agent reads, understands or follows any rule involved',
        'that a reader with write access could not have edited a case; the guard makes that visible, not impossible'
      ]
    }
    // Settled observations leave the queue only with an unrejected round, and keep their text here.
    const queueText = existsSync(OBSERVED) ? readFileSync(OBSERVED, 'utf8') : ''
    const settled = verdict === 'REJECTED' ? [] : (round.settles ?? [])
    const record = {
      ...closed,
      settled_observations: settled.map((entry) => ({
        ...entry,
        text: observations(queueText).find((item) => item.id === entry.id)?.text ?? ''
      }))
    }
    writeFileSync(join(ROUNDS, `${round.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
    if (settled.length)
      writeFileSync(OBSERVED, drainObservations(queueText, new Set(settled.map((e) => e.id))))
    unlinkSync(OPEN_ROUND)
    console.log(
      JSON.stringify(
        { protocol: 'skill-rsi-round/v1', closed: round.id, verdict: closed.verdict },
        null,
        2
      )
    )
    return closed.verdict === 'REJECTED' ? 1 : 0
  }

  console.error(USAGE)
  return 2
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)))
