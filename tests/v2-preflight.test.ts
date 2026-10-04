import { expect, test } from 'bun:test'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedClauses, clauseHashes } from '../scripts/validator/domain/v2-preflight'
import { validateV2Document } from '../scripts/validator/domain/v2-document'
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
    { "id": "P5", "covers": ["A1"], "command": "echo x > outside.txt", "expect": "pass", "gate": true },
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
    expect(outcome).toEqual({ P1: 'PASS', P3: 'PASS', P2: 'PASS', P5: 'FAIL', P4: 'PASS' })
    expect(report.items[3].writes_outside).toEqual(['outside.txt'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-72, OD-78: workspace links point into the copy, and declared ignored inputs are copied', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-workspace-'))
  const repo = join(root, 'repo')
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo })
  try {
    mkdirSync(join(repo, 'packages', 'a'), { recursive: true })
    mkdirSync(join(repo, 'packages', 'b', 'node_modules'), { recursive: true })
    mkdirSync(join(repo, 'docs'))
    writeFileSync(join(repo, '.gitignore'), 'node_modules\ndocs/local.md\n')
    writeFileSync(join(repo, 'packages', 'a', 'package.json'), '{ "name": "a" }\n')
    writeFileSync(join(repo, 'packages', 'a', 'index.js'), "export const v = 'old'\n")
    writeFileSync(join(repo, 'packages', 'b', 'package.json'), '{ "name": "b" }\n')
    // pnpm's workspace link: b depends on its sibling a through a relative symlink.
    symlinkSync('../../a', join(repo, 'packages', 'b', 'node_modules', 'a'))
    writeFileSync(join(repo, 'docs', 'local.md'), 'generated\n')
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    writeFileSync(join(repo, 'packages', 'a', 'index.js'), "export const v = 'new'\n")
    writeFileSync(join(root, 'a.patch'), git('diff').stdout.toString())
    git('checkout', '--', '.')
    const sdd = join(root, 't.md')
    const items = [
      {
        id: 'P1',
        covers: ['BC1'],
        patch: 'a.patch',
        command: 'grep -q new packages/b/node_modules/a/index.js',
        expect: 'pass'
      },
      {
        id: 'P2',
        covers: [],
        command: 'test -f docs/local.md',
        expect: 'pass',
        gate: true,
        inputs: ['docs/local.md']
      }
    ]
    const contract = {
      protocol: 'sdd/v2',
      id: 't',
      revision: '1',
      writes: ['packages'],
      preflight: items
    }
    writeFileSync(
      sdd,
      `# T\n\n<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify(contract)}\n\`\`\`\n<!-- sdd-contract:end -->\n`
    )
    const run = Bun.spawnSync(
      [
        'bun',
        join(import.meta.dir, '..', 'scripts', 'preflight.ts'),
        'run',
        '--sdd',
        sdd,
        '--repository',
        repo
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const report = JSON.parse(readFileSync(`${sdd}.preflight.json`, 'utf8'))
    expect(report.items.map((item: { outcome: string }) => item.outcome)).toEqual(['PASS', 'PASS'])
    expect(report.inputs_sha).toMatch(/^[0-9a-f]{12}$/)
    expect(run.exitCode).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Diagnostic messages and candidate details of one fixture document against a fixture repository. */
const findings = (dir: string, file: string, repository: string) => {
  const path = join(dir, file)
  const result = validateV2Document(path, readFileSync(path, 'utf8'), [], repository)!
  return [
    ...result.diagnostics.map((d) => d.message),
    ...result.handoff.candidates.map((c) => `${c.code} ${c.detail}`)
  ]
}

test('OD-75, OD-77, OD-79: base polarity, history-only edits and touched package gates', () => {
  const repo = join(FIXTURES, 'repo')
  const has = (file: string, text: string, repository = repo) =>
    findings(FIXTURES, file, repository).some((m) => m.includes(text))
  // A change acceptance needs a base run that fails; ok.md has P3, polarity.md does not.
  expect(has('polarity.md', 'change-base-uncovered')).toBe(true)
  expect(has('ok.md', 'change-base-uncovered')).toBe(false)
  // A Clarifications record keeps the report fresh; a reworded clause stales it.
  expect(has('clarified.md', 'SDD_V2_PREFLIGHT_STALE')).toBe(false)
  expect(has('stale.md', 'changed R1')).toBe(true)
  // typecheck:e2e of the touched package must be a gate item.
  const gates = join(FIXTURES, 'repo-gates')
  expect(has('gates.md', 'packages/feature-a:typecheck:e2e', gates)).toBe(true)
  expect(has('gates.ok.md', 'gate-script-uncovered', gates)).toBe(false)
  // OD-104: the handoff lists every derived package gate, e2e included, for the host to run.
  const ok = join(FIXTURES, 'gates.ok.md')
  expect(validateV2Document(ok, readFileSync(ok, 'utf8'), [], gates)!.handoff.gates).toContain(
    'packages/feature-a:typecheck:e2e'
  )
})

test('OD-74: a symbol a dependency package defines resolves; an undefined one and no keyword is reported', () => {
  const dir = join(import.meta.dir, '..', 'cases', 'fixtures')
  const repo = join(dir, 'v2-repo-deps')
  const unresolved = (file: string) =>
    findings(dir, file, repo).filter((m) => m.startsWith('PSEUDOCODE_SYMBOL_UNRESOLVED'))
  expect(unresolved('v2-symbol-dep.md')).toEqual([])
  expect(unresolved('v2-symbol-dep-missing.md')).toEqual([
    'PSEUDOCODE_SYMBOL_UNRESOLVED S1: loadGreeting'
  ])
})
