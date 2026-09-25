import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { list, object, text, type Item } from './v2-meta.ts'
import { stepText } from './v2-symbols.ts'

type Candidate = { code: string; detail: string }

/** An equivalence clause that names its exceptions ("except BC1", "除 BC1 外", "BC1 所列除外"); 删除 is not 除. */
const EXCEPTIONS =
  /(?:\bexcept\b|\bother than\b|\bapart from\b|(?<![删移清排免解剔])除)[^。.;；\n]{0,40}?BC\d+|BC\d+[^。.;；\n]{0,20}?除外|例外[^。.;；\n]{0,10}?BC\d+/i
/** A clause that puts a BC outside its own scope on purpose. */
const OUT_OF_SCOPE =
  /不在本条范围|outside (?:R\d+|this (?:clause|requirement))|not in (?:this )?scope/i
/** A prose classification of acceptance as preserve ("Preserve acceptance: A3, A7", "保持验收：A3、A7"). */
const PRESERVE_LIST =
  /(?:保持验收|preserve acceptance|preserve cases?)\s*[:：]\s*((?:A[\w-]*\d+[a-z]?\b|无|none\b)[^。\n]*)/i
/** An acceptance whose own text calls it a preserve case. */
const PRESERVE_SELF = /保持验收|\bpreserve acceptance\b|\(preserve\)|（保持）/i

/** Every BC ID a phrase names, with ranges (`BC1–BC3`) expanded. */
function namedChanges(phrase: string): Set<string> {
  const named = new Set(phrase.match(/BC\d+[a-z]?/g) ?? [])
  for (const [, from, to] of phrase.matchAll(/BC(\d+)\s*[–—~～-]\s*BC(\d+)/g))
    for (let n = Number(from); n <= Number(to); n += 1) named.add(`BC${n}`)
  return named
}

/**
 * OD-57: a requirement that claims equivalence "except BC…" must except every behaviour change its
 * own acceptance cases name. A list written in one revision and left behind when a later BC is
 * added to the acceptance (R3 "除 BC1 外" while A3 excepts BC1 and BC3) is the failure; BCs the
 * requirement's acceptance never mentions are outside the claim and are not asked about.
 */
function equivalenceCandidates(index: Item, body: string): Candidate[] {
  const found: Candidate[] = []
  for (const requirement of list(index.requirements).filter(object)) {
    if (!text(requirement.id)) continue
    const line = stepText(body, requirement.id).split('\n')[0] ?? ''
    const sentence = line.split(/[。;；]|\.\s/).find((part) => EXCEPTIONS.test(part))
    if (!sentence || OUT_OF_SCOPE.test(sentence)) continue
    const named = namedChanges(sentence)
    const cited = new Set(
      list(requirement.acceptance)
        .filter(text)
        .flatMap((id) => [...namedChanges(stepText(body, id).split('\n')[0] ?? '')])
    )
    // A sub-change (BC4a) is covered when its parent (BC4) is excepted.
    const missing = [...cited].filter(
      (id) => !named.has(id) && !named.has(id.replace(/[a-z]$/, ''))
    )
    if (missing.length)
      found.push({
        code: 'SDD_V2_EQUIVALENCE_EXCEPTIONS_STALE',
        detail: `${requirement.id} excepts ${[...named].join(', ')} but its acceptance also names ${missing.join(', ')}: add them to ${requirement.id}'s exceptions, or say the clause does not cover them`
      })
  }
  return found
}

/**
 * OD-58: prose that classifies acceptance as preserve must agree with the contract `preserve` list,
 * because the host reads the prose to decide which evidence shape each case needs.
 */
function preserveCandidates(index: Item, body: string): Candidate[] {
  const preserve = new Set(list(index.preserve).filter(text))
  const found: Candidate[] = []
  for (const line of body.split('\n')) {
    const match = PRESERVE_LIST.exec(line)
    if (!match) continue
    // "本稿无保持验收：A10 的 base 失败…" says there is none; the IDs after it are commentary.
    const none = /(?:无|没有|\bno)\s*$/i.test(line.slice(Math.max(0, match.index - 6), match.index))
    const named = new Set(none ? [] : (match[1]!.match(/\bA[\w-]*\d+[a-z]?\b/g) ?? []))
    const extra = [...named].filter((id) => !preserve.has(id))
    const absent = [...preserve].filter((id) => !named.has(id))
    if (extra.length || absent.length)
      found.push({
        code: 'SDD_V2_PRESERVE_PROSE_STALE',
        detail: `prose preserve list ${[...named].join(', ') || '(none)'} differs from contract preserve ${[...preserve].join(', ') || '(none)'}: name the contract list instead of restating it, or bring them together`
      })
  }
  for (const id of list(index.acceptance).filter(text))
    if (PRESERVE_SELF.test(stepText(body, id).split('\n')[0] ?? '') && !preserve.has(id))
      found.push({
        code: 'SDD_V2_PRESERVE_PROSE_STALE',
        detail: `${id} calls itself a preserve acceptance but the contract preserve list omits it`
      })
  return found
}

/** Identifiers an inventory entry names: backticked tokens and camelCase words. */
const identifiers = (name: string) => [
  ...new Set([
    ...[...name.matchAll(/`([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!),
    ...(name.match(/\b[a-z]+[A-Z][\w$]*\b/g) ?? [])
  ])
]

/** The body of a named function or method in a source file, by brace matching; null when absent. */
function functionBody(source: string, name: string): string | null {
  const start = new RegExp(
    `(?:function\\s+${name}\\b|\\b${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)[^={]*=>|^\\s*(?:(?:public|private|protected|static|async)\\s+)*${name}\\s*\\()`,
    'm'
  ).exec(source)
  if (!start) return null
  const open = source.indexOf('{', start.index)
  if (open < 0) return null
  let depth = 0
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1
    else if (source[at] === '}' && --depth === 0) return source.slice(open, at + 1)
  }
  return null
}

/**
 * OD-60: a `cost-path` inventory that gates an operation and exempts some whole-collection work
 * must say so when the gated operation itself calls the exempt work. With a repository, each gated
 * entry's function body (read from its `path`) is scanned for calls to the exempt entries'
 * identifiers; an entry naming both the operation and the exempt work acknowledges the pair.
 */
function exemptCandidates(index: Item, repository: string | null): Candidate[] {
  if (!repository) return []
  const found: Candidate[] = []
  for (const inventory of list(index.inventories).filter(object)) {
    if (inventory.kind !== 'cost-path') continue
    const points = list(inventory.entry_points).filter(object)
    const exempt = points
      .filter((point) => text(point.exempt) && text(point.name))
      .flatMap((point) => identifiers(point.name as string))
    for (const point of points) {
      if (!text(point.path) || !text(point.name) || !list(point.acceptance).length) continue
      const file = join(repository, point.path.replace(/:\d+$/, ''))
      const operation = identifiers(point.name)[0] ?? point.name.split(/\s+/)[0]!
      const body = existsSync(file) && functionBody(readFileSync(file, 'utf8'), operation)
      if (!body) continue
      for (const work of exempt)
        if (
          work !== operation &&
          new RegExp(`\\b${work}\\s*\\(`).test(body) &&
          !points.some((p) => text(p.name) && p.name.includes(operation) && p.name.includes(work))
        )
          found.push({
            code: 'SDD_V2_EXEMPT_WORK_ON_GATED_OPERATION',
            detail: `${String(inventory.id)}: gated ${operation} (${point.path}) calls exempt ${work}; list the pair and say how its scaling acceptance counts that work`
          })
    }
  }
  return found
}

/** One Clarifications entry: `- YYYY-MM-DD Q: … → A: …`. */
const CLARIFICATION = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s+Q[:：](.*)$/
/** A clause ID an amendment can name. */
const CLAUSE_ID = /\b(?:A|R|S|BC|I)[\w-]*?\d+[a-z]?\b/g

/**
 * OD-62: an amendment recorded in the latest Clarifications entries changes the clauses it names,
 * and inventory entries are free-text copies that nothing re-reads. List each inventory entry that
 * cites an amended ID so the author confirms it still agrees before the host reads it.
 */
function amendmentCandidates(index: Item, fullBody: string): Candidate[] {
  const entries = fullBody
    .split('\n')
    .map((line) => CLARIFICATION.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
  if (!entries.length) return []
  const latest = entries
    .map((match) => match[1]!)
    .sort()
    .at(-1)!
  const amended = new Set(
    entries
      .filter((match) => match[1] === latest)
      .flatMap((match) => match[2]!.match(CLAUSE_ID) ?? [])
  )
  const found: Candidate[] = []
  for (const inventory of list(index.inventories).filter(object)) {
    const stale = list(inventory.entry_points)
      .filter(object)
      .map((point) => [point.name, point.exempt, point.statement].filter(text).join(' '))
      .map((words) => ({
        words,
        cited: (words.match(CLAUSE_ID) ?? []).filter((id) => amended.has(id))
      }))
      .filter((entry) => entry.cited.length)
    if (stale.length)
      found.push({
        code: 'SDD_V2_AMENDMENT_CITATION_RECHECK',
        detail: `${String(inventory.id)}: ${stale.length} entr${stale.length === 1 ? 'y cites' : 'ies cite'} ${[...new Set(stale.flatMap((entry) => entry.cited))].join(', ')}, amended on ${latest} ("${stale[0]!.words.slice(0, 60)}"…): confirm each still agrees with the amended clause`
      })
  }
  return found
}

/** A gate command that writes files: formatters, builds and generators (not their check modes). */
const WRITING_GATE =
  /`[^`]*\b(?:fmt|format|build|generate|codegen|lint:fix|--fix|--write)\b(?![:\w-]*check)[^`]*`/i
/** A gate run from the repository root or across workspace members. */
const ROOT_GATE = /根目录|仓库门禁|repository gate|\broot\b|workspace|\s-r\s|--recursive/i
/** A gate scoped to the owned packages, or one that says what happens to what it writes. */
const GATE_SCOPED = /--filter|\s-F\s|revert|restore|还原|恢复|不提交|reported separately|单独报告/i

/**
 * OD-64: a root gate that formats, builds or generates writes tracked files across workspace
 * members, including ones outside `writes`; it needs a filter to the owned packages or a stated
 * disposition for those writes, or the host must modify forbidden paths or stop.
 */
function gateCandidates(index: Item, body: string): Candidate[] {
  const writes = list(index.writes).filter(text)
  if (!writes.length || writes.some((path) => path === '.' || path === '')) return []
  return body
    .split('\n')
    .filter((line) => WRITING_GATE.test(line) && ROOT_GATE.test(line) && !GATE_SCOPED.test(line))
    .map((line) => ({
      code: 'SDD_V2_GATE_WRITES_OUT_OF_SCOPE',
      detail: `"${line.trim().slice(0, 80)}" writes across the repository while writes is ${writes.join(', ')}: filter the gate to those paths or say how writes outside them are reverted and reported`
    }))
}

/**
 * Contract lists restated or split in prose (OD-57, OD-58), cost-path exemptions (OD-60), inventory
 * entries an amendment leaves behind (OD-62) and root gates that write out of scope (OD-64).
 * `fullBody` keeps the Clarifications log, which the other checks deliberately skip.
 */
export function listCandidates(
  index: Item,
  body: string,
  repository: string | null,
  fullBody = body
): Candidate[] {
  return [
    ...equivalenceCandidates(index, body),
    ...preserveCandidates(index, body),
    ...exemptCandidates(index, repository),
    ...amendmentCandidates(index, fullBody),
    ...gateCandidates(index, body)
  ]
}
