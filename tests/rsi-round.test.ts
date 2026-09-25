import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codesIn,
  defectCases,
  heldOutCases,
  heldOutTampering,
  measure,
  runSuite,
  weakenings
} from '../scripts/rsi'

test('codes are collected from fields and from the umbrella message alike', () => {
  const output = {
    valid: false,
    diagnostics: [
      { code: 'SDD_CONTRACT_INVALID', message: 'DELIVERY_PLAN_REQUIREMENT_UNKNOWN: PC01' }
    ],
    issues: [{ code: 'API_SURFACE_DEGENERATE_INPUT', detail: 'nothing can be supplied' }]
  }
  const codes = codesIn(output)
  // Reading only `code` fields would report one rule where two fired.
  expect(codes.has('SDD_CONTRACT_INVALID')).toBe(true)
  expect(codes.has('DELIVERY_PLAN_REQUIREMENT_UNKNOWN')).toBe(true)
  expect(codes.has('API_SURFACE_DEGENERATE_INPUT')).toBe(true)
})

test('every mechanical case fires on its fixture and stays silent on the repaired one', () => {
  const results = runSuite(defectCases())
  expect(results.length).toBeGreaterThanOrEqual(8)
  const failed = results.filter((result) => !result.pass)
  expect(failed.map((result) => result.id)).toEqual([])
  // Silence on one side is what makes a pass mean anything: a detector that fired on both fixtures
  // would satisfy a must-fire case alone. A false-positive case is silent on its positive side.
  expect(results.every((result) => !(result.fired && result.negative_fired === true))).toBe(true)
  // Replay cases build real Git histories and run oracles three times; the default 5 s is too short.
}, 60_000)

test('a held-out case edited after the round opened is reported', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsi-heldout-'))
  try {
    mkdirSync(join(root, 'cases', 'held-out'), { recursive: true })
    const path = join(root, 'cases', 'held-out', 'case.json')
    writeFileSync(path, '{"id":"HO-001"}')
    const digest = createHash('sha256').update('{"id":"HO-001"}').digest('hex')
    const committed = { 'cases/held-out/case.json': digest }
    expect(heldOutTampering(committed, root)).toEqual([])
    writeFileSync(path, '{"id":"HO-001","expected_code":"ALWAYS_PASSES"}')
    expect(heldOutTampering(committed, root)).toEqual(['cases/held-out/case.json'])
    rmSync(path)
    // A deleted case is tampering too; only a matching file counts as untouched.
    expect(heldOutTampering(committed, root)).toEqual(['cases/held-out/case.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the budget dimensions are measured, not asserted', () => {
  const measured = measure()
  expect(Object.keys(measured).sort()).toEqual([
    'SKILL.md.characters',
    'behavior_cases',
    'references.lines',
    'review.md.characters',
    'scripts.lines',
    'tests.lines',
    'validator.lines'
  ])
  for (const value of Object.values(measured)) expect(value).toBeGreaterThan(0)
})

test('a round that weakens a case is refused, while one that adds a case is not', () => {
  const removed = [
    '-      "expected_code": "API_SURFACE_DEGENERATE_INPUT",',
    '+      "expected_code": "ALWAYS_PASSES",'
  ].join('\n')
  expect(weakenings([], removed)).toEqual([
    "a detector's expected code was removed or rewritten inside an improvement round"
  ])
  const added = '+      "expected_code": "DELIVERY_PLAN_REQUIREMENT_UNKNOWN",'
  // Adding a case raises the bar; refusing that would make the loop unable to grow its own evidence.
  expect(weakenings([], added)).toEqual([])
  expect(weakenings(['cases/held-out/case-a.json'], '')).toEqual(['cases/held-out/case-a.json'])
  // Prose about the directory is not a case.
  expect(weakenings(['cases/held-out/README.md'], '')).toEqual([])
})

test('held-out cases are invisible to the suite and still decidable', () => {
  const visible = new Set(defectCases().map((entry) => entry.id))
  const held = heldOutCases()
  expect(held.length).toBeGreaterThan(0)
  // The whole point is that the visible suite cannot see them: a case in both sets is held out of
  // nothing.
  for (const entry of held) expect(visible.has(entry.id)).toBe(false)
  const results = runSuite(held)
  expect(results.filter((result) => !result.pass).map((result) => result.id)).toEqual([])
})
