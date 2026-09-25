import { list, object, text, type Item } from './v2-meta.ts'
import { PRESERVATION } from './v2-semantics.ts'
import { stepText } from './v2-symbols.ts'

type Candidate = { code: string; detail: string }
/** A quantified claim over every member of a list ("every `use`/`unUse`", "每次 …"). */
const QUANTIFIED = /\b(?:every|each|all)\b|每次|每个|所有/i
/** A requirement that spans a variant set: modes, platforms, variants. */
const VARIANTS = /\b(?:modes?|platforms?|variants?)\b|模式|平台|变体/i
/** A complexity or scaling outcome ("proportional to", "linear", "O(n)", 成正比, 线性). */
const SCALING =
  /\b(?:proportional|linear(?:ly)?|scal(?:e|es|ing)|complexity)\b|O\([^)]*\)|成正比|线性|复杂度/i
/** A measurement of the public operation itself, not an internal counter. */
const END_TO_END = /end[ -]to[ -]end|wall|per[ -](?:call|operation)|mean time|端到端|耗时/i

/**
 * An algorithm whose correctness rests on a data precondition (OD-47): binary search needs sorted
 * input, a merge needs ordered runs, dedupe needs a key, an append-only order needs monotonic writes.
 */
const PREMISE =
  /binary[ -]search|\bsorted\b|merge[ -]sort|\bdedupe|de-?duplicat|monotonic|append-only|二分|有序|归并|去重|单调|只追加/i
/** A repository location cited as `path/file.ext:line`, the observation a premise must rest on. */
const LOCATION = /[\w./-]+\.\w+:\d+/
/** Words in the same phrase before a premise that forbid it rather than prescribe it ("禁止…去重", "never sorted"). */
const NEGATION = /禁止|不得|不要|不能|无需|\b(?:never|not|no|without|don't)\b/i

/** Whether a clause prescribes a premise algorithm, not merely forbids one. */
function prescribes(clause: string): boolean {
  const pattern = new RegExp(PREMISE.source, 'gi')
  for (const match of clause.matchAll(pattern))
    // The phrase runs back to the previous clause punctuation, so a prohibition earlier in the
    // same phrase still applies and one in an earlier sentence does not.
    if (
      !NEGATION.test(
        clause
          .slice(0, match.index)
          .split(/[，。；;,.!?、]/)
          .pop() ?? ''
      )
    )
      return true
  return false
}

/** A step that rewrites or replaces existing code (OD-54), as opposed to creating new code. */
const REWRITE = /\b(?:rewrite|rewrites|reimplement|replace)\b|重写|改写|重新实现|替换/i

/** A state vocabulary declared in a design fence: `type XStatus = 'a' | 'b' | 'c'`. */
const STATE = /(?:type|enum)\s+(\w*(?:Status|State|Phase))\s*=?\s*\{?([^\n]*)/g

const ticked = (line: string) =>
  [...line.matchAll(/`([A-Za-z_][\w-]*)(?:\([^`]*\))?`/g)].map((match) => match[1]!)
const heading = (body: string, names: RegExp) =>
  body.split('\n').some((line) => /^#{1,6}\s/.test(line) && names.test(line))

/**
 * Scope gaps a design can leave while every ID resolves (OD-40..OD-43, OD-45):
 * - a must-ship requirement quantified over enumerated operations whose acceptance and inventory
 *   leave some operation unnamed;
 * - a status/state/phase vocabulary of three or more values declared with no state-combination
 *   table (which existing axes it combines with, what each combination projects to);
 * - a claim that behaviour is the same as an earlier revision with no `preserved-branch`
 *   inventory pinning each branch of the replaced code to a test or acceptance;
 * - a requirement spanning a variant set with no capability matrix recording each cell's source;
 * - a scaling outcome measured only by a subsystem counter (OD-45): it needs an end-to-end timing of
 *   the public operation at two or more sizes and a `cost-path` inventory of whole-collection work;
 * - an algorithm premise (sorted, merged, deduplicated, monotonic input) with no cited location that
 *   establishes it (OD-47);
 * - a step that rewrites existing code with no `current-behaviour` inventory of the replaced paths
 *   (OD-54).
 */
export function scopeCandidates(index: Item, body: string): Candidate[] {
  const found: Candidate[] = []
  const inventories = list(index.inventories).filter(object)
  for (const requirement of list(index.requirements).filter(object)) {
    if (!text(requirement.id)) continue
    const line = stepText(body, requirement.id).split('\n')[0] ?? ''
    const names = ticked(line)
    if (requirement.kind === 'must-ship' && QUANTIFIED.test(line) && names.length >= 2) {
      const cases = list(requirement.acceptance)
        .filter(text)
        .map((id) => stepText(body, id))
        .join('\n')
      const listed = inventories
        .filter((entry) => entry.requirement === requirement.id)
        .flatMap((entry) =>
          list(entry.entry_points).map((point) => (object(point) ? point.name : ''))
        )
      const uncovered = names.filter(
        (name) => !new RegExp(`\\b${name}\\b`).test(cases) && !listed.includes(name)
      )
      if (uncovered.length)
        found.push({
          code: 'SDD_V2_ENUMERATED_OPERATION_UNCOVERED',
          detail: `${requirement.id} covers ${names.join(', ')} but no acceptance or inventory names ${uncovered.join(', ')}`
        })
    }
    if (requirement.kind === 'must-ship' && SCALING.test(line)) {
      const lines = list(requirement.acceptance)
        .filter(text)
        .map((id) => stepText(body, id).split('\n')[0] ?? '')
      const sized = lines.some(
        (item) => END_TO_END.test(item) && new Set(item.match(/\b\d+\b/g)).size >= 2
      )
      const paths = inventories.some(
        (entry) =>
          entry.requirement === requirement.id &&
          entry.kind === 'cost-path' &&
          list(entry.entry_points).length > 0
      )
      if (!sized || !paths)
        found.push({
          code: 'SDD_V2_SCALING_ORACLE_UNSCOPED',
          detail: `${requirement.id} states a scaling outcome; ${[
            sized
              ? ''
              : 'add an acceptance timing the public operation end to end at two or more sizes',
            paths
              ? ''
              : 'list the whole-collection paths (copies, scans, rebuilds) on it in a cost-path inventory'
          ]
            .filter(Boolean)
            .join(' and ')}`
        })
    }
    if (VARIANTS.test(line) && names.length >= 3 && !heading(body, /capability matrix|能力矩阵/i))
      found.push({
        code: 'SDD_V2_VARIANT_MATRIX_MISSING',
        detail: `${requirement.id} spans ${names.join(', ')}; add a Capability Matrix (variant × capability → supported, source) and clarify every inferred or changed cell`
      })
  }
  for (const [, name, values] of body.matchAll(STATE))
    if ((values!.match(/['"][^'"]+['"]|\b\w+\s*:/g) ?? []).length >= 3)
      if (!heading(body, /state (?:combinations|space)|状态组合|状态空间/i))
        found.push({
          code: 'SDD_V2_STATE_SPACE_UNSTATED',
          detail: `${name} changes a state vocabulary; add a State Combinations table (existing axes × new state → reachable, projection, each rule's behaviour)`
        })
  const pinned = inventories.some(
    (entry) =>
      entry.kind === 'preserved-branch' &&
      list(entry.entry_points).some(
        (point) =>
          object(point) &&
          text(point.path) &&
          /:\d+$/.test(point.path) &&
          (list(point.acceptance).length || text(point.test))
      )
  )
  const clauseIds = [
    ...list(index.requirements).map((r) => (object(r) ? r.id : r)),
    ...list(index.steps).map((step) => (object(step) ? step.id : step))
  ].filter(text)
  for (const id of clauseIds) {
    const clause = stepText(body, id).split('\n')[0] ?? ''
    if (prescribes(clause) && !LOCATION.test(clause))
      found.push({
        code: 'SDD_V2_ALGORITHM_PREMISE_UNGROUNDED',
        detail: `${id} prescribes an algorithm with a data precondition ("${clause.trim().slice(0, 80)}"): cite the file:line where the current code establishes it, or the step that will`
      })
  }
  const surveyed = inventories.some((entry) => entry.kind === 'current-behaviour')
  const rewrites = list(index.steps)
    .map((step) => (object(step) ? step.id : step))
    .filter(text)
    .filter((id) => {
      const clause = stepText(body, id).split('\n')[0] ?? ''
      return REWRITE.test(clause) && /`[\w./-]+\.\w+`/.test(clause)
    })
  if (rewrites.length && !surveyed)
    found.push({
      code: 'SDD_V2_REWRITE_BEHAVIOUR_UNSURVEYED',
      detail: `${rewrites.join(', ')} rewrite existing code: list what the replaced paths do now (ordering, visibility windows, failure and rollback effects) in a current-behaviour inventory, each kept by an acceptance or changed by a BC`
    })
  const claims = body
    .split('\n')
    .filter((line) => PRESERVATION.test(line.replace(/^\s*[-*]\s+\S+\s+/, '')))
  if (claims.length && !pinned)
    found.push({
      code: 'SDD_V2_PRESERVATION_UNPINNED',
      detail: `"${claims[0]!.trim().slice(0, 80)}": list each branch of the replaced code (file:line at the base) in a preserved-branch inventory with the test or acceptance that pins it`
    })
  return found
}
