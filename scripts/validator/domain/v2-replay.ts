import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { escape } from './v2-meta.ts'
import { dirname, extname, join, relative } from 'node:path'

/** Milliseconds one oracle run may take before it counts as an error. */
const TIMEOUT_MS = 120_000

/**
 * What decides an acceptance: a repository test file that names the case, or a bounded command —
 * one package script whose observable result is a path it must produce (`exists`) or text its
 * output must contain (`stdout`).
 */
export type Oracle = string | Readonly<{ script: string; exists?: string; stdout?: string }>

/** Outcome of replaying one oracle: base must fail, head must pass, head without the change must fail. */
export type Replay = Readonly<{
  acceptance: string
  runner: readonly string[] | null
  base: 'FAIL' | 'PASS' | 'ERROR'
  head: 'FAIL' | 'PASS' | 'ERROR'
  ablation: 'FAIL' | 'PASS' | 'ERROR'
  /** `environment-failed`: the oracle does not pass at the change in the exported tree at all. */
  verdict: 'proven' | 'not-proven' | 'environment-failed'
  /** `requirement`: only this case's step commits were undone; `file`: files only its steps own. */
  granularity?: 'requirement' | 'file'
  reason?: string
}>

const git = (repository: string, args: readonly string[]) =>
  Bun.spawnSync(['git', '-C', repository, ...args], { stdout: 'pipe', stderr: 'pipe' })

/** Write `commit`'s tree (or one path of it) into `target`, read-only for the repository. */
export function exportTree(
  repository: string,
  commit: string,
  target: string,
  path?: string
): boolean {
  const archive = git(repository, [
    'archive',
    '--format=tar',
    commit,
    ...(path ? ['--', path] : [])
  ])
  if (archive.exitCode !== 0) return false
  mkdirSync(target, { recursive: true })
  return Bun.spawnSync(['tar', '-x', '-C', target], { stdin: archive.stdout }).exitCode === 0
}

/** The package manager command for one script, chosen by the lockfile in `tree`. */
export function scriptRunner(tree: string, script: string): string[] {
  const has = (file: string) => existsSync(join(tree, file))
  const manager =
    has('bun.lock') || has('bun.lockb')
      ? 'bun'
      : has('pnpm-lock.yaml')
        ? 'pnpm'
        : has('yarn.lock')
          ? 'yarn'
          : 'npm'
  return [manager, 'run', script]
}

/**
 * The command that runs one test file, derived from the file type and the repository's tooling —
 * never taken from the host's report. A repository preset may supply its own per extension.
 */
export function runnerFor(
  tree: string,
  oracle: string,
  presets: Readonly<Record<string, readonly string[]>> = {},
  cwd = tree
): string[] | null {
  const ext = extname(oracle)
  const preset = presets[ext]
  if (preset) return preset.map((part) => part.replaceAll('{oracle}', oracle))
  if (ext === '.py') return ['python3', '-m', 'pytest', '-q', oracle]
  if (ext === '.go') return ['go', 'test', `./${dirname(oracle)}`]
  if (!/^\.[cm]?[jt]sx?$/.test(ext)) return null
  if (['bun.lock', 'bun.lockb', 'bunfig.toml'].some((file) => existsSync(join(tree, file))))
    return ['bun', 'test', `./${oracle}`]
  // The oracle's own package declares its test runner; the repository root may declare it instead.
  const deps = [join(cwd, 'package.json'), join(tree, 'package.json')]
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => readFileSync(manifest, 'utf8'))
    .join('\n')
  if (deps.includes('"vitest"')) return ['npx', 'vitest', 'run', oracle]
  if (deps.includes('"jest"')) return ['npx', 'jest', oracle]
  return null
}

/** Run the oracle in `tree`: exit status decides a test file; a command also needs its observable. */
function run(tree: string, runner: readonly string[], oracle: Oracle): 'PASS' | 'FAIL' | 'ERROR' {
  try {
    const result = Bun.spawnSync([...runner], {
      cwd: tree,
      env: { ...process.env, CI: '1' },
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: TIMEOUT_MS
    })
    if (result.signalCode) return 'ERROR'
    if (result.exitCode !== 0) return 'FAIL'
    if (typeof oracle === 'string') return 'PASS'
    const observed = oracle.exists
      ? existsSync(join(tree, oracle.exists))
      : result.stdout.toString().includes(oracle.stdout ?? '')
    return observed ? 'PASS' : 'FAIL'
  } catch {
    return 'ERROR'
  }
}

/**
 * A step ID in a commit message: bare (`S3`), or qualified with this leaf's ID (`planner/S3`).
 * An ID qualified with another leaf's ID (`pipeline/S3`) is that leaf's step, not this one's.
 */
const idPattern = (ids: readonly string[], leaf?: string) =>
  new RegExp(
    `(?:(?<![\\w/-])|(?<=(?:^|[^\\w-])${leaf ? escape(leaf) : '\\0'}/))(?:${ids.map(escape).join('|')})\\b`
  )

/** Package directories (holding a package.json) in an exported tree, relative to it. */
function packages(tree: string, dir = ''): string[] {
  const found: string[] = existsSync(join(tree, dir, 'package.json')) ? [dir] : []
  for (const entry of readdirSync(join(tree, dir), { withFileTypes: true }))
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      found.push(...packages(tree, join(dir, entry.name)))
  return found
}

/** Recreate the dependency layout in exported trees: the root's and every package's node_modules. */
export function linkInstalled(repository: string, trees: readonly string[]): void {
  // Every tree's packages, so a package that exists only in one tree (added by the change) is linked.
  for (const dir of new Set(trees.flatMap((tree) => packages(tree)).concat('')))
    if (existsSync(join(repository, dir, 'node_modules')))
      for (const tree of trees)
        if (existsSync(join(tree, dir)) && !existsSync(join(tree, dir, 'node_modules')))
          symlinkSync(join(repository, dir, 'node_modules'), join(tree, dir, 'node_modules'))
}

/**
 * Replay one acceptance's declared oracle in exported trees: at `base` it must fail, at `head` it
 * must pass, and at `head` with this case's implementation removed it must fail again (ablation).
 *
 * The ablation has to remove this requirement and nothing else, or a wrong oracle that tests
 * another requirement would fail for the wrong reason and read as proven:
 * - requirement level: revert the commits whose message names this case's steps; a commit that
 *   also names another case's step cannot be attributed and makes the replay not-proven;
 * - file level, only when no commit names the steps: revert the implementing files, and only if
 *   every other step declares its touches and none of them shares a reverted file.
 * The oracle file's own changes are kept. Nothing is written to the repository.
 */
export function replay(input: {
  repository: string
  acceptance: string
  oracle: Oracle
  base: string
  head: string
  implementing: readonly string[]
  steps: readonly string[]
  others: readonly { id: string; touches: readonly string[] }[]
  runners?: Readonly<Record<string, readonly string[]>>
  /** The leaf's write surfaces: a step's commit must change one of them to count as the step's. */
  writes?: readonly string[]
  /** The leaf's ID, for step IDs qualified as `<leaf>/S3` in commit messages. */
  leaf?: string
}): Replay {
  const { repository, acceptance, oracle, base, head } = input
  const oracleFile = typeof oracle === 'string' ? oracle : null
  const root = mkdtempSync(join(tmpdir(), 'sdd-replay-'))
  const unrun = (reason: string, granularity?: Replay['granularity']): Replay => ({
    acceptance,
    runner: null,
    base: 'ERROR',
    head: 'ERROR',
    ablation: 'ERROR',
    verdict: 'not-proven',
    ...(granularity ? { granularity } : {}),
    reason
  })
  try {
    const trees = {
      base: join(root, 'base'),
      head: join(root, 'head'),
      ablation: join(root, 'ablation')
    }
    for (const [name, commit] of [
      ['base', base],
      ['head', head],
      ['ablation', head]
    ] as const)
      if (!exportTree(repository, commit, trees[name])) return unrun(`cannot export ${commit}`)
    const log = git(repository, ['log', '--format=%H%x00%B%x01', `${base}..${head}`])
    const commits = log.stdout
      .toString()
      .split('\x01')
      .map((entry) => entry.trim().split('\x00'))
      .filter(([hash]) => hash)
      .map(([hash, message]) => ({ hash: hash!, message: message ?? '' }))
    const mine = input.steps.length ? idPattern(input.steps, input.leaf) : null
    const theirs = input.others.length
      ? idPattern(
          input.others.map((other) => other.id),
          input.leaf
        )
      : null
    // A commit is this leaf's only if it also changes the leaf's writes: sibling SDDs number their
    // steps S1, S2, … too, and their commits share the range.
    const inLeaf = (hash: string) => {
      if (!input.writes?.length) return true
      const changed = git(repository, ['diff-tree', '--no-commit-id', '--name-only', '-r', hash])
      return changed.stdout
        .toString()
        .split('\n')
        .some((path) => input.writes!.some((w) => path === w || path.startsWith(`${w}/`)))
    }
    const owned = mine ? commits.filter((c) => mine.test(c.message) && inLeaf(c.hash)) : []
    const mixed = owned.find((c) => theirs?.test(c.message))
    if (mixed)
      return unrun(`commit ${mixed.hash.slice(0, 7)} also names another case's step`, 'requirement')
    let granularity: 'requirement' | 'file'
    if (owned.length) {
      granularity = 'requirement'
      for (const { hash } of owned) {
        const exclude = oracleFile ? [`:(exclude)${oracleFile}`] : []
        const patch = git(repository, ['diff', `${hash}^`, hash, '--', '.', ...exclude])
        const applied = Bun.spawnSync(['git', 'apply', '-R', '--whitespace=nowarn'], {
          cwd: trees.ablation,
          stdin: patch.stdout
        })
        if (applied.exitCode !== 0)
          return unrun(`commit ${hash.slice(0, 7)} cannot be reverted on its own`, 'requirement')
      }
    } else {
      granularity = 'file'
      const reverted = input.implementing.filter((path) => path !== oracleFile)
      if (!reverted.length)
        return unrun('no implementing file to revert besides the oracle', 'file')
      const overlaps = (a: string, b: string) =>
        a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
      const unknown = input.others.filter((other) => !other.touches.length).map((o) => o.id)
      const shared = input.others
        .filter((other) => other.touches.some((t) => reverted.some((path) => overlaps(t, path))))
        .map((o) => o.id)
      if (unknown.length || shared.length)
        return unrun(
          `no commit names ${input.steps.join(', ')}, and ${
            shared.length ? `${shared.join(', ')} share` : `${unknown.join(', ')} may share`
          } its files; commit each step separately with its ID`,
          'file'
        )
      for (const path of reverted) {
        rmSync(join(trees.ablation, path), { recursive: true, force: true })
        if (git(repository, ['cat-file', '-e', `${base}:${path}`]).exitCode === 0)
          exportTree(repository, base, trees.ablation, path)
      }
    }
    linkInstalled(repository, Object.values(trees))
    // A test runs from its own package, as the host ran it, so package config applies.
    const home = oracleFile
      ? (packages(trees.head)
          .filter((dir) => dir && oracleFile.startsWith(`${dir}/`))
          .sort((a, b) => b.length - a.length)[0] ?? '')
      : ''
    const target = oracleFile ? relative(join(trees.head, home), join(trees.head, oracleFile)) : ''
    const runner =
      typeof oracle === 'string'
        ? runnerFor(trees.head, target, input.runners, join(trees.head, home))
        : scriptRunner(trees.head, oracle.script)
    if (!runner) return unrun(`no supported runner for ${String(oracleFile)}`, granularity)
    const results = {
      base: run(join(trees.base, home), runner, oracle),
      head: run(join(trees.head, home), runner, oracle),
      ablation: run(join(trees.ablation, home), runner, oracle)
    }
    const proven = results.base === 'FAIL' && results.head === 'PASS' && results.ablation === 'FAIL'
    const got = `${results.base}, ${results.head}, ${results.ablation}`
    // The host reported PASS at the change; if the exported tree cannot pass it, the replay
    // environment differs (dependencies, config, generated files) and says nothing about the oracle.
    if (results.head !== 'PASS')
      return {
        acceptance,
        runner,
        ...results,
        verdict: 'environment-failed',
        granularity,
        reason: `the oracle does not pass at the change in the exported tree (${got}); check dependencies, config and generated files`
      }
    return {
      acceptance,
      runner,
      ...results,
      verdict: proven ? 'proven' : 'not-proven',
      granularity,
      ...(proven ? {} : { reason: `expected base FAIL, head PASS, ablation FAIL; got ${got}` })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
