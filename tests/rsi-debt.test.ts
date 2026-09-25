import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TELEMETRY_FILE } from '../scripts/lib/telemetry'
import {
  consolidationFindings,
  debt,
  levelOf,
  undisposedDormant,
  updateAgenda,
  type ClosedRound,
  type RuleHealth,
  type SkillHealth
} from '../scripts/rsi'

const round = (id: string, kind: ClosedRound['kind'], extra: Partial<ClosedRound> = {}) =>
  ({ id, kind, verdict: 'ACCEPTED', ...extra }) as ClosedRound

test('a signal reaches NOTICE, REQUIRED and FREEZE at 3, 6 and 9', () => {
  expect([2, 3, 5, 6, 8, 9, 40].map((value) => levelOf(value, [3, 6, 9]))).toEqual([
    'NONE',
    'NOTICE',
    'NOTICE',
    'REQUIRED',
    'REQUIRED',
    'FREEZE',
    'FREEZE'
  ])
})

test('debt counts only unresolved additions: evidence or a retired asset settles one', () => {
  const evidence = {
    counterexample: 'fixture X',
    scope: 'sdd/v2 leaves',
    tradeoff: 'one more code'
  }
  const additions = [
    { asset: 'code:A' },
    { asset: 'code:B', ...evidence },
    { asset: 'code:C' },
    { asset: 'code:C' }
  ]
  const result = debt({ rounds: [round('R-1', 'consolidation')], additions, undisposed: 0 })
  const byName = Object.fromEntries(result.signals.map((signal) => [signal.signal, signal.value]))
  // A consolidation does not reset history, and one asset is one decision however often it appears.
  expect(byName.additions_without_evidence).toBe(2)
  expect(result.level).toBe('NOTICE')
  const retired = debt({
    rounds: [],
    additions,
    dispositions: [
      { asset: 'code:A', disposition: 'delete', decided_in: 'R-2', ...evidence },
      { asset: 'code:C', disposition: 'delete', decided_in: 'R-2', ...evidence }
    ],
    currentAssets: new Set(['code:B']),
    undisposed: 0
  })
  expect(retired.level).toBe('NONE')
})

test('a consolidation must shrink the skill and may not grow any dimension', () => {
  const before = {
    measured: { 'scripts.lines': 100, 'references.lines': 50, behavior_cases: 4 },
    rules: 10
  }
  expect(
    consolidationFindings(before, {
      measured: { ...before.measured, 'scripts.lines': 90 },
      rules: 10
    })
  ).toEqual([])
  expect(consolidationFindings(before, { measured: before.measured, rules: 9 })).toEqual([])
  // Recording decisions alone removes nothing.
  expect(consolidationFindings(before, before)).toEqual([
    'neither the rule count nor the measured lines went down'
  ])
  // Moving growth from one dimension to another is still growth.
  expect(
    consolidationFindings(before, {
      measured: { ...before.measured, 'scripts.lines': 80, 'references.lines': 60 },
      rules: 9
    })
  ).toEqual(['references.lines grew from 50 to 60'])
})

test('a dormant rule counts until someone decides, and again once its review is due', () => {
  const rule = (asset: string, fires = 0): RuleHealth => ({
    asset,
    fires_window: fires,
    documents_window: fires,
    age_without_fire: fires ? 0 : 50,
    cost_per_fire: null,
    redundant_with: []
  })
  const base = {
    health: [
      rule('code:OLD'),
      rule('code:FIRED', 3),
      rule('code:PINNED'),
      rule('code:YOUNG'),
      rule('code:KEPT')
    ],
    pinned: new Set(['PINNED']),
    // Only a rule whose introduction is known to be old enough can be judged dormant.
    additions: [
      { asset: 'code:YOUNG', added_at: '2026-09-20' },
      { asset: 'code:OLD', added_at: '2026-08-01' },
      { asset: 'code:KEPT', added_at: '2026-08-01' },
      { asset: 'code:PINNED', added_at: '2026-08-01' }
    ],
    dispositions: [
      {
        asset: 'code:KEPT',
        disposition: 'retain' as const,
        counterexample: 'a contract block with a trailing comma',
        scope: 'every contract document',
        tradeoff: 'one guard that rarely fires',
        decided_in: 'R-1',
        revisions_at_decision: 60,
        review_after_revisions: 100
      },
      // A retain with no specific evidence decides nothing and leaves the rule counted.
      { asset: 'code:OLD', disposition: 'retain' as const, decided_in: 'R-1' }
    ],
    window: 50,
    now: new Date('2026-09-23T00:00:00Z')
  }
  expect(undisposedDormant({ ...base, runs: 100 })).toEqual(['code:OLD'])
  expect(undisposedDormant({ ...base, runs: 160 })).toEqual(['code:OLD', 'code:KEPT'])
  // Without a full window of telemetry, silence is not evidence of anything.
  expect(undisposedDormant({ ...base, runs: 10 })).toEqual([])
})

test('update suggests consolidation under debt but never withholds enhancement', () => {
  const health = (level: SkillHealth['level']): SkillHealth => ({
    protocol: 'skill-rsi-health/v1',
    level,
    signals: [],
    undisposed_dormant: [],
    redundant_pairs: [],
    review_lenses: {},
    measured: {},
    over_budget: [],
    limits: []
  })
  const steps = (level: SkillHealth['level']) =>
    updateAgenda({ health: health(level), catalog_drifted: false }).map((entry) => entry.step)
  expect(steps('FREEZE')).toEqual(['consider-consolidation', 'consider-enhancement'])
  expect(steps('NOTICE')).toEqual(['consider-consolidation', 'consider-enhancement'])
  expect(steps('NONE')).toEqual(['consider-enhancement'])
  expect(
    updateAgenda({ health: health('NONE'), open_round: 'R-9', catalog_drifted: true }).map(
      (entry) => entry.step
    )
  ).toEqual(['finish-open-round', 'reconcile-ledger', 'consider-enhancement'])
})

test('running the test suite leaves the telemetry ledger untouched', () => {
  // The suite spawns real checks; before this guard each run filled the dormancy window with fixtures.
  // The ledger is local and untracked, so a fresh checkout has none; absent must stay absent.
  const snapshot = () => (existsSync(TELEMETRY_FILE) ? readFileSync(TELEMETRY_FILE, 'utf8') : null)
  const before = snapshot()
  const validate = join(import.meta.dir, '..', 'scripts', 'validate.ts')
  Bun.spawnSync([process.execPath, validate, 'validate', '--sdd', validate], { stdout: 'pipe' })
  expect(snapshot()).toBe(before)
})
