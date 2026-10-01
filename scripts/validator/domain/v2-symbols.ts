import { join } from 'node:path'
import { PSEUDOCODE_BUILTINS, read, walk } from '../../facts/repository.ts'
import { escape, list, pathForm, text, under, type Item } from './v2-meta.ts'
import { stepRecords } from './v2-tasks.ts'

/** Source files a step's calls may resolve to. */
export const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|kt|swift)$/
/** A call in pseudocode: a lower-case identifier followed by `(`, not a method on another value. */
const CALL = /(?:^|[^.\w])([a-z][A-Za-z0-9_]{3,})\s*\(/g
/** Language keywords a call pattern can match (`import(`, `typeof(`); never a symbol to resolve. */
const KEYWORDS = new Set([
  'import',
  'require',
  'typeof',
  'super',
  'switch',
  'while',
  'catch',
  'function'
])
/** Where a name is declared: a function, class, binding or assigned function. */
const definition = (name: string) =>
  new RegExp(
    `(?:function|class|def|fn|func)\\s+${name}\\b|(?:const|let|var)\\s+${name}\\b|\\b${name}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\()`
  )

/** The text of every source file under `roots` (repository-relative), except `skip`. */
export const sourceCorpus = (repository: string, roots: readonly string[], skip?: string) =>
  walk(repository)
    .filter((file) => file !== skip && SOURCE.test(file) && roots.some((root) => under(root, file)))
    .map((file) => read(join(repository, file)))
    .join('\n')

/**
 * The prose of one step: its anchor line and everything under it (continuation lines and fences)
 * up to the next unindented list item or heading outside a fence.
 */
export function stepText(body: string, id: string): string {
  const lines = body.split('\n')
  const tail = `(?:\\*\\*)?${escape(id)}(?:\\*\\*)?(?=\\s|[:：|]|$)`
  // The normative definition is a heading or list item; a table row that starts with the ID (a
  // clause map, a traceability table) is the anchor only when no such definition exists (OD-86).
  const definition = new RegExp(`^(?:#{1,6}\\s+|[-*]\\s+)${tail}`)
  const row = new RegExp(`^\\|\\s*${tail}`)
  let start = lines.findIndex((line) => definition.test(line))
  if (start < 0) start = lines.findIndex((line) => row.test(line))
  if (start < 0) return ''
  const out = [lines[start]!]
  let fenced = false
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    else if (!fenced && /^(?:#{1,6}\s|[-*]\s|\|)/.test(line)) break
    out.push(line)
  }
  return out.join('\n')
}

/**
 * The v1 `PSEUDOCODE_SYMBOL_UNRESOLVED` candidate for sdd/v2: every call a step's prose or
 * pseudocode makes must be declared in the source the leaf owns or reads (`writes`, Bundle
 * `reads`) or in the SDD itself; a step defined through `step_sources` is read from its source
 * document (`external`: step ID to that document's text). It stays a candidate, never a blocker: a regular expression
 * cannot see imports, generated code or a symbol the step is about to create under another name.
 */
export function symbolCandidates(
  index: Item,
  body: string,
  repository: string | null,
  reads: readonly string[],
  external: ReadonlyMap<string, string> = new Map()
): { code: string; detail: string }[] {
  if (!repository) return []
  const roots = [...list(index.writes), ...reads].filter(
    (root): root is string => text(root) && pathForm(root)
  )
  if (!roots.length) return []
  const corpus = sourceCorpus(repository, roots)
  // A step may call what a dependency package already defines (OD-74); read the rest of the
  // workspace only when the owned and read source does not declare a name.
  let workspace: string | undefined
  const elsewhere = () =>
    (workspace ??= walk(repository)
      .filter((file) => SOURCE.test(file))
      .map((file) => read(join(repository, file)))
      .join('\n'))
  const candidates: { code: string; detail: string }[] = []
  // A step defined through step_sources lives in its source document, which may also declare names.
  const documents = [body, ...external.values()].join('\n')
  for (const { id } of stepRecords(index).records) {
    // Comments inside a fence describe, they do not call.
    const step = stepText(external.get(id) ?? body, id).replace(
      /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm,
      ''
    )
    for (const name of new Set([...step.matchAll(CALL)].map((match) => match[1]!))) {
      if (PSEUDOCODE_BUILTINS.has(name) || KEYWORDS.has(name)) continue
      const declares = definition(name)
      if (declares.test(documents) || declares.test(corpus) || declares.test(elsewhere())) continue
      candidates.push({ code: 'PSEUDOCODE_SYMBOL_UNRESOLVED', detail: `${id}: ${name}` })
    }
  }
  return candidates
}
