import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ignored,
  ignoredInputCandidates,
  ownershipCandidates
} from '../scripts/validator/domain/v2-boundaries'
import { validateDocument } from '../scripts/validator/controllers/document.controller'
import { deriveLeafMetas } from '../scripts/validator/domain/v2-meta'

/** A throwaway workspace whose `.git` is an empty directory, like the materialised case fixtures. */
const workspace = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'v2-boundaries-'))
  mkdirSync(join(root, '.git'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

test('OD-09: ignore rules apply without a usable .git, and only acceptance lines are read', () => {
  const root = workspace({ '.gitignore': 'local/\n' })
  try {
    // A path need not exist to be ignored: an acceptance may name a file it expects to create.
    expect([...ignored(root, ['local/a.json', 'packages/a/index.ts'])]).toEqual(['local/a.json'])
    const index = { acceptance: ['A1'], metas: [] }
    const body = '- S1 writes local/notes.md\n- A1 compares with `local/base.json`.\n'
    expect(ignoredInputCandidates(index, body, root, [])).toEqual([
      { code: 'SDD_V2_PATH_GIT_IGNORED', detail: 'A1: local/base.json' }
    ])
    expect(ignoredInputCandidates(index, body, null, [])).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-10: an active unreferenced owner is reported; shipped and linked owners are not', () => {
  const contract = (json: object) =>
    `<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n<!-- sdd-contract:end -->\n`
  const root = workspace({
    'packages/b/package.json': '{ "name": "b-pkg" }',
    'plans/active.sdd.md': `状态：pending\n${contract({ delivery_plan: { batches: [{ modification_packages: ['b-pkg'] }] } })}`,
    'plans/shipped.sdd.md': `- 文档状态：**SHIP**\n${contract({ writes: ['packages/b'] })}`,
    'plans/linked.sdd.md': `状态：pending\n${contract({ writes: ['packages/b/src'] })}`
  })
  try {
    const leaf = join(root, 'plans', 'leaf.sdd.md')
    const found = ownershipCandidates(
      { writes: ['packages/b'] },
      leaf,
      'See [linked](./linked.sdd.md).',
      root
    )
    expect(found).toEqual([
      {
        code: 'SDD_V2_WRITES_OWNED_ELSEWHERE',
        detail: 'packages/b ∩ packages/b (plans/active.sdd.md)'
      }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-29: program children may sit beside the root inside the repository, not outside it', () => {
  const contract = (json: object) =>
    `<!-- sdd-contract:start -->\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n<!-- sdd-contract:end -->\n`
  const program = (child: string) =>
    `# P\n\n## Shared Constraints\n\nNone\n\n<!-- sdd-program:start -->\n\`\`\`json\n${JSON.stringify(
      {
        protocol: 'sdd-program/v2',
        id: 'p',
        revision: '1',
        children: [{ id: 'b', sdd: child, depends_on: [] }],
        metas: [],
        unresolved_user_decisions: []
      }
    )}\n\`\`\`\n<!-- sdd-program:end -->\n`
  const root = workspace({
    'docs/a/root.sdd.md': program('../b/child.sdd.md'),
    'docs/a/escape.sdd.md': program('../../../outside/child.sdd.md'),
    'docs/b/child.sdd.md': `# B\n\n${contract({ protocol: 'sdd/v2', id: 'b', revision: '1', root: '../a/root.sdd.md' })}`
  })
  try {
    const codes = (sdd: string) =>
      validateDocument(join(root, sdd)).diagnostics.map((d) => d.message)
    expect(codes('docs/a/root.sdd.md').filter((m) => m.startsWith('child-path-escape'))).toEqual([])
    expect(codes('docs/a/escape.sdd.md').some((m) => m.startsWith('child-path-escape'))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OD-32: a program root may leave child Modules, Chunks and Bundles to derivation', () => {
  const fixture = (name: string) =>
    validateDocument(join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-program-derived', name))
  const root = fixture('root.sdd.md')
  expect(root.diagnostics).toEqual([])
  // An Entry naming a requirement the child does not have still fails.
  expect(fixture('stale-root.sdd.md').diagnostics.map((d) => d.message)).toContain(
    'entry-module-missing: E1 -> M:beta:R9'
  )
  // Declared Chunks win for their kind, and the derived Bundle groups those, not derived IDs.
  const child = { requirements: [{ id: 'R1' }], batches: [{ id: 'C1', requirements: ['R1'] }] }
  const declared = {
    metas: [{ id: 'K-b', kind: 'Chunk', owner: 'b', source_id: 'C1', members: ['M:b:R1'] }]
  }
  const metas = deriveLeafMetas(declared, [{ owner: 'b', document: 'b.md', index: child }]).index
    .metas as { kind: string; members?: string[] }[]
  expect(metas.find((meta) => meta.kind === 'Bundle')?.members).toEqual(['K-b'])
  expect(metas.some((meta) => meta.kind === 'Entry')).toBe(false)
})
