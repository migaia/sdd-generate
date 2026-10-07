import { posix } from 'node:path'
import {
  list,
  object,
  pathForm,
  pathStatus,
  rank,
  text,
  under,
  type Item,
  type Report
} from './v2-meta.ts'

/**
 * One implementation step as a task. A bare string ID is a step whose relations live only in the
 * prose; the record form adds what a host needs to schedule it: the repository paths it touches,
 * the steps it must follow, and the acceptance cases it closes.
 */
export type StepRecord = Readonly<{
  id: string
  touches: readonly string[]
  after: readonly string[]
  closes: readonly string[]
}>

/** A derived task: a step placed in its Chunk, Entry priority and dependency order. */
export type Task = Readonly<{
  id: string
  chunk: string
  entries: readonly string[]
  priority: string | null
  /** `existing` or `new` against the repository; `unknown` when none was resolved. */
  touches: readonly { path: string; status: 'existing' | 'new' | 'unknown' }[]
  after: readonly string[]
  closes: readonly string[]
  /** Tasks with no order between them and disjoint, declared touches: safe to run together. */
  parallel_with: readonly string[]
}>

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text) && new Set(value).size === value.length

/** Read `steps` in either form; entries that are neither a string ID nor a valid record are returned apart. */
export function stepRecords(index: Item): { records: StepRecord[]; invalid: unknown[] } {
  const records: StepRecord[] = []
  const invalid: unknown[] = []
  for (const value of list(index.steps)) {
    if (text(value)) records.push({ id: value, touches: [], after: [], closes: [] })
    else if (
      object(value) &&
      text(value.id) &&
      (['touches', 'after', 'closes'] as const).every(
        (key) => value[key] === undefined || strings(value[key])
      )
    )
      records.push({
        id: value.id,
        touches: (value.touches as string[] | undefined) ?? [],
        after: (value.after as string[] | undefined) ?? [],
        closes: (value.closes as string[] | undefined) ?? []
      })
    else invalid.push(value)
  }
  return { records, invalid }
}

/** Whether two repository paths overlap: equal, or one a directory containing the other. */
const overlaps = (a: string, b: string) => under(a, b) || under(b, a)

/** Steps in batch-then-`after` order: every step follows its batch's dependencies and its own `after`. */
function edges(records: readonly StepRecord[], batches: readonly Item[]): Map<string, Set<string>> {
  const batchOf = new Map<string, Item>()
  for (const batch of batches)
    for (const step of list(batch.steps)) if (text(step)) batchOf.set(step, batch)
  const byId = new Map(batches.filter((b) => text(b.id)).map((b) => [b.id as string, b]))
  const before = new Map<string, Set<string>>()
  for (const record of records) {
    const set = new Set(record.after)
    for (const dep of (batchOf.get(record.id)?.depends_on as unknown[] | undefined) ?? [])
      for (const step of (byId.get(dep as string)?.steps as unknown[] | undefined) ?? [])
        if (text(step)) set.add(step)
    before.set(record.id, set)
  }
  return before
}

/** Each step's full set of predecessors: its `after` steps and every step of an earlier batch. */
export const stepOrder = (index: Item) =>
  ancestors(edges(stepRecords(index).records, list(index.batches).filter(object)))

/** Every step that must finish before `id`, following declared and batch-implied order. */
export function ancestors(
  before: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, Set<string>> {
  const memo = new Map<string, Set<string>>()
  const visit = (id: string, seen: Set<string>): Set<string> => {
    if (memo.has(id)) return memo.get(id)!
    const result = new Set<string>()
    if (seen.has(id)) return result
    seen.add(id)
    for (const dep of before.get(id) ?? []) {
      result.add(dep)
      for (const inner of visit(dep, seen)) result.add(inner)
    }
    memo.set(id, result)
    return result
  }
  for (const id of before.keys()) visit(id, new Set())
  return memo
}

/**
 * Check step records against the leaf: touches stay inside `writes`, `after` and `closes` name
 * real steps and acceptance, the order has no cycle, and an `after` across batches is backed by a
 * batch dependency (otherwise the batch waves would schedule the two steps side by side).
 */
export function checkStepRecords(
  path: string,
  index: Item,
  records: readonly StepRecord[],
  report: Report
): void {
  const steps = new Set(records.map((record) => record.id))
  const acceptance = new Set(list(index.acceptance).filter(text))
  const writes = list(index.writes).filter(text).map(posix.normalize)
  const batches = list(index.batches).filter(object)
  // Order implied by batch dependencies alone, to tell whether an `after` is backed by one.
  const implied = ancestors(
    edges(
      records.map((r) => ({ ...r, after: [] })),
      batches
    )
  )
  const batchOf = (id: string) => batches.find((b) => list(b.steps).includes(id))?.id
  for (const record of records) {
    for (const touch of record.touches) {
      if (!pathForm(touch))
        report('SDD_V2_PATH_INVALID', `${path}: ${record.id} -> ${touch}`, 'step-touch-invalid')
      else if (!writes.some((w) => under(w, posix.normalize(touch))))
        report(
          'SDD_V2_META_SOURCE_MISMATCH',
          `${record.id} -> ${touch}`,
          'step-touch-outside-writes'
        )
    }
    for (const dep of record.after) {
      if (!steps.has(dep) || dep === record.id)
        report('SDD_V2_REFERENCE_MISSING', `${path}: ${record.id} -> ${dep}`, 'step-after-missing')
      else {
        const [mine, theirs] = [batchOf(record.id), batchOf(dep)]
        if (mine && theirs && mine !== theirs && !implied.get(record.id)?.has(dep))
          report('SDD_V2_REFERENCE_MISSING', `${mine} -> ${theirs}`, 'batch-dependency-missing')
      }
    }
    for (const id of record.closes)
      if (!acceptance.has(id))
        report('SDD_V2_REFERENCE_MISSING', `${path}: ${record.id} -> ${id}`, 'step-closes-missing')
  }
  const order = ancestors(edges(records, batches))
  for (const [id, before] of order)
    if (before.has(id)) report('SDD_V2_DEPENDENCY_CYCLE', `${path}: ${id}`, 'step-order')
}

/**
 * Derive the ordered task list for one Bundle: spec-kit's tasks.md, computed from the five-Meta
 * graph instead of written beside it. Order follows batch waves, then Entry priority, then `after`.
 * `mvp_tasks` is the smallest ordered set that closes every acceptance of the MVP Entries.
 */
export function buildTasks(
  index: Item,
  chunks: readonly { id: string; source_id: string; steps: readonly string[] }[],
  waves: readonly (readonly string[])[],
  entries: readonly {
    id: string
    priority: string | null
    modules: readonly string[]
    acceptance: readonly string[]
  }[],
  chunkModules: (chunk: string) => ReadonlySet<string>,
  mvp: readonly string[],
  repository: string | null
): { tasks: Task[]; mvp_tasks: string[] } {
  const all = new Map(stepRecords(index).records.map((record) => [record.id, record]))
  const batches = list(index.batches).filter(object)
  const owned = chunks.flatMap((chunk) =>
    chunk.steps.flatMap((id) => (all.has(id) ? [{ record: all.get(id)!, chunk }] : []))
  )
  const records = owned.map((item) => item.record)
  const before = ancestors(edges(records, batches))
  const wave = new Map(waves.flatMap((ids, at) => ids.map((id) => [id, at] as const)))
  const placed = owned.map((item, at) => {
    const modules = chunkModules(item.chunk.id)
    const related = entries.filter((entry) => entry.modules.some((id) => modules.has(id)))
    const best = related.map((e) => e.priority).sort((a, b) => rank(a) - rank(b))[0] ?? null
    return { ...item, at, entries: related.map((entry) => entry.id), priority: best }
  })
  // Kahn's order with a stable tie-break: earlier wave, higher priority, then written order.
  const pending = new Set(placed.map((item) => item.record.id))
  const ordered: typeof placed = []
  while (pending.size) {
    const ready = placed
      .filter((item) => pending.has(item.record.id))
      .filter((item) => [...(before.get(item.record.id) ?? [])].every((dep) => !pending.has(dep)))
      .sort(
        (a, b) =>
          (wave.get(a.chunk.id) ?? 0) - (wave.get(b.chunk.id) ?? 0) ||
          rank(a.priority) - rank(b.priority) ||
          a.at - b.at
      )
    const next = ready[0] ?? placed.find((item) => pending.has(item.record.id))! // cycle: reported elsewhere
    ordered.push(next)
    pending.delete(next.record.id)
  }
  const related = (a: string, b: string) => before.get(a)?.has(b) || before.get(b)?.has(a)
  const tasks = ordered.map(({ record, chunk, entries: ids, priority }) => ({
    id: record.id,
    chunk: chunk.id,
    entries: ids,
    priority,
    touches: record.touches.map((path) => ({
      path,
      status: pathStatus(repository, path)
    })),
    after: record.after,
    closes: record.closes,
    parallel_with: ordered
      .filter(
        (other) =>
          other.record.id !== record.id &&
          record.touches.length > 0 &&
          other.record.touches.length > 0 &&
          !related(record.id, other.record.id) &&
          !record.touches.some((a) => other.record.touches.some((b) => overlaps(a, b)))
      )
      .map((other) => other.record.id)
  }))
  const mvpAcceptance = new Set(
    entries.filter((entry) => mvp.includes(entry.id)).flatMap((entry) => entry.acceptance)
  )
  const declared = tasks.some((task) => task.closes.length)
  const closers = tasks.filter((task) =>
    declared
      ? task.closes.some((id) => mvpAcceptance.has(id))
      : task.entries.some((id) => mvp.includes(id))
  )
  const needed = new Set(closers.flatMap((task) => [task.id, ...(before.get(task.id) ?? [])]))
  return { tasks, mvp_tasks: tasks.filter((task) => needed.has(task.id)).map((task) => task.id) }
}
