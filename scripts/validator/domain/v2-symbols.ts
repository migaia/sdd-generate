import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { PSEUDOCODE_BUILTINS, read, walk } from '../../facts/repository.ts'
import { escape, list, object, pathForm, text, under, type Item } from './v2-meta.ts'
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

/** The entry a package exposes: `exports['.']`, `main` or `types`, else `src/index.ts`/`index.ts`. */
function packageEntry(repository: string, pkg: string): string | null {
  let manifest: Item
  try {
    manifest = JSON.parse(read(join(repository, pkg, 'package.json'))) as Item
  } catch {
    return null
  }
  const dot = object(manifest.exports) ? manifest.exports['.'] : manifest.exports
  const conditions = object(dot) ? [dot.types, dot.import, dot.default] : []
  return (
    [dot, ...conditions, manifest.main, manifest.types, 'src/index.ts', 'index.ts']
      .filter(text)
      .map((entry) => join(pkg, entry))
      .find((entry) => existsSync(join(repository, entry))) ?? null
  )
}

/**
 * OD-102: a name found only outside owned and read source must be reachable through its package's
 * entry, by name or by an `export *` of the declaring module; a step calling an internal-only symbol
 * stops implementation. Returns a declaring file that is internal, or null when one is reachable
 * or sits under no `package.json` (nothing to check against).
 */
function internalDeclaration(
  repository: string,
  files: readonly (readonly [string, string])[],
  name: string,
  declares: RegExp
): string | null {
  const hits = files
    .filter(([, body]) => body.includes(name) && declares.test(body))
    .map(([file]) => file)
  for (const file of hits) {
    let pkg = dirname(file)
    while (pkg !== '.' && !existsSync(join(repository, pkg, 'package.json'))) pkg = dirname(pkg)
    const entry = pkg === '.' ? null : packageEntry(repository, pkg)
    if (!entry) return null
    const module = `./${relative(dirname(entry), file)}`.replace(/\.[cm]?[jt]sx?$/, '')
    const exposes = new RegExp(
      `\\b${escape(name)}\\b|export\\s*\\*\\s*from\\s*['"]${escape(module)}(?:\\.[jt]s)?['"]`
    )
    if (entry === file || exposes.test(read(join(repository, entry)))) return null
  }
  return hits[0] ?? null
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
  // Read once: a large workspace is scanned for every name the owned source does not declare.
  let files: (readonly [string, string])[] | undefined
  let joined: string | undefined
  const workspace = () =>
    (files ??= walk(repository)
      .filter((file) => SOURCE.test(file))
      .map((file) => [file, read(join(repository, file))] as const))
  const anywhere = () =>
    (joined ??= workspace()
      .map(([, source]) => source)
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
      if (declares.test(documents) || declares.test(corpus)) continue
      // One pass over the joined workspace first; per-file lookup only for a name it declares.
      if (!declares.test(anywhere())) {
        candidates.push({ code: 'PSEUDOCODE_SYMBOL_UNRESOLVED', detail: `${id}: ${name}` })
        continue
      }
      const internal = internalDeclaration(repository, workspace(), name, declares)
      if (internal)
        candidates.push({
          code: 'PSEUDOCODE_SYMBOL_UNRESOLVED',
          detail: `${id}: ${name} is declared in ${internal} but not exported from its package entry`
        })
    }
  }
  return candidates
}
