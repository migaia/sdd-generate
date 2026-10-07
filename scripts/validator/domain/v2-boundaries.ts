import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { contractBlock } from '../../lib/contract-source.ts'
import { read, walk } from '../../facts/repository.ts'
import { list, pathForm, text, type Item } from './v2-meta.ts'
import { stepText } from './v2-symbols.ts'

type Candidate = { code: string; detail: string }
/** A repository-relative path in prose: two or more segments, not inside a URL or absolute path. */
const PATH = /(?<![\w.@/:-])([\w@.-]+(?:\/[\w@.-]+)+)/g
/** A header that marks a document finished or retired; such a document owns nothing any more. */
const TERMINAL =
  /(?:文档状态|交付状态|Status)\s*[:：][^\n]*(?:SHIP|已交付|verified|complete|retired|superseded|deprecated)/i

/** Paths Git reports as ignored; a workspace without a usable `.git` borrows an empty one. */
export function ignored(repository: string, paths: readonly string[]): Set<string> {
  if (!paths.length) return new Set()
  const check = (args: string[]) =>
    spawnSync('git', [...args, 'check-ignore', '--no-index', '--stdin'], {
      cwd: repository,
      input: paths.join('\n'),
      encoding: 'utf8'
    })
  let result = check([])
  if (result.status === 128) {
    const gitDir = mkdtempSync(join(tmpdir(), 'sdd-ignore-'))
    try {
      spawnSync('git', ['init', '-q', '--bare', gitDir])
      result = check([`--git-dir=${gitDir}`, `--work-tree=${repository}`])
    } finally {
      rmSync(gitDir, { recursive: true, force: true })
    }
  }
  return new Set(result.status === 0 ? result.stdout.split('\n').filter(Boolean) : [])
}

/** OD-09: Bundle reads, Asset outputs and acceptance inputs that a clean checkout will not contain. */
export function ignoredInputCandidates(
  index: Item,
  body: string,
  repository: string | null,
  reads: readonly string[]
): Candidate[] {
  if (!repository) return []
  const found = new Map<string, string>()
  for (const path of reads) if (text(path) && pathForm(path)) found.set(path, 'reads')
  for (const meta of list(index.metas) as Item[])
    if (meta?.kind === 'Asset' && text(meta.path)) found.set(meta.path, String(meta.id))
  for (const id of list(index.acceptance).filter(text)) {
    for (const [, path] of (stepText(body, id).split('\n')[0] ?? '').matchAll(PATH))
      if (pathForm(path!)) found.set(path!, id)
  }
  const hits = ignored(repository, [...found.keys()])
  return [...found]
    .filter(([path]) => hits.has(path))
    .map(([path, where]) => ({ code: 'SDD_V2_PATH_GIT_IGNORED', detail: `${where}: ${path}` }))
}

/** OD-10: writes that enter a surface an active, unreferenced SDD in the same repository owns. */
export function ownershipCandidates(
  index: Item,
  source: string,
  body: string,
  repository: string | null
): Candidate[] {
  const writes = list(index.writes).filter((w): w is string => text(w) && pathForm(w))
  if (!repository || !writes.length) return []
  const files = walk(repository)
  const here = dirname(resolve(source))
  const skip = new Set(
    [...body.matchAll(/\]\(([^)#\s]+\.sdd\.md)/g)].map((m) => resolve(here, m[1]!))
  )
  skip.add(resolve(source))
  if (text(index.root)) skip.add(resolve(here, index.root))
  let names: Map<string, string> | undefined
  const dirOf = (name: string) => {
    if (name.includes('/') || existsSync(join(repository, name))) return name
    names ??= new Map(
      files
        .filter((f) => f.endsWith('package.json'))
        .map((f) => {
          const manifest = /"name"\s*:\s*"([^"]+)"/.exec(read(join(repository, f)))
          return [manifest?.[1] ?? '', dirname(f)] as [string, string]
        })
    )
    return names.get(name)
  }
  const mine = new Set(list(index.shared_writes).filter(text))
  const candidates: Candidate[] = []
  for (const file of files.filter((f) => f.endsWith('.sdd.md'))) {
    const path = join(repository, file)
    const doc = skip.has(path) ? '' : read(path)
    const other =
      doc && !TERMINAL.test(doc.split('\n').slice(0, 40).join('\n'))
        ? contractBlock(doc).value
        : null
    if (
      !other ||
      (text(other.root) &&
        text(index.root) &&
        resolve(dirname(path), other.root) === resolve(here, index.root))
    )
      continue
    const owned = [
      ...list(other.writes),
      ...list(other.ownership?.packages),
      ...list(other.delivery_plan?.batches).flatMap((batch) =>
        list((batch as Item)?.modification_packages)
      )
    ]
      .filter(text)
      .map(dirOf)
      .filter((dir): dir is string => !!dir && dir !== '.')
    const shared = new Set(list(other.shared_writes).filter(text).map(dirOf))
    for (const write of writes) {
      // OD-94: both documents declare the path keyed per writer, so the overlap is not ownership.
      if (shared.has(write) && mine.has(write)) continue
      const hit = owned.find(
        (dir) => write === dir || write.startsWith(`${dir}/`) || dir.startsWith(`${write}/`)
      )
      if (hit)
        candidates.push({
          code: 'SDD_V2_WRITES_OWNED_ELSEWHERE',
          detail: `${write} ∩ ${hit} (${file})`
        })
    }
  }
  return candidates
}
