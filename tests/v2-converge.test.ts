import { expect, test } from 'bun:test'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { applyOverlay, contractOf, withContract, type Json } from '../scripts/lib/example-overlay'
import { drainObservations, observations } from '../scripts/rsi'
import { checkClosure } from '../scripts/validator/domain/v2-closure'
import { replay, type Oracle } from '../scripts/validator/domain/v2-replay'
import { validateV2Document } from '../scripts/validator/domain/v2-document'

const FIXTURES = join(import.meta.dir, '..', 'cases', 'fixtures')
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

/** Copy a fixture workspace and give it the `.git` marker repository detection reads. */
function workspace(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'v2-converge-'))
  cpSync(join(FIXTURES, name), root, { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

const codes = (result: { handoff: { candidates: readonly { code: string }[] } }) =>
  result.handoff.candidates.map((item) => item.code)

test('an acceptance naming what only a later batch produces is a forward dependency', () => {
  const late = validateV2Document('/x/a.md', fixture('v2-forward-dependency.md'))!
  expect(late.handoff.candidates.filter((c) => c.code.includes('FORWARD'))).toEqual([
    {
      code: 'SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY',
      detail: 'A1 needs defineHost from S2, after its closing steps'
    }
  ])
  const ok = validateV2Document('/x/a.md', fixture('v2-forward-dependency.ok.md'))!
  expect(codes(ok)).not.toContain('SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY')
})

test('error-text and shape readers outside the writes must be named by the SDD', () => {
  const root = workspace('v2-readers')
  try {
    const bare = validateV2Document(
      join(root, 'a.sdd.md'),
      fixture('v2-readers-undeclared.md'),
      [],
      root
    )!
    expect(bare.handoff.candidates.filter((c) => c.code.includes('READER'))).toEqual([
      {
        code: 'SDD_V2_ERROR_TEXT_READER_UNDECLARED',
        detail: 'packages/logger/logger.test.ts asserts "install result must not be thenable"'
      },
      {
        code: 'SDD_V2_SHAPE_READER_UNDECLARED',
        detail: 'packages/tray/tray.test.ts uses Host.prototype'
      }
    ])
    const named = validateV2Document(
      join(root, 'a.sdd.md'),
      fixture('v2-readers-declared.md'),
      [],
      root
    )!
    expect(codes(named).filter((code) => code.includes('READER'))).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-30: sample errors in touched tests are not error text the leaf owns', () => {
  const root = workspace('v2-readers-test-source')
  try {
    const readers = (name: string) =>
      validateV2Document(
        join(root, 'a.sdd.md'),
        fixture(name),
        [],
        root
      )!.handoff.candidates.filter((c) => c.code === 'SDD_V2_ERROR_TEXT_READER_UNDECLARED')
    // host.test.ts throws 'downstream failed' as a fixture; store.test.ts repeating it is no reader.
    expect(readers('v2-readers-test-source-undeclared.md')).toEqual([
      {
        code: 'SDD_V2_ERROR_TEXT_READER_UNDECLARED',
        detail: 'packages/logger/logger.test.ts asserts "install result must not be thenable"'
      }
    ])
    expect(readers('v2-readers-test-source-declared.md')).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('closure links a PASS to its declared oracle and the design to the delivered code', () => {
  const root = workspace('v2-converge')
  try {
    const evidence = JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8'))
    const leaf = fixture('v2-leaf.md')
    const run = (overlay: Json) => {
      const text = withContract(leaf, applyOverlay(contractOf(leaf), overlay))
      const result = validateV2Document(join(root, 'leaf.sdd.md'), text, [], root)!
      return checkClosure(result, contractOf(text) as Record<string, unknown>, evidence, root)
    }
    const bare = run({})
    expect(bare.status).toBe('OPEN')
    expect(bare.findings[0]!.message).toBe('oracle-required: A1: declare its test in oracles')
    const unlinked = run({ oracles: { A1: 'packages/feature-a/feature.test.ts' } })
    expect(unlinked.status).toBe('OPEN')
    expect(unlinked.findings[0]!.message).toBe(
      'oracle-unlinked: A1: command does not run packages/feature-a/feature.test.ts'
    )
    expect(run({ oracles: { A1: 'packages/feature-a/other.test.ts' } }).status).toBe('CLOSED')
    const gap = run({
      oracles: { A1: 'packages/feature-a/other.test.ts' },
      metas: { merge_by_id: [{ id: 'T1', path: 'packages/feature-a/missing.ts' }] }
    })
    expect(gap.gaps).toEqual(['asset T1 missing at packages/feature-a/missing.ts'])
    expect(gap.status).toBe('OPEN')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-35: a preserved case closes on PASS then PASS; an unmarked one must be classified', () => {
  const root = workspace('v2-closure-preserve')
  try {
    const evidence = JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8'))
    const leaf = fixture('v2-leaf.md')
    const run = (overlay: Json, report: unknown = evidence) => {
      const text = withContract(leaf, applyOverlay(contractOf(leaf), overlay))
      const result = validateV2Document(join(root, 'leaf.sdd.md'), text, [], root)!
      return checkClosure(result, contractOf(text) as Record<string, unknown>, report, root)
    }
    const oracles = { A1: 'packages/feature-a/other.test.ts' }
    const unmarked = run({ oracles })
    expect(unmarked.status).toBe('OPEN')
    expect(unmarked.findings[0]!.message).toBe(
      'baseline-class-mismatch: A1: its baseline passed; list it in preserve or show a failing baseline'
    )
    const kept = run({ oracles, preserve: ['A1'] })
    expect(kept.status).toBe('CLOSED')
    expect(kept.proof).toEqual([{ acceptance: 'A1', level: 'claimed' }])
    // A preserved case whose baseline failed was a change after all.
    const failed = structuredClone(evidence)
    failed.results[0].baseline.status = 'FAIL'
    expect(run({ oracles, preserve: ['A1'] }, failed).findings[0]!.message).toBe(
      'baseline-class-mismatch: A1: listed in preserve, but its baseline failed'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('observation queue: settled entries leave, commentary goes once the queue is empty', () => {
  const queue = [
    '# Observed',
    '',
    'Intake notes.',
    '',
    '## OD-01 One',
    'first',
    '',
    '## OD-02 Two',
    'second',
    '',
    '## Common thread',
    'about both',
    ''
  ].join('\n')
  expect(observations(queue).map((entry) => entry.id)).toEqual(['OD-01', 'OD-02'])
  const partial = drainObservations(queue, new Set(['OD-01']))
  expect(observations(partial).map((entry) => entry.id)).toEqual(['OD-02'])
  expect(partial).toContain('## Common thread')
  expect(drainObservations(queue, new Set(['OD-01', 'OD-02']))).toBe(
    '# Observed\n\nIntake notes.\n'
  )
})

test('replay runs the declared oracle: base fails, head passes, ablation fails', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'v2-replay-')))
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
      .stdout.toString()
      .trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  try {
    git('init', '-q')
    write('bun.lock', '')
    write('src/greet.ts', "export const greet = () => 'no'\n")
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    write('src/greet.ts', "export const greet = () => 'ok'\n")
    write(
      'src/greet.test.ts',
      "import { expect, test } from 'bun:test'\nimport { greet } from './greet'\ntest('A1 greets', () => expect(greet()).toBe('ok'))\n"
    )
    write(
      'src/weak.test.ts',
      "import { expect, test } from 'bun:test'\ntest('A1 weak', () => expect(1).toBe(1))\n"
    )
    git('add', '.')
    git('commit', '-q', '-m', 'fix')
    const head = git('rev-parse', 'HEAD')
    // The step's prose must name the code this repository really has, or it is a design gap.
    const leaf = fixture('v2-leaf.md').replaceAll('`featureA()`', '`greet()`')
    const check = (oracle: string) => {
      const text = withContract(
        leaf,
        applyOverlay(contractOf(leaf), {
          writes: ['src'],
          steps: [{ id: 'S1', touches: ['src/greet.ts'], closes: ['A1'] }],
          metas: { merge_by_id: [], remove: ['T1'] },
          oracles: { A1: oracle }
        })
      )
      const result = validateV2Document(join(root, 'leaf.sdd.md'), text, [], root)!
      const row = {
        acceptance: 'A1',
        status: 'PASS',
        evidence: 'ci 2',
        command: `bun test ${oracle}`,
        commit: head,
        baseline: { status: 'FAIL', evidence: 'ci 1', commit: base }
      }
      const report = {
        protocol: 'sdd-evidence/v1',
        sdd: 'feature-a',
        revision: '1',
        results: [row]
      }
      return checkClosure(result, contractOf(text) as Record<string, unknown>, report, root, {
        replay: true
      })
    }
    const strong = check('src/greet.test.ts')
    expect(strong.replays[0]).toMatchObject({
      base: 'FAIL',
      head: 'PASS',
      ablation: 'FAIL',
      verdict: 'proven'
    })
    expect(strong.findings).toEqual([])
    expect(strong.status).toBe('CLOSED')
    expect(strong.behaviour_proven).toBe(true)
    // An oracle that passes whatever the implementation does is exposed by the ablation run.
    const weak = check('src/weak.test.ts')
    expect(weak.replays[0]).toMatchObject({ head: 'PASS', ablation: 'PASS', verdict: 'not-proven' })
    expect(weak.status).toBe('OPEN')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('requirement-level ablation reverts only the commits naming the case steps', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'v2-ablation-')))
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
      .stdout.toString()
      .trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const pad = ['// -', '// -', '// -', '// -', '// -', '// -']
  try {
    git('init', '-q')
    write('bun.lock', '')
    write('src/greet.ts', ['// greet', ...pad, '// farewell', ''].join('\n'))
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    const greet = "export const greet = () => 'hi'"
    const bye = "export const farewell = () => 'bye'"
    write('src/greet.ts', ['// greet', greet, ...pad, '// farewell', ''].join('\n'))
    git('commit', '-q', '-am', 'S1: add greet')
    write('src/greet.ts', ['// greet', greet, ...pad, '// farewell', bye, ''].join('\n'))
    git('commit', '-q', '-am', 'S2: add farewell')
    const check = (id: string) =>
      `import { expect, test } from 'bun:test'\nimport { farewell } from './greet'\ntest('${id}', () => expect(farewell()).toBe('bye'))\n`
    // A1's oracle wrongly tests R2's behaviour; only requirement-level ablation can tell.
    write('src/a1.test.ts', check('A1'))
    write('src/a2.test.ts', check('A2'))
    git('add', '.')
    git('commit', '-q', '-m', 'tests')
    const head = git('rev-parse', 'HEAD')
    const body = [
      '- R1 Greets.',
      '- R2 Says goodbye.',
      '- C1 Both.',
      '- S1 Add `greet()`.',
      '- S2 Add `farewell()`.',
      '- A1 `greet()` returns hi.',
      '- A2 `farewell()` returns bye.'
    ].join('\n')
    const index = {
      protocol: 'sdd/v2',
      id: 'pair',
      revision: '1',
      requirements: [
        { id: 'R1', kind: 'must-ship', implementation: ['S1'], acceptance: ['A1'] },
        { id: 'R2', kind: 'must-ship', implementation: ['S2'], acceptance: ['A2'] }
      ],
      batches: [{ id: 'C1', steps: ['S1', 'S2'], requirements: ['R1', 'R2'], depends_on: [] }],
      steps: [
        { id: 'S1', touches: ['src/greet.ts'], closes: ['A1'] },
        { id: 'S2', touches: ['src/greet.ts'], closes: ['A2'] }
      ],
      acceptance: ['A1', 'A2'],
      writes: ['src'],
      oracles: { A1: 'src/a1.test.ts', A2: 'src/a2.test.ts' },
      unresolved_user_decisions: []
    }
    const text = `# Pair\n\n${body}\n\n<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify(index)}\n\`\`\`\n<!-- sdd-contract:end -->\n`
    const result = validateV2Document(join(root, 'pair.sdd.md'), text, [], root)!
    expect(result.diagnostics).toEqual([])
    const row = (id: string) => ({
      acceptance: id,
      status: 'PASS',
      evidence: 'ci',
      command: `bun test src/${id.toLowerCase()}.test.ts`,
      commit: head,
      baseline: { status: 'FAIL', evidence: 'ci', commit: base }
    })
    const report = {
      protocol: 'sdd-evidence/v1',
      sdd: 'pair',
      revision: '1',
      results: [row('A1'), row('A2')]
    }
    const closure = checkClosure(result, index, report, root, { replay: true })
    const byId = Object.fromEntries(closure.replays.map((r) => [r.acceptance, r]))
    expect(byId.A1).toMatchObject({
      granularity: 'requirement',
      ablation: 'PASS',
      verdict: 'not-proven'
    })
    expect(byId.A2).toMatchObject({
      granularity: 'requirement',
      ablation: 'FAIL',
      verdict: 'proven'
    })
    expect(closure.status).toBe('OPEN')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay refuses an ablation it cannot attribute to one requirement', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'v2-attribution-')))
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
      .stdout.toString()
      .trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  try {
    git('init', '-q')
    write('bun.lock', '')
    write('src/api.ts', 'export {}\n')
    write('package.json', JSON.stringify({ name: 'api', scripts: {} }))
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    write('src/api.ts', "export const greet = () => 'hi'\nexport const farewell = () => 'bye'\n")
    // The finding's case: A1 should check R1 but tests farewell(), and no commit names a step.
    write(
      'src/a1.test.ts',
      "import { expect, test } from 'bun:test'\nimport { farewell } from './api'\ntest('A1', () => expect(farewell()).toBe('bye'))\n"
    )
    write(
      'package.json',
      JSON.stringify({ name: 'api', scripts: { build: 'mkdir -p dist && echo ok > dist/out.txt' } })
    )
    git('add', '.')
    git('commit', '-q', '-m', 'implement both')
    const head = git('rev-parse', 'HEAD')
    const run = (oracle: Oracle, others: { id: string; touches: string[] }[]) =>
      replay({
        repository: root,
        acceptance: 'A1',
        oracle,
        base,
        head,
        implementing: ['src/api.ts', 'package.json'],
        steps: ['S1'],
        others
      })
    // File-level fallback would remove R2's code too and call the wrong oracle proven.
    expect(run('src/a1.test.ts', [{ id: 'S2', touches: ['src/api.ts'] }])).toMatchObject({
      granularity: 'file',
      verdict: 'not-proven'
    })
    expect(run('src/a1.test.ts', [{ id: 'S2', touches: [] }]).verdict).toBe('not-proven')
    // A bounded command oracle replays when the file ablation is unambiguous.
    const command = run({ script: 'build', exists: 'dist/out.txt' }, [])
    expect(command).toMatchObject({
      base: 'FAIL',
      head: 'PASS',
      ablation: 'FAIL',
      verdict: 'proven'
    })
    // A commit naming both cases' steps cannot be split between them.
    write('src/api.ts', "export const greet = () => 'hello'\nexport const farewell = () => 'bye'\n")
    git('commit', '-q', '-am', 'S1 S2: both at once')
    const mixed = replay({
      repository: root,
      acceptance: 'A1',
      oracle: 'src/a1.test.ts',
      base,
      head: git('rev-parse', 'HEAD'),
      implementing: ['src/api.ts'],
      steps: ['S1'],
      others: [{ id: 'S2', touches: ['src/api.ts'] }]
    })
    expect(mixed).toMatchObject({ granularity: 'requirement', verdict: 'not-proven' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay separates a broken environment from a weak oracle and honours leaf-qualified step IDs', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'v2-od36-')))
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
      .stdout.toString()
      .trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  try {
    git('init', '-q')
    write('bun.lock', '')
    write('src/run.ts', "export const run = () => 'no'\n")
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    write('src/run.ts', "export const run = () => 'ok'\n")
    git('commit', '-q', '-am', 'planner/S1: run returns ok')
    write('src/other.ts', 'export const other = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'pipeline/S1: unrelated leaf')
    write(
      'src/run.test.ts',
      "import { expect, test } from 'bun:test'\nimport { run } from './run'\ntest('A1', () => expect(run()).toBe('ok'))\n"
    )
    // An oracle that cannot load anywhere: its import is missing at every revision.
    write('src/broken.test.ts', "import { gone } from './gone'\ntest('A1', () => gone())\n")
    git('add', '.')
    git('commit', '-q', '-m', 'tests')
    const head = git('rev-parse', 'HEAD')
    const replayOf = (oracle: string) =>
      replay({
        repository: root,
        acceptance: 'A1',
        oracle,
        base,
        head,
        implementing: ['src/run.ts'],
        steps: ['S1'],
        others: [{ id: 'S2', touches: ['src/other.ts'] }],
        writes: ['src'],
        leaf: 'planner'
      })
    // `pipeline/S1` belongs to another leaf, so only `planner/S1` is reverted.
    expect(replayOf('src/run.test.ts')).toMatchObject({
      granularity: 'requirement',
      verdict: 'proven'
    })
    expect(replayOf('src/broken.test.ts')).toMatchObject({
      head: 'FAIL',
      verdict: 'environment-failed'
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
