import type { ExecutionSlice } from './v2-meta.ts'

/**
 * Subagent briefs derived from a ready handoff ([dispatch](../../../references/dispatch.md)).
 *
 * Text runs most-stable first (program, then document, then unit) and is serialized
 * deterministically, so sibling briefs of one run share byte-identical leading text that a
 * prefix-matching prompt cache can reuse. A brief is `shared_prefix + scope_prefix + unit.text`.
 */
export type Dispatch = Readonly<{
  /** Identical for every unit of the program, or of a lone leaf. */
  shared_prefix: string
  /** Identical for every unit inside the selected leaf; empty for a program root. */
  scope_prefix: string
  /** Units in dependency layers: a layer starts once earlier layers have delivered. */
  layers: readonly (readonly { id: string; text: string }[])[]
}>
type Child = Readonly<{ id: string; path: string; depends_on: readonly string[] }>
type Field = readonly [string, string | readonly string[]]
type Leaf = Readonly<{ path: string; read_order: readonly string[]; slice: ExecutionSlice }>

/** A heading and `label: value` lines; list values are deduplicated and sorted, blanks omitted. */
const block = (head: string, fields: readonly Field[]) =>
  fields.reduce((out, [label, value]) => {
    const text = typeof value === 'string' ? value.trim() : [...new Set(value)].sort().join(', ')
    return text ? `${out}${label}: ${text}\n` : out
  }, `${head}\n`)

const RULES =
  'the SDD is the authority, read it rather than trusting this brief; write only the paths your unit touches; return changed paths and an sdd-evidence/v1 report for the acceptance you close'

/** Briefs for program children in layers, or for the selected leaf's Chunks in waves. */
export function dispatchOf(
  shared: readonly Field[],
  units: { children: readonly (readonly Child[])[] } | { leaf: Leaf; scope: readonly Field[] }
): Dispatch {
  const shared_prefix = block('# create-sdd dispatch', [...shared, ['Rules', RULES]])
  if ('children' in units)
    return {
      shared_prefix,
      scope_prefix: '',
      layers: units.children.map((layer) =>
        layer.map((child) => ({
          id: child.id,
          text: block(`## Unit ${child.id}`, [
            ['Document', child.path],
            ['Depends on', child.depends_on],
            ['Next', 'validate this document and dispatch its own handoff']
          ])
        }))
      )
    }
  const { path, read_order, slice } = units.leaf
  const scope_prefix = block(`## Document ${slice.bundle}`, [
    ['Path', path],
    ['Read in order', read_order.join(' > ')],
    ['Reads', slice.reads],
    ['Required assets', slice.required_assets.map((a) => `${a.path}@${a.version} (${a.producer})`)],
    ...units.scope
  ])
  return {
    shared_prefix,
    scope_prefix,
    layers: slice.waves.map((wave) =>
      wave.map((id) => {
        const tasks = slice.tasks.filter((task) => task.chunk === id)
        return {
          id,
          text: block(`### Unit ${id}`, [
            ['Steps', tasks.map((task) => task.id).join(' > ')],
            ['Touches', tasks.flatMap((task) => task.touches.map((touch) => touch.path))],
            ['Closes', tasks.flatMap((task) => task.closes)]
          ])
        }
      })
    )
  }
}
