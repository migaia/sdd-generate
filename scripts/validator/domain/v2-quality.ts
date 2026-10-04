import { join } from 'node:path'
import { read, walk } from '../../facts/repository.ts'
import { list, object, pathForm, text, type Item } from './v2-meta.ts'
import { SOURCE, stepText } from './v2-symbols.ts'

/**
 * Acceptance-quality candidates (OD-15..OD-28, PluginHost R2 SHIP audit).
 *
 * Every rule here is advisory: a regular expression over prose cannot decide semantic coverage, so
 * each finding names the clause and what would silence it. A repository preset may promote any of
 * them to a blocker. Structural readiness never depended on these, which is exactly how the
 * audited document reached SHIP with fourteen gaps; the candidates make the gaps visible.
 */
type Candidate = { code: string; detail: string }

/** Enumerated outcomes a requirement names: SCREAMING codes and quoted literals in code spans. */
const LITERAL = /`([A-Z][A-Z0-9_]{3,}|'[^'`]+')`/g
/** Words whose weaker reading (direct only, single element) a fixture must be able to reject. */
const QUANTIFIER = /\b(?:all|every|transitive(?:ly)?)\b|全部|所有|每个|传递/i
/** Fixtures that separate a quantifier from its weaker reading: lists, chains, counts (OD-31). */
const DISCRIMINATING =
  /\[[^\]\n]*,[^\]\n]*\]|(?:←|→|->|<-)[^←→\n]{1,40}(?:←|→|->|<-)|`[^`\n]+`\s*、\s*`[^`\n]+`|\b(?:two|three|four|five|several|multiple)\b|(?:[2-9]|\d{2,}|[两二三四五六七八九十])\s*(?:个|种|项|条|级)|多个|至少\s*2|≥\s*2/i
/** A code-span call: the clause names an operation other entry points could bypass. */
const OPERATION = /`[A-Za-z_][\w.]*\(/
/** A state guard on that operation: it rejects, refuses or throws a code. Bare prohibitions are not guards. */
const GUARD =
  /\b(?:rejects?|refuses?|blocks?)\b|默认拒绝|拒绝|阻止|(?:\bthrows?\b|抛)[^。\n]{0,40}`[A-Z][A-Z0-9_]{3,}`/i
/** Test-support modules a boundary oracle may import from src without driving an internal path. */
const SUPPORT =
  /(?:^|[/_.-])(?:tests?|fixtures?|helpers?|observers?|mocks?|stubs?|fakes?|spy)(?:[/_.-]|$)/i
/** A public signature or return-shape migration. */
const SIGNATURE =
  /\breturns?\b[^.;。\n]*\binstead of\b|返回[^。；\n]*(?:改为|而非|不再)|\bbreaking\b/i
/** A requirement that names an externally observable boundary. */
const BOUNDARY = /\b(?:public|host|CLI|endpoint|handle|outlet)\b|公开|宿主|出口|句柄/i
const THROWS = /(?:\bthrows?\b|\brejects?\b|抛|拒绝)[^\n。]{0,40}`[A-Z][A-Z0-9_]{3,}`/i
const POSITION = /top-level|顶层|`?\.?cause`?|errors\[|wrapped|包装/i
const COMPLIES = /\bcompl(?:y|ies|iant)\b|\bsatisf(?:y|ies)\b|遵守|符合/i
const CLAUSE_ID = /\b(?:R|S|A|C|DD|D)\d+\b/
const CAUSE_OVERWRITE =
  /attach(?:es|ed)?\s+as\s+`?cause`?\s+on\s+the\s+original|sets?\s+`?cause`?\s+on\s+the\s+original|以\s*`?cause`?\s*挂在原|overwrit\w*\s+(?:its|the)\s+`?cause`?/i
const NEGATIVE = /no output|无输出|命中数?为\s*0|\b0 (?:hits|matches)\b|returns nothing/i
const RETAINED = /\bexcept\b|excluding|排除|保留|retained/i
const DIRTY = /dirty[- ]work(?:ing )?tree|未提交|uncommitted/i
const RECURSIVE =
  /\bpnpm\s+(?:-r|--recursive)\b|\bnpm\s+run\s+\S+\s+(?:--workspaces|-ws)\b|\byarn\s+workspaces\s+foreach\b|\bturbo\s+run\b|\bnx\s+run-many\b|\blerna\s+run\b/
const DISPOSITION =
  /pre-?existing|existing defects?|既有缺陷|non-blocking|不阻塞|cannot block|failure domain|失败域/i
const BUDGET = /coverage[- ]custody|coverage thresholds?|size-limit|bundle budget|\bcustody\b/i
const FEASIBLE =
  /feasib|baseline[- ]update|update the baseline|refresh(?:es)? the baseline|刷新基线|基线刷新|可行/i
const COUNT =
  /(?:case|test) counts?\b[^.\n]{0,40}\b(?:same|equal|unchanged|identical)\b|用例(?:总)?数[^。\n]{0,20}(?:相同|不变|相等)/i
const RENAME_MAP = /rename map|重命名映射|case IDs?|用例\s*ID|stable IDs?/i
const TEMP = /temporary checkout|临时检出|scratch (?:checkout|clone)|fresh clone|临时目录/i
const SCRIPTED = /`[^`]*\b(?:node|bun|pnpm|npm|deno|bash|sh)\b[^`]*\/[^`]*`/
/** A coordination resource several threads or leaves share (OD-105); its protocol lives in one tool. */
const COORDINATION =
  /exclusive (?:measurement )?(?:window|lock)|\block ?file\b|\bheartbeat|独占窗口|锁文件|心跳/i
/** An absolute latency or throughput budget (OD-106), and the baseline-relative guard it needs. */
const PERF = /\bp(?:50|9\d(?:\.\d+)?)\b.*?\d\s*(?:µs|us|ms|ns)\b|\d\s*(?:ops\/s|req\/s|rps)\b/i
const REGRESSION_GUARD = /baseline|regress|基线|回归/i
const TEST = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/
/** A removal clause; its code spans name what the requirement takes away. */
const REMOVES = /(?:\bremov\w*|\bdelet\w*|\bdrop\w*|删除|移除)([^;；。\n]*)/gi
const EXPORT = /\bexports?\b|导出|入口|\bentry\b|\broot\b|公开/i
/** A promise that a file's assertions survive, unless the line also rules on export assertions. */
const UNCHANGED = /assertions?\s+(?:stay\s+|remain\s+)?unchanged|断言(?:保持)?不变|不改一行/i
const EXPORT_RULE = /export assertions?|导出断言/i
/**
 * A whole case that holds before the change as well: golden output or a before/after equivalence.
 * Bare "still"/"仍"/"不变" are left out; they usually qualify one assertion inside a change case.
 */
const PRESERVED =
  /\bgolden\b|same as (?:before|the base)|before and after the change|与改动前(?:相同|一致)|改动前后|迁移前后/i

/** Body lines under the first heading matching `pattern`, up to the next heading of equal or higher level. */
function headingLines(body: string, pattern: RegExp): string[] {
  const lines = body.split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && pattern.test(line))
  if (start < 0) return []
  const level = /^(#+)/.exec(lines[start]!)![1]!.length
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#+)\s/.exec(line)
    if (heading && heading[1]!.length <= level) break
    out.push(line)
  }
  return out
}

/** A module path without directory or extension, for comparing source and export targets. */
const stem = (path: string) => (path.split('/').pop() ?? '').replace(/\.[^.]*$/, '')

/**
 * Public entry stems of the package that owns `file`: `index` plus every `exports` target, so a
 * test importing a published subpath (`./composition`) drives a boundary, not an internal module.
 */
function publicEntries(repository: string, file: string): Set<string> {
  const entries = new Set(['index'])
  const parts = file.split('/')
  for (let at = parts.length - 1; at > 0; at--) {
    const manifest = read(join(repository, ...parts.slice(0, at), 'package.json'))
    if (!manifest) continue
    /** Collects every string target inside an `exports` value. */
    const collect = (value: unknown): void => {
      if (typeof value === 'string') entries.add(stem(value))
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    try {
      collect((JSON.parse(manifest) as { exports?: unknown }).exports)
    } catch {
      // An unreadable manifest only narrows the public set to `index`; the finding stays advisory.
    }
    break
  }
  return entries
}

/** Normative clauses in a section: list items and table body rows, without header rows. */
function clauses(lines: readonly string[]): string[] {
  const separator = (line?: string) => !!line && /^\s*\|[\s:|-]+\|\s*$/.test(line)
  return lines.filter(
    (line, at) =>
      /^\s*[-*]\s/.test(line) ||
      (/^\s*\|/.test(line) && !separator(line) && !separator(lines[at + 1]))
  )
}

/** Candidates for the acceptance-quality defects; `repository` enables the source-backed rules. */
export function qualityCandidates(
  index: Item,
  body: string,
  repository: string | null
): Candidate[] {
  const found: Candidate[] = []
  const requirements = list(index.requirements).filter(object)
  const acceptanceIds = new Set(list(index.acceptance).filter(text))
  const known = new Set([...acceptanceIds, ...requirements.map((r) => String(r.id))])
  const accepted = (ids: readonly unknown[]) =>
    ids
      .filter(text)
      .map((id) => stepText(body, id))
      .join('\n')
  const inventories = list(index.inventories).filter(object)
  const roots = list(index.writes).filter((root): root is string => text(root) && pathForm(root))
  let files: readonly string[] | undefined
  /** Repository files under `writes`, walked once per validation and shared by every rule. */
  const owned = (): readonly string[] =>
    (files ??= repository ? roots.flatMap((root) => walk(repository, root)) : [])
  /** An inventory counts only with a known kind and at least one entry point. */
  const substantive = (entry: Item) =>
    (entry.kind === 'invariant' || entry.kind === 'surface') && list(entry.entry_points).length > 0
  /** An acceptance's oracle files: its declared `oracles` path, else test paths its prose names. */
  const oraclePaths = (acceptanceId: string): string[] => {
    const declared = object(index.oracles) ? index.oracles[acceptanceId] : undefined
    if (text(declared)) return pathForm(declared) ? [declared] : []
    return [
      ...stepText(body, acceptanceId).matchAll(/((?:tests?|__tests__)\/[\w./-]+\.[cm]?[jt]sx?)/g)
    ].flatMap(([, named]) => {
      const hits = owned().filter((file) => file === named || file.endsWith(`/${named}`))
      return hits.length === 1 ? hits : []
    })
  }

  for (const requirement of requirements) {
    const id = String(requirement.id)
    const clause = stepText(body, id)
    const linked = list(requirement.acceptance)
    const acceptance = accepted(linked)
    // OD-22: each enumerated outcome needs an acceptance that mentions it.
    for (const [, literal] of clause.matchAll(LITERAL)) {
      const token = literal!.replace(/^'|'$/g, '')
      if (!acceptance.includes(token))
        found.push({ code: 'SDD_V2_REQUIREMENT_OUTCOME_UNCOVERED', detail: `${id}: ${literal}` })
    }
    // OD-24: a quantifier needs a fixture that separates it from the weaker reading.
    if (QUANTIFIER.test(clause) && acceptance && !DISCRIMINATING.test(acceptance))
      found.push({
        code: 'SDD_V2_QUANTIFIER_FIXTURE_UNDISCRIMINATING',
        detail: `${id}: use at least two elements or a two-level chain in ${linked.join(', ')}`
      })
    // OD-26 / OD-20: guards and signature migrations declare an entry-point inventory.
    if (
      ((OPERATION.test(clause) && GUARD.test(clause)) || SIGNATURE.test(clause)) &&
      !inventories.some((entry) => entry.requirement === id && substantive(entry))
    )
      found.push({
        code: 'SDD_V2_INVARIANT_INVENTORY_MISSING',
        detail: `${id}: list every mutating entry point or construction surface in \`inventories\``
      })
    // OD-25: a boundary requirement's oracle must drive that boundary, not an internal module.
    if (repository && BOUNDARY.test(clause))
      for (const acceptanceId of linked.filter(text))
        for (const oracle of oraclePaths(acceptanceId)) {
          const entries = publicEntries(repository, oracle)
          const internal = [...read(join(repository, oracle)).matchAll(/from\s+['"]([^'"]+)['"]/g)]
            .map((match) => match[1]!)
            .filter(
              (path) =>
                /\/src\//.test(path) && !entries.has(stem(path)) && !SUPPORT.test(stem(path))
            )
          if (internal.length)
            found.push({
              code: 'SDD_V2_ORACLE_BELOW_BOUNDARY',
              detail: `${acceptanceId}: ${oracle} drives ${internal.slice(0, 3).join(', ')} for boundary requirement ${id}`
            })
        }
  }

  const byId = new Map(requirements.map((r) => [String(r.id), r]))
  for (const inventory of inventories) {
    for (const entry of list(inventory.entry_points)) {
      const ids = object(entry) ? list(entry.acceptance).filter(text) : []
      const covered = ids.length > 0 && ids.every((a) => acceptanceIds.has(a))
      if (!covered && !(object(entry) && text(entry.exempt)))
        found.push({
          code: 'SDD_V2_INVENTORY_ENTRY_UNCOVERED',
          detail: `${String(inventory.id)}: ${object(entry) ? String(entry.name) : '?'}`
        })
    }
    // OD-20: every owned declaration site of a migrated symbol is a listed surface.
    const requirement = byId.get(String(inventory.requirement))
    if (!repository || inventory.kind !== 'surface' || !requirement) continue
    const listed = new Set(
      list(inventory.entry_points).flatMap((entry) =>
        object(entry) && text(entry.path) ? [entry.path] : []
      )
    )
    const sources = owned()
      .filter((file) => SOURCE.test(file) && !TEST.test(file) && !listed.has(file))
      .map((file) => [file, read(join(repository, file))] as const)
    const symbols = [...stepText(body, String(requirement.id)).matchAll(/`([A-Za-z_]\w*)\(\)?`/g)]
    for (const [, name] of symbols) {
      const declares = new RegExp(
        `function\\s+${name}\\b|^\\s*(?:readonly\\s+)?${name}\\s*\\??\\s*\\([^)]*\\)\\s*:|(?:const|let|var)\\s+${name}\\b`,
        'm'
      )
      for (const [file, content] of sources)
        if (declares.test(content))
          found.push({
            code: 'SDD_V2_SURFACE_INVENTORY_INCOMPLETE',
            detail: `${String(inventory.id)}: ${file} declares ${name!}`
          })
    }
  }

  const wrapsErrors = /`cause`|\.cause\b/.test(body)
  const dirty = DIRTY.test(body)
  for (const acceptanceId of acceptanceIds) {
    const clause = stepText(body, acceptanceId)
    // OD-27: when the document wraps errors, say where the asserted code sits.
    if (wrapsErrors && THROWS.test(clause) && !POSITION.test(clause))
      found.push({ code: 'SDD_V2_ERROR_POSITION_UNSTATED', detail: acceptanceId })
    // OD-16: an index inventory cannot prove presence or absence on a dirty worktree.
    if (dirty && /git\s+ls-files/.test(clause))
      found.push({ code: 'SDD_V2_INDEX_ORACLE_DIRTY_TREE', detail: acceptanceId })
    // OD-19: equal counts do not prove the same cases survived.
    if (COUNT.test(clause) && !RENAME_MAP.test(clause))
      found.push({ code: 'SDD_V2_COUNT_ONLY_PRESERVATION', detail: acceptanceId })
    // OD-21: a temporary environment needs a checked script, not prose.
    if (TEMP.test(clause) && !SCRIPTED.test(clause))
      found.push({ code: 'SDD_V2_ORACLE_PROCEDURE_UNSCRIPTED', detail: acceptanceId })
    // OD-15: a negative search on a generic member token matches unrelated owners.
    if (NEGATIVE.test(clause) && !RETAINED.test(clause))
      for (const [, command] of clause.matchAll(/`((?:rg|grep)\b[^`]*)`/g)) {
        const pattern = /"([^"]+)"|'([^']+)'/.exec(command!)
        const generic = (pattern?.[1] ?? pattern?.[2] ?? '')
          .split('|')
          .filter((branch) => /^\\?\.[a-z][A-Za-z]{1,20}(?:\\b)?$/.test(branch))
        if (generic.length)
          found.push({
            code: 'SDD_V2_NEGATIVE_SEARCH_GENERIC_TOKEN',
            detail: `${acceptanceId}: ${generic.join(', ')}`
          })
      }
  }

  // OD-33: an acceptance asserts a member the document's interface fences keep private.
  const fenced = [...body.matchAll(/```(\w*)\n([\s\S]*?)```/g)]
    .filter(([, lang]) => /^(?:ts|tsx|typescript|js|javascript|)$/.test(lang!))
    .map(([, , code]) => code)
    .join('\n')
  const hidden = new Set(
    [...fenced.matchAll(/(?:#|\bprivate\s+(?:readonly\s+)?)([A-Za-z_]\w*)/g)].map((m) => m[1]!)
  )
  for (const acceptanceId of acceptanceIds) {
    const clause = stepText(body, acceptanceId)
    for (const name of hidden) {
      // `#nextOrdinal` or `nextOrdinal` by name, or a multi-word name as its phrase ("next ordinal").
      const phrase = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
      if (
        clause.includes(`#${name}`) ||
        clause.includes(`\`${name}\``) ||
        (phrase.includes(' ') && clause.toLowerCase().includes(phrase))
      )
        found.push({
          code: 'SDD_V2_ACCEPTANCE_SUBJECT_UNOBSERVABLE',
          detail: `${acceptanceId}: ${name} is private to the declared interface`
        })
    }
  }
  // OD-34: a test file promised unchanged still asserts an export this leaf removes.
  const removed = requirements.flatMap((r) => {
    const clause = stepText(body, String(r.id))
    if (!EXPORT.test(clause)) return []
    // Removing private helpers changes no export a test could assert.
    return [...clause.matchAll(REMOVES)].flatMap(([, span]) =>
      /private|internal|私有|内部/i.test(span!)
        ? []
        : [...span!.matchAll(/`([A-Za-z_]\w*)`/g)].map((m) => m[1]!)
    )
  })
  const kept = body
    .split('\n')
    .filter((line) => UNCHANGED.test(line) && !EXPORT_RULE.test(line))
    .flatMap((line) =>
      [...line.matchAll(/([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/g)].map((m) => m[1]!)
    )
  for (const file of new Set(
    owned().filter((f) => kept.some((named) => f === named || f.endsWith(`/${named}`)))
  ))
    for (const name of new Set(removed))
      if (new RegExp(`\\b${name}\\b`).test(read(join(repository!, file))))
        found.push({
          code: 'SDD_V2_REMOVED_EXPORT_ASSERTED_UNCHANGED',
          detail: `${file} asserts removed ${name} but is promised unchanged`
        })

  // OD-35: a must-ship case that holds before the change too needs `preserve`, not a fake failure.
  const preserve = new Set(list(index.preserve))
  for (const id of new Set(
    requirements.flatMap((r) => (r.kind === 'must-ship' ? list(r.acceptance).filter(text) : []))
  ))
    if (!preserve.has(id) && PRESERVED.test(stepText(body, id)))
      found.push({
        code: 'SDD_V2_ACCEPTANCE_BASELINE_UNFALSIFIABLE',
        detail: `${id}: holds before the change as well; list it in \`preserve\` or restate it as a change`
      })

  // OD-23: failure and concurrency clauses bind to acceptance, or say why they cannot.
  const failure = headingLines(
    body,
    /lifecycle|failure|error semantics|concurrency|生命周期|错误语义|并发/i
  )
  for (const clause of clauses(failure)) {
    const refs = [...clause.matchAll(/\b[A-Z]{1,2}\d+\b/g)].some((m) => known.has(m[0]))
    if (!refs && !/deferred|non-testable|不可测|延后/i.test(clause))
      found.push({ code: 'SDD_V2_FAILURE_CLAUSE_UNBOUND', detail: clause.trim().slice(0, 80) })
  }
  // OD-28: a compliance claim names the clauses it constrains.
  for (const clause of clauses(headingLines(body, /principle check|constitution check|原则检查/i)))
    if (COMPLIES.test(clause) && !CLAUSE_ID.test(clause))
      found.push({ code: 'SDD_V2_PRINCIPLE_CHECK_UNBOUND', detail: clause.trim().slice(0, 80) })
  for (const line of body.split('\n')) {
    if (CAUSE_OVERWRITE.test(line))
      found.push({ code: 'SDD_V2_CAUSE_OVERWRITE_PRESCRIBED', detail: line.trim().slice(0, 80) })
    // OD-17 / OD-18: wide gates state their failure domain; budget gates their feasibility.
    if (RECURSIVE.test(line) && !DISPOSITION.test(line))
      found.push({ code: 'SDD_V2_REPO_GATE_NO_DISPOSITION', detail: line.trim().slice(0, 80) })
    if (BUDGET.test(line) && !FEASIBLE.test(line))
      found.push({ code: 'SDD_V2_BUDGET_GATE_UNOWNED', detail: line.trim().slice(0, 80) })
    // OD-105: a shared lock or window is one checked tool, not a protocol each thread re-implements.
    if (COORDINATION.test(line) && !SCRIPTED.test(line))
      found.push({ code: 'SDD_V2_ORACLE_PROCEDURE_UNSCRIPTED', detail: line.trim().slice(0, 80) })
    // OD-106: an absolute budget misses a regression that stays under it; compare with a baseline.
    if (PERF.test(line) && !REGRESSION_GUARD.test(line))
      found.push({ code: 'SDD_V2_PERF_BASELINE_UNGUARDED', detail: line.trim().slice(0, 80) })
  }
  return found
}
