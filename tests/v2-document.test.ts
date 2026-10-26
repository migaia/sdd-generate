import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateAssessment } from '../scripts/validator/domain/v2-assessment'
import { checkClosure } from '../scripts/validator/domain/v2-closure'
import { validateV2Document } from '../scripts/validator/domain/v2-document'

/** A throwaway directory with the given files; `git` adds the marker repository detection reads. */
function workspace(files: Record<string, string>, git = true): string {
  const root = mkdtempSync(join(tmpdir(), 'v2-document-'))
  if (git) mkdirSync(join(root, '.git'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

/** An sdd/v2 leaf whose prose is `body` and whose index is `index`. */
const leaf = (body: string, index: Record<string, unknown>) =>
  `# Change\n\n${body}\n\n<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify(index)}\n\`\`\`\n<!-- sdd-contract:end -->\n`

const body = [
  '- E1 Story one.',
  '- E2 Story two.',
  '- R1 First requirement.',
  '- R2 Second requirement.',
  '- C1 Foundation batch.',
  '- C2 Story batch.',
  '- S1 Build the base.',
  '- S2 Build the story.',
  '- A1 Base works.',
  '- A2 Story works.'
].join('\n')

const index = {
  protocol: 'sdd/v2',
  id: 'change',
  revision: '1',
  requirements: [
    { id: 'R1', kind: 'must-ship', implementation: ['S1'], acceptance: ['A1'] },
    { id: 'R2', kind: 'must-ship', implementation: ['S2'], acceptance: ['A2'] }
  ],
  batches: [
    { id: 'C1', steps: ['S1'], requirements: ['R1'], depends_on: [] },
    { id: 'C2', steps: ['S2'], requirements: ['R2'], depends_on: ['C1'] }
  ],
  steps: ['S1', 'S2'],
  acceptance: ['A1', 'A2'],
  writes: ['packages/change'],
  unresolved_user_decisions: []
}

test('a one-document leaf without metas derives its Meta graph from the index', () => {
  const root = workspace({ 'change.sdd.md': leaf(body, index) })
  try {
    const path = join(root, 'change.sdd.md')
    const result = validateV2Document(path, leaf(body, index))!
    expect(result.diagnostics).toEqual([])
    expect(result.handoff.meta_source).toBe('derived')
    expect(result.handoff.execution_slice?.chunks.map((chunk) => chunk.id)).toEqual([
      'K:C1',
      'K:C2'
    ])
    expect(result.handoff.execution_slice?.waves).toEqual([['K:C1'], ['K:C2']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('declared Entry priorities order the entries, name the MVP and may use derived Modules', () => {
  const declared = {
    ...index,
    batches: index.batches.map((batch) => ({ ...batch, depends_on: [] })),
    metas: [
      { id: 'E2', kind: 'Entry', priority: 'P2', members: ['M:R1'] },
      { id: 'E1', kind: 'Entry', priority: 'P1', members: ['M:R2'] }
    ]
  }
  const root = workspace({})
  try {
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(body, declared))!
    expect(result.diagnostics).toEqual([])
    expect(result.handoff.meta_source).toBe('mixed')
    const slice = result.handoff.execution_slice!
    expect(slice.entries.map((entry) => entry.id)).toEqual(['E1', 'E2'])
    expect(slice.mvp).toEqual(['E1'])
    expect(slice.waves).toEqual([['K:C2', 'K:C1']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('repository location: detected optional, explicit verified, missing only limits the checks', () => {
  const plain = workspace({}, false)
  try {
    const text = leaf(body, index)
    const detached = validateV2Document(join(plain, 'change.sdd.md'), text)!
    expect(detached.handoff.maturity).toBe('STRUCTURALLY_READY')
    expect(detached.handoff.repository).toBeNull()
    expect(detached.handoff.evidence_limits.join('\n')).toContain(
      'Repository location is unverified'
    )
    const explicit = validateV2Document(join(plain, 'change.sdd.md'), text, [], plain)!
    expect(explicit.handoff.repository).not.toBeNull()
    expect(explicit.diagnostics).toEqual([])
    const wrong = validateV2Document(join(plain, 'change.sdd.md'), text, [], join(plain, 'nope'))!
    expect(wrong.diagnostics.map((item) => item.code)).toEqual(['REPOSITORY_NOT_FOUND'])
  } finally {
    rmSync(plain, { recursive: true, force: true })
  }
})

test('declared principles must exist and be checked in the body', () => {
  const root = workspace({ '.specify/memory/constitution.md': '# Constitution\n' })
  try {
    const withPrinciples = { ...index, principles: ['.specify/memory/constitution.md'] }
    const path = join(root, 'change.sdd.md')
    const unchecked = validateV2Document(path, leaf(body, withPrinciples))!
    expect(unchecked.diagnostics.map((item) => item.code)).toEqual(['SDD_V2_SECTION_MISSING'])
    const checked = validateV2Document(
      path,
      leaf(`${body}\n\n## Principle Check\n\nNo deviation.`, withPrinciples)
    )!
    expect(checked.diagnostics).toEqual([])
    expect(checked.handoff.principles).toEqual([
      join(realpathSync(root), '.specify/memory/constitution.md')
    ])
    expect(checked.handoff.read_order[0]).toBe(checked.handoff.principles[0])
    const missing = validateV2Document(path, leaf(body, { ...index, principles: ['AGENTS.md'] }))!
    expect(missing.diagnostics.map((item) => item.code)).toContain('SDD_V2_PATH_NOT_FOUND')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const tasked = {
  ...index,
  requirements: [
    { id: 'R1', kind: 'must-ship', implementation: ['S1', 'S2'], acceptance: ['A1'] },
    { id: 'R2', kind: 'must-ship', implementation: ['S3'], acceptance: ['A2'] }
  ],
  batches: [
    { id: 'C1', steps: ['S1', 'S2'], requirements: ['R1'], depends_on: [] },
    { id: 'C2', steps: ['S3'], requirements: ['R2'], depends_on: [] }
  ],
  steps: [
    { id: 'S1', touches: ['packages/change/a.ts'], closes: ['A1'] },
    { id: 'S2', touches: ['packages/change/b.ts'], after: ['S1'] },
    { id: 'S3', touches: ['packages/change/c.ts'], closes: ['A2'] }
  ],
  metas: [
    { id: 'E1', kind: 'Entry', priority: 'P1', members: ['M:R1'] },
    { id: 'E2', kind: 'Entry', priority: 'P2', members: ['M:R2'] }
  ]
}
const taskedBody = `${body}\n- S3 Build the other story.`
/** Every must-ship case names the test that decides it, as strict convergence requires. */
const oracled = {
  ...tasked,
  oracles: { A1: 'packages/change/a1.test.ts', A2: 'packages/change/a2.test.ts' }
}
/** The files the tasked steps promise and the two oracles, so no design gap remains. */
const delivered = {
  'packages/change/a.ts': '',
  'packages/change/b.ts': '',
  'packages/change/c.ts': '',
  'packages/change/a1.test.ts': "test('A1', () => {})\n",
  'packages/change/a2.test.ts': "test('A2', () => {})\n"
}

test('step records derive ordered tasks, file-disjoint parallelism and the MVP task set', () => {
  const root = workspace({ 'packages/change/a.ts': '' })
  try {
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(taskedBody, tasked))!
    expect(result.diagnostics).toEqual([])
    const slice = result.handoff.execution_slice!
    expect(slice.tasks.map((task) => task.id)).toEqual(['S1', 'S2', 'S3'])
    const byId = Object.fromEntries(slice.tasks.map((task) => [task.id, task]))
    expect(byId.S1!.parallel_with).toEqual(['S3'])
    expect(byId.S2!.parallel_with).toEqual(['S3'])
    expect(byId.S1!.touches[0]!.status).toBe('existing')
    expect(byId.S3!.touches[0]!.status).toBe('new')
    expect(slice.mvp_tasks).toEqual(['S1'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('step records are checked: writes, predecessors, acceptance and batch-backed order', () => {
  const root = workspace({})
  try {
    const bad = {
      ...tasked,
      steps: [
        { id: 'S1', touches: ['elsewhere/x.ts'], after: ['S2'] },
        { id: 'S2', after: ['S1'], closes: ['A9'] },
        { id: 'S3', after: ['S1'] }
      ]
    }
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(taskedBody, bad))!
    const found = result.diagnostics.map((item) => item.message.split(':')[0])
    expect(found).toContain('step-touch-outside-writes')
    expect(found).toContain('step-order')
    expect(found).toContain('step-closes-missing')
    expect(found).toContain('batch-dependency-missing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('closure compares host evidence with acceptance and revision', () => {
  const root = workspace(delivered)
  try {
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(taskedBody, oracled))!
    expect(result.diagnostics).toEqual([])
    const run = (results: unknown[], revision = '1') =>
      checkClosure(
        result,
        oracled,
        { protocol: 'sdd-evidence/v1', sdd: 'change', revision, results },
        root
      )
    const pass = {
      acceptance: 'A1',
      status: 'PASS',
      evidence: 'packages/change/a.ts',
      command: 'bun test packages/change/a1.test.ts'
    }
    const second = { acceptance: 'A2', status: 'PASS', evidence: 'ci run 42' }
    const closed = run([pass, { ...second, command: 'bun test packages/change/a2.test.ts' }])
    expect(closed.status).toBe('CLOSED')
    expect(closed.mvp_closed).toBe(true)
    expect(run([pass]).status).toBe('OPEN')
    // Strict convergence: a must-ship pass whose command runs no declared oracle stays open.
    expect(run([pass, second]).findings.map((f) => f.message)).toEqual([
      'oracle-unlinked: A2: command does not run packages/change/a2.test.ts'
    ])
    expect(run([pass], '2').status).toBe('OPEN')
    expect(run([pass, { acceptance: 'A2', status: 'FAIL', evidence: 'x' }]).status).toBe('FAILED')
    const missing = run([{ ...pass, evidence: 'packages/change/gone.ts' }])
    expect(missing.mvp_closed).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bug intent needs reproduction, root cause and regression acceptance', () => {
  const root = workspace({})
  try {
    const path = join(root, 'change.sdd.md')
    const bug = { ...index, intent: 'bug', regression: ['A1'] }
    const bare = validateV2Document(path, leaf(body, { ...bug, regression: [] }))!
    expect(bare.diagnostics.map((item) => item.message.split(':')[0]).sort()).toEqual([
      'regression-required',
      'reproduction-missing',
      'root-cause-missing'
    ])
    const full = `${body}\n\n## Reproduction\n\nRun it.\n\n## Root Cause\n\nA typo.`
    const ok = validateV2Document(path, leaf(full, bug))!
    expect(ok.diagnostics).toEqual([])
    expect(ok.handoff.intent).toBe('bug')
    expect(ok.handoff.regression).toEqual(['A1'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('assessment decisions gate the follow-up SDD', () => {
  const doc = (decision: Record<string, unknown>) =>
    leaf(
      '## Intake\n\nAsk.\n\n## Research\n\nRead.\n\n## Options\n\n- O1 One.\n\n## Decision\n\nO1.\n\n- E1 Story.',
      {
        protocol: 'sdd-assessment/v1',
        id: 'idea',
        revision: '1',
        options: [{ id: 'O1' }],
        decision,
        proposed_entries: [{ id: 'E1', priority: 'P1' }]
      }
    )
  expect(validateAssessment('a.md', doc({ outcome: 'go', option: 'O1' }))!.handoff.maturity).toBe(
    'READY_FOR_SDD'
  )
  expect(validateAssessment('a.md', doc({ outcome: 'no-go' }))!.handoff.maturity).toBe('CLOSED')
  expect(validateAssessment('a.md', doc({ outcome: 'go', option: 'O9' }))!.valid).toBe(false)
  const root = workspace({
    'idea.md': doc({ outcome: 'go', option: 'O1' }),
    'dropped.md': doc({ outcome: 'no-go' })
  })
  try {
    const path = join(root, 'change.sdd.md')
    const linked = validateV2Document(path, leaf(body, { ...index, assessment: 'idea.md' }))!
    expect(linked.diagnostics).toEqual([])
    expect(linked.handoff.assessment).toBe(join(realpathSync(root), 'idea.md'))
    const dropped = validateV2Document(path, leaf(body, { ...index, assessment: 'dropped.md' }))!
    expect(dropped.diagnostics.map((item) => item.code)).toEqual(['SDD_V2_PROGRAM_LINK_INVALID'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('step calls declared nowhere in owned source or the SDD are symbol candidates', () => {
  const root = workspace({ 'packages/change/a.ts': 'export function known() {}\n' })
  try {
    const steps = `${body.replace('- S1 Build the base.', '- S1 Build the base.\n\n  ```ts\n  known()\n  missingHelper()\n  ```')}`
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(steps, index))!
    expect(result.diagnostics).toEqual([])
    expect(result.handoff.candidates).toEqual([
      { code: 'PSEUDOCODE_SYMBOL_UNRESOLVED', detail: 'S1: missingHelper' }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('behaviour proof: a failing baseline of the same command, commits checked in git', () => {
  const root = workspace({}, false)
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, ...args])
      .stdout.toString()
      .trim()
  try {
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'noop')
    const unrelated = git('rev-parse', 'HEAD')
    mkdirSync(join(root, 'packages/change'), { recursive: true })
    for (const [path, content] of Object.entries(delivered))
      writeFileSync(join(root, path), content)
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fix')
    const head = git('rev-parse', 'HEAD')
    const bug = { ...oracled, intent: 'bug', regression: ['A1'] }
    const text = leaf(`${taskedBody}\n\n## Reproduction\n\nRun.\n\n## Root Cause\n\nTypo.`, bug)
    const result = validateV2Document(join(root, 'change.sdd.md'), text)!
    expect(result.diagnostics).toEqual([])
    const row = (extra: Record<string, unknown>) => [
      {
        acceptance: 'A1',
        status: 'PASS',
        evidence: 'ci 7',
        command: 'bun test packages/change/a1.test.ts',
        ...extra
      },
      {
        acceptance: 'A2',
        status: 'PASS',
        evidence: 'ci 8',
        command: 'bun test packages/change/a2.test.ts'
      }
    ]
    const run = (extra: Record<string, unknown>) =>
      checkClosure(
        result,
        bug,
        { protocol: 'sdd-evidence/v1', sdd: 'change', revision: '1', results: row(extra) },
        realpathSync(root)
      )
    const failed = { status: 'FAIL', evidence: 'ci 6' }
    expect(run({}).status).toBe('OPEN')
    const verified = run({ commit: head, baseline: { ...failed, commit: base } })
    expect(verified.status).toBe('CLOSED')
    expect(verified.proof[0]).toEqual({ acceptance: 'A1', level: 'verified' })
    expect(verified.behaviour_proven).toBe(false)
    const claimed = run({ baseline: failed })
    expect(claimed.proof[0]!.level).toBe('claimed')
    // A regression case closes only on a verified, causal proof; a claimed pair is not enough.
    expect(claimed.status).toBe('OPEN')
    // Causality: a flip between commits that never touch the implementing files proves nothing.
    expect(run({ commit: unrelated, baseline: { ...failed, commit: base } }).proof[0]!.level).toBe(
      'none'
    )
    expect(run({ commit: base, baseline: { ...failed, commit: head } }).status).toBe('OPEN')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('repeated evidence rows block closure in either order', () => {
  const root = workspace({})
  try {
    const result = validateV2Document(join(root, 'change.sdd.md'), leaf(taskedBody, tasked))!
    const rows = [
      { acceptance: 'A1', status: 'FAIL', evidence: 'ci 1' },
      { acceptance: 'A1', status: 'PASS', evidence: 'ci 2' },
      { acceptance: 'A2', status: 'PASS', evidence: 'ci 3' }
    ]
    for (const results of [rows, [rows[1], rows[0], rows[2]]]) {
      const closure = checkClosure(
        result,
        tasked,
        { protocol: 'sdd-evidence/v1', sdd: 'change', revision: '1', results },
        root
      )
      expect(closure.status).toBe('OPEN')
      expect(closure.acceptance.find((row) => row.id === 'A1')!.status).toBe('DUPLICATE')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-121: a shell command in oracles is not accepted as a path', () => {
  const index = (oracle: string) =>
    `# T\n\n- A1 Docs.\n\n<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify({ protocol: 'sdd/v2', id: 't', revision: '1', acceptance: ['A1'], oracles: { A1: oracle } })}\n\`\`\`\n<!-- sdd-contract:end -->\n`
  const invalid = (oracle: string) =>
    validateV2Document('/x/t.md', index(oracle))!.diagnostics.some((d) =>
      d.message.startsWith('oracle-invalid')
    )
  expect(invalid('rg -n -F guarantee USEGUIDE.md')).toBe(true)
  expect(invalid('packages/a/a1.test.ts')).toBe(false)
})
