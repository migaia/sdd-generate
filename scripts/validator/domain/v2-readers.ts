import { existsSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { read } from '../../facts/repository.ts'
import { list, object, pathForm, text, under, type Item } from './v2-meta.ts'
import { SOURCE, stepText, trackedSources } from './v2-symbols.ts'
import { stepOrder, stepRecords } from './v2-tasks.ts'

type Candidate = { code: string; detail: string }
/** A test file by the usual conventions: a test directory or a `.test`/`.spec` suffix. */
export const TEST = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/
/** An error thrown with a literal message of at least eight characters. */
const THROWN = /new\s+\w*Error\(\s*(['"`])((?:(?!\1).){8,}?)\1/g
/** Names a step declares in its prose or pseudocode. */
const DECLARED = /(?:function|class|const|let|var)\s+([A-Za-z_]\w*)/g

/**
 * OD-03: an acceptance that names a path or symbol produced only by a step that is neither one of
 * its closing steps nor ordered before them cannot pass when those steps finish. Producers are a
 * step's `touches` and the names its text declares; closers are the steps that `closes` the case,
 * or else the implementation steps of the requirements that own it.
 */
export function forwardDependencyCandidates(
  index: Item,
  body: string,
  external: ReadonlyMap<string, string>
): Candidate[] {
  const records = stepRecords(index).records
  const before = stepOrder(index)
  const producers = new Map<string, Set<string>>()
  const produce = (token: string, step: string) =>
    producers.set(token, (producers.get(token) ?? new Set()).add(step))
  for (const record of records) {
    for (const path of record.touches) produce(posix.normalize(path), record.id)
    for (const [, name] of stepText(external.get(record.id) ?? body, record.id).matchAll(DECLARED))
      produce(name!, record.id)
  }
  const found: Candidate[] = []
  for (const id of list(index.acceptance).filter(text)) {
    let closers = records.filter((record) => record.closes.includes(id)).map((record) => record.id)
    if (!closers.length)
      closers = list(index.requirements).flatMap((r) =>
        object(r) && list(r.acceptance).includes(id) ? list(r.implementation).filter(text) : []
      )
    if (!closers.length) continue
    const ready = new Set(closers.flatMap((step) => [step, ...(before.get(step) ?? [])]))
    const line = stepText(body, id).split('\n')[0] ?? ''
    for (const [, raw] of line.matchAll(/`([^`]+)`/g)) {
      const token = raw!.replace(/\(.*$/, '').trim()
      const steps = producers.get(token) ?? producers.get(posix.normalize(token))
      if (steps && ![...steps].some((step) => ready.has(step)))
        found.push({
          code: 'SDD_V2_ACCEPTANCE_FORWARD_DEPENDENCY',
          detail: `${id} needs ${token} from ${[...steps].join(', ')}, after its closing steps`
        })
    }
  }
  return found
}

/**
 * OD-04 and OD-07: readers that depend on a touched file without naming its symbols. A test that
 * asserts the text of an error the file throws, or code that reaches a class the file declares
 * through its shape (`Name.prototype`, `extends Name`, `instanceof Name`), breaks when the step
 * rewrites the message or replaces the class. A reader counts as declared when the SDD names its
 * path or a Bundle reads it; the scan covers repository source outside the leaf's writes.
 */
export function readerCandidates(
  index: Item,
  body: string,
  repository: string | null,
  reads: readonly string[]
): Candidate[] {
  if (!repository) return []
  const writes = list(index.writes).filter((w): w is string => text(w) && pathForm(w))
  const touched = stepRecords(index)
    .records.flatMap((record) => record.touches)
    .filter((path) => pathForm(path) && existsSync(join(repository, path)))
    .filter((path) => statSync(join(repository, path)).isFile())
  if (!touched.length) return []
  const messages = new Set<string>()
  const classes = new Set<string>()
  for (const path of touched) {
    const source = read(join(repository, path))
    // Sample errors in tests and docs are fixtures, not messages the leaf owns (OD-30).
    if (SOURCE.test(path) && !TEST.test(path))
      for (const [, , message] of source.matchAll(THROWN)) messages.add(message!)
    for (const [, name] of source.matchAll(/\bclass\s+([A-Z]\w*)/g)) classes.add(name!)
  }
  const declared = (path: string) => body.includes(path) || reads.some((root) => under(root, path))
  const found: Candidate[] = []
  for (const path of trackedSources(repository)) {
    if (writes.some((root) => under(root, path)) || declared(path)) continue
    const source = read(join(repository, path))
    if (TEST.test(path))
      for (const message of messages)
        if (source.includes(message))
          found.push({
            code: 'SDD_V2_ERROR_TEXT_READER_UNDECLARED',
            detail: `${path} asserts "${message}"`
          })
    for (const name of classes)
      for (const shape of [`${name}.prototype`, `extends ${name}`, `instanceof ${name}`])
        if (new RegExp(`\\b${shape.replace('.', '\\.')}\\b`).test(source))
          found.push({ code: 'SDD_V2_SHAPE_READER_UNDECLARED', detail: `${path} uses ${shape}` })
  }
  return found
}
