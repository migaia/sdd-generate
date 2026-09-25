import { expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedClauses, clauseHashes } from '../scripts/validator/domain/v2-preflight'
import { render, renderRegions } from '../scripts/validator/domain/v2-render'

const FIXTURES = join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-preflight')
const index = {
  requirements: [{ id: 'R1', kind: 'must-ship', acceptance: ['A1'] }],
  steps: ['S1'],
  acceptance: ['A1']
}

test('an amendment reports the changed clause and the clauses that cite it', () => {
  const before = clauseHashes(index, '- R1 Old wording.\n- S1 Build it.\n- A1 Checks R1.\n')
  const after = '- R1 New wording.\n- S1 Build it.\n- A1 Checks R1.\n'
  expect(affectedClauses(index, after, before)).toEqual({ changed: ['R1'], citing: ['A1'] })
})

test('regions render from the contract and nothing else', () => {
  expect(render({ preserve: ['A3', 'A7'] }, 'preserve')).toBe('Preserve acceptance: A3, A7.')
  const gates = {
    preflight: [{ id: 'P2', covers: [], command: 'pnpm run lint', expect: 'pass', gate: true }]
  }
  expect(render(gates, 'gates')).toBe('- P2: `pnpm run lint`')
  const doc = 'x\n<!-- sdd-generated:preserve -->\nstale\n<!-- /sdd-generated:preserve -->\n'
  expect(renderRegions(doc, { preserve: [] })).toContain('No preserve acceptance.')
})

test('the runner fails a write outside writes and passes a caught perturbation', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-test-'))
  try {
    cpSync(join(FIXTURES, 'repo'), join(root, 'repo'), { recursive: true })
    cpSync(join(FIXTURES, 'bc1.patch'), join(root, 'bc1.patch'))
    const sdd = join(root, 't.md')
    writeFileSync(
      sdd,
      readFileSync(join(FIXTURES, 'ok.md'), 'utf8').replace(
        '"gate": true }',
        `"gate": true },
    { "id": "P3", "covers": ["A1"], "command": "echo x > outside.txt", "expect": "pass", "gate": true },
    { "id": "P4", "covers": ["A1"], "patch": "bc1.patch", "command": "grep -q old packages/feature-a/index.ts", "expect": "fail" }`
      )
    )
    const run = Bun.spawnSync(
      [
        'bun',
        join(import.meta.dir, '..', 'scripts', 'preflight.ts'),
        'run',
        '--sdd',
        sdd,
        '--repository',
        join(root, 'repo')
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    expect(run.exitCode).toBe(1)
    const report = JSON.parse(readFileSync(`${sdd}.preflight.json`, 'utf8'))
    const outcome = Object.fromEntries(
      report.items.map((item: { id: string; outcome: string }) => [item.id, item.outcome])
    )
    expect(outcome).toEqual({ P1: 'PASS', P2: 'PASS', P3: 'FAIL', P4: 'PASS' })
    expect(report.items[2].writes_outside).toEqual(['outside.txt'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
