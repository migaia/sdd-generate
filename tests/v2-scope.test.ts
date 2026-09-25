import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateV2Document } from '../scripts/validator/domain/v2-document'

const DIR = join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-scope')
const codes = (file: string, text?: string) =>
  validateV2Document(join(DIR, file), text ?? readFileSync(join(DIR, file), 'utf8'))!
    .handoff.candidates.map((c) => c.code)
    .filter((code) => code.startsWith('SDD_V2_') && !code.includes('QUANTIFIER'))

test('each scope gap is reported, and its repaired design is clean', () => {
  const expected: Record<string, string> = {
    enum: 'SDD_V2_ENUMERATED_OPERATION_UNCOVERED',
    state: 'SDD_V2_STATE_SPACE_UNSTATED',
    preserve: 'SDD_V2_PRESERVATION_UNPINNED',
    variant: 'SDD_V2_VARIANT_MATRIX_MISSING',
    cost: 'SDD_V2_SCALING_ORACLE_UNSCOPED',
    timing: 'SDD_V2_TIMING_ORACLE_UNISOLATED',
    status: 'SDD_V2_STATUS_CLAIM_UNCHECKED'
  }
  for (const [name, code] of Object.entries(expected)) {
    expect(codes(`${name}.md`)).toContain(code)
    expect(codes(`${name}.ok.md`)).not.toContain(code)
  }
})

test('a preserved-branch entry without a base file:line does not pin the claim', () => {
  const ok = readFileSync(join(DIR, 'preserve.ok.md'), 'utf8')
  const unpinned = ok.replace('packages/feature-a/index.ts:1', 'packages/feature-a/index.ts')
  expect(codes('preserve.ok.md', unpinned)).toContain('SDD_V2_PRESERVATION_UNPINNED')
})

test('a scaling outcome needs both the end-to-end timing and the cost-path inventory', () => {
  const ok = readFileSync(join(DIR, 'cost.ok.md'), 'utf8')
  const counterOnly = ok.replace(
    /- A2 [^\n]*\n/,
    '- A2 `metrics().visits` stays at most 2 per plugin.\n'
  )
  expect(codes('cost.ok.md', counterOnly)).toContain('SDD_V2_SCALING_ORACLE_UNSCOPED')
  const noPaths = ok.replace('"kind": "cost-path"', '"kind": "invariant"')
  expect(codes('cost.ok.md', noPaths)).toContain('SDD_V2_SCALING_ORACLE_UNSCOPED')
})

test('a dedicated oracle script counts as isolation, and a design status is not a claim', () => {
  const bad = readFileSync(join(DIR, 'timing.md'), 'utf8')
  const scripted = bad.replace(
    '"writes"',
    '"oracles": { "A1": { "script": "test:timing", "stdout": "ok" } },\n  "writes"'
  )
  expect(codes('timing.md', scripted)).not.toContain('SDD_V2_TIMING_ORACLE_UNISOLATED')
  const zh = readFileSync(join(DIR, 'status.ok.md'), 'utf8').replace(
    '- Status: design; delivery state is the closure `validate --evidence` computes.',
    '- 文档状态：**verified / SHIP**（修复轮 revision 2）'
  )
  expect(codes('status.ok.md', zh)).toContain('SDD_V2_STATUS_CLAIM_UNCHECKED')
})
