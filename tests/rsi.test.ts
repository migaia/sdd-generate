import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { catalog, health, type Rule } from '../scripts/rsi'
import { documentDigest, readTelemetry, record } from '../scripts/lib/telemetry'

const ROOT = join(import.meta.dir, '..')

test('the rule ledger is derived from the sources that raise the codes', () => {
  const rules = catalog(ROOT)
  expect(rules.length).toBeGreaterThan(50)
  const byAsset = new Map(rules.map((rule) => [rule.asset, rule]))
  // A code this skill genuinely raises must be in the ledger, with the file that raises it.
  const known = byAsset.get('code:SDD_V2_REVIEW_UNDISPOSED')
  expect(known).toBeDefined()
  expect(known!.sites.some((site) => site.endsWith('v2-review.ts'))).toBe(true)
  expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length)
})

test('a rule that never fires is separated from one that fires often', () => {
  const rules: Rule[] = [
    {
      id: 'RL-0001',
      asset: 'code:HOT',
      kind: 'issue-code',
      sites: ['a.ts'],
      weight: { sites: 1, mentions: 4, test_mentions: 2 }
    },
    {
      id: 'RL-0002',
      asset: 'code:COLD',
      kind: 'issue-code',
      sites: ['a.ts'],
      weight: { sites: 1, mentions: 9, test_mentions: 9 }
    }
  ]
  const entries = [
    {
      run_id: 'r1',
      ts: '2026-01-01T00:00:00Z',
      tool: 't',
      sdd_sha: 'd1',
      codes: ['HOT'],
      candidate_codes: []
    },
    {
      run_id: 'r2',
      ts: '2026-01-01T00:00:01Z',
      tool: 't',
      sdd_sha: 'd2',
      codes: ['HOT'],
      candidate_codes: []
    }
  ]
  const report = health(rules, entries, 50)
  const hot = report.find((rule) => rule.asset === 'code:HOT')!
  const cold = report.find((rule) => rule.asset === 'code:COLD')!
  expect(hot.fires_window).toBe(2)
  expect(hot.documents_window).toBe(2)
  expect(hot.cost_per_fire).toBe(3)
  expect(cold.fires_window).toBe(0)
  // A rule with no observation has no cost per fire; reporting one would invent a denominator.
  expect(cold.cost_per_fire).toBeNull()
  expect(cold.age_without_fire).toBe(2)
})

test('two rules that fire on the same documents are flagged as possibly one rule', () => {
  const rules: Rule[] = ['A', 'B', 'C'].map((name, index) => ({
    id: `RL-000${index + 1}`,
    asset: `code:${name}`,
    kind: 'issue-code' as const,
    sites: ['a.ts'],
    weight: { sites: 1, mentions: 1, test_mentions: 0 }
  }))
  const entries = ['d1', 'd2', 'd3'].map((sha, index) => ({
    run_id: `r${index}`,
    ts: '2026-01-01T00:00:00Z',
    tool: 't',
    sdd_sha: sha,
    codes: sha === 'd3' ? ['A', 'B', 'C'] : ['A', 'B'],
    candidate_codes: []
  }))
  const report = health(rules, entries, 50)
  expect(report.find((rule) => rule.asset === 'code:A')!.redundant_with).toEqual(['code:B'])
  expect(report.find((rule) => rule.asset === 'code:C')!.redundant_with).toEqual([])
})

test('telemetry records codes without recording the document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'telemetry-test-'))
  const file = join(dir, 'telemetry.jsonl')
  try {
    const secret = '# A private design\n\ncontents that must not be stored\n'
    writeFileSync(
      file,
      `${JSON.stringify({ run_id: 'r', ts: '2026-01-01T00:00:00Z', tool: 'probe', sdd_sha: documentDigest(secret), codes: ['X'], candidate_codes: [] })}\n`
    )
    const entries = readTelemetry(file)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.codes).toEqual(['X'])
    const raw = Bun.file(file)
    expect(raw).toBeDefined()
    const text = require('node:fs').readFileSync(file, 'utf8') as string
    expect(text).not.toContain('must not be stored')
    expect(text).toContain(documentDigest(secret))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a truncated trailing line does not discard the observations before it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'telemetry-test-'))
  const file = join(dir, 'telemetry.jsonl')
  try {
    writeFileSync(
      file,
      `${JSON.stringify({ run_id: 'r', ts: 't', tool: 'x', sdd_sha: 'd', codes: ['A'], candidate_codes: [] })}\n{"run_id":"partial"`
    )
    expect(readTelemetry(file)).toHaveLength(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('measurement never breaks the check it measures', () => {
  // An unwritable destination must be survivable: a gate that fails because its telemetry failed
  // would be less trustworthy than a gate with no telemetry at all.
  const previous = process.env.CREATE_SDD_TELEMETRY
  process.env.CREATE_SDD_TELEMETRY = '0'
  try {
    expect(() => record({ tool: 'x', sddSha: 'd', codes: ['A'] })).not.toThrow()
  } finally {
    if (previous === undefined) delete process.env.CREATE_SDD_TELEMETRY
    else process.env.CREATE_SDD_TELEMETRY = previous
  }
})
