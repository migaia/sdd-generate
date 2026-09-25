import { existsSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, posix, resolve } from 'node:path'
import { contractBlock, programBlock, sectionText } from '../../lib/contract-source.ts'
import { repositoryRoot } from '../../facts/repository.ts'
import { documentSource } from '../resource/document-source.ts'
import { markdownProseLines } from '../utils/markdown-prose.ts'
import type { DocumentDiagnostic } from './document-check.ts'
import {
  checkV2MetaGraph,
  deriveLeafMetas,
  escape,
  layers,
  list,
  object,
  text as nonempty,
  type Item,
  pathForm,
  within,
  type ExecutionSlice,
  type Report
} from './v2-meta.ts'
import { ignoredInputCandidates, ownershipCandidates } from './v2-boundaries.ts'
import { forwardDependencyCandidates, readerCandidates } from './v2-readers.ts'
import { qualityCandidates } from './v2-quality.ts'
import { applyPreset, loadPreset } from './v2-preset.ts'
import { checkDelegations, checkSemantics, exportVersionCandidates } from './v2-semantics.ts'
import { reviewCandidates, type ReviewSummary } from './v2-review.ts'
import { listCandidates } from './v2-lists.ts'
import { checkPreflight, HOST_PROTOCOL } from './v2-preflight.ts'
import { checkSingleSource } from './v2-render.ts'
import { scopeCandidates } from './v2-scope.ts'
import { symbolCandidates } from './v2-symbols.ts'
import { ancestors, checkStepRecords, stepRecords } from './v2-tasks.ts'

type DraftDocument = Readonly<{ path: string; content: string }>
type Child = Readonly<{
  id: string
  path: string
  depends_on: readonly string[]
  available: boolean
}>
type Leaf = Readonly<{ id: string; path: string; text: string; index: Item }>
type Root = Readonly<{ path: string; text: string; index: Item }>

/** A leaf beyond either limit is split (OD-65 item 5): dense cross-references stop staying consistent. */
const LEAF_LINE_LIMIT = 800
const LEAF_STEP_LIMIT = 12
/** Keep machine fields to identity, paths, versions and relations; the Markdown body is normative. */
export type V2Handoff = Readonly<{
  protocol: 'create-sdd-handoff/v2'
  sdd: string
  repository: string | null
  maturity: 'BLOCKED' | 'AWAITING_USER' | 'STRUCTURALLY_READY'
  blockers: readonly string[]
  pending_user_decisions: readonly { id: string; path: string }[]
  evidence_limits: readonly string[]
  root: {
    path: string
    summary: string
    shared_constraints: string
    integration_acceptance?: string
  }
  available_documents: readonly Child[]
  selected_document: string | null
  direct_dependencies: readonly { id: string; path: string }[]
  selected_source_paths: readonly { step: string; path: string }[]
  execution_slice?: ExecutionSlice
  /** Whether single-document Metas were written, derived from the index, or both. */
  meta_source: 'declared' | 'derived' | 'mixed'
  /** Project principle files (constitution, AGENTS.md) the design records a check against. */
  principles: readonly string[]
  /** `bug` adds reproduction, root cause and regression acceptance to a feature SDD. */
  intent: 'feature' | 'bug'
  /** Acceptance cases that must fail before the fix and pass after it. */
  regression: readonly string[]
  /** The go assessment this SDD was seeded from, when it names one. */
  assessment: string | null
  /** Advisory findings that never block, such as step calls declared nowhere in owned source. */
  candidates: readonly { code: string; detail: string }[]
  /** Per-lens dispositions of the recorded pre-handoff review, when the leaf records one. */
  review?: ReviewSummary
  /** The repository preset applied, if any (`.create-sdd/preset.json`). */
  preset: string | null
  /** Program root only: child IDs in dependency layers. */
  parallel_children?: readonly (readonly string[])[]
  read_order: readonly string[]
}>

export type V2Result = Readonly<{
  sdd: string
  valid: boolean
  diagnostics: readonly DocumentDiagnostic[]
  handoff: V2Handoff
}>

/**
 * Count prose anchors so one index ID has exactly one normative source location.
 *
 * Headings and list items define; a table row whose first cell is the ID defines only when no
 * heading or list item does. That lets a traceability table repeat IDs defined elsewhere, while a
 * requirements table remains a valid (and single) definition.
 */
function definitionCount(text: string, id: string): number {
  const tail = `(?:\\*\\*)?${escape(id)}(?:\\*\\*)?(?=\\s|[:：|]|$)`
  const anchor = new RegExp(`^\\s*(?:#{1,6}\\s+|[-*]\\s+)${tail}`)
  const row = new RegExp(`^\\s*\\|\\s*${tail}`)
  let anchors = 0
  let rows = 0
  for (const line of markdownProseLines(text)) {
    if (anchor.test(line.text)) anchors++
    else if (row.test(line.text)) rows++
  }
  return anchors || rows
}

/** An index ID needs exactly one normative prose anchor; zero and several are both blockers. */
export function checkDefinition(
  text: string,
  id: string,
  location: string,
  report: Report
): boolean {
  const count = definitionCount(text, id)
  if (count === 0) report('SDD_V2_PROSE_DEFINITION_MISSING', location)
  else if (count > 1) report('SDD_V2_PROSE_DEFINITION_DUPLICATE', location)
  return count === 1
}

/** Body text of a heading named by `names` (alternatives), optionally numbered; empty when absent. */
export const section = (body: string, names: string): string =>
  sectionText(body, new RegExp(`^(?:\\d+(?:\\.\\d+)*\\s+)?(?:${names})\\s*$`, 'i')).trim()

/** Remove only the machine block, leaving every human clause for ID and summary checks. */
export function prose(text: string, marker: 'sdd-contract' | 'sdd-program'): string {
  return text.replace(
    new RegExp(`<!--\\s*${marker}:start\\s*-->[\\s\\S]*?<!--\\s*${marker}:end\\s*-->`),
    ''
  )
}

/**
 * A section that records past answers (the Clarifications log, revision history) rather than
 * current claims. Its heading level ends it: the section runs to the next heading at the same or a
 * higher level.
 */
const HISTORY_HEADING =
  /^(#{2,6})\s+(?:\d+(?:\.\d+)*\s+)?(?:Clarifications|澄清(?:记录)?|Revision history|Change log|修订记录|变更记录)\s*$/i

/**
 * OD-49: the prose that candidate heuristics read. History sections are blanked, not removed, so
 * line positions stay those of the document; definitions and required sections still read the full
 * body.
 */
export function withoutHistory(body: string): string {
  let depth = 0
  return body
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s/.exec(line)
      if (depth && heading && heading[1]!.length <= depth) depth = 0
      const history = depth ? null : HISTORY_HEADING.exec(line)
      if (history) depth = history[1]!.length
      return depth ? '' : line
    })
    .join('\n')
}

/** A compact root summary is copied from prose; its full constraints remain available by path. */
function rootPresentation(text: string): {
  summary: string
  shared_constraints: string
  integration_acceptance: string
} {
  const body = prose(text, 'sdd-program')
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? ''
  const goal = section(body, 'Goal|Objective|总目标|目标').split(/\n\s*\n/)[0]
  const firstParagraph = body
    .replace(/^#.*$/gm, '')
    .trim()
    .split(/\n\s*\n/)[0]
  const summary = [title, goal || firstParagraph || ''].filter(Boolean).join(' — ').slice(0, 600)
  const shared_constraints = section(body, 'Shared Constraints|共享约束')
  const integration_acceptance = section(body, 'Integration Acceptance|整体验收')
  return { summary, shared_constraints, integration_acceptance }
}

/**
 * A relative SDD path must name a Markdown file under the program directory or, when a repository
 * is resolved, anywhere inside it — the same bound the link and step-source checks use. Repositories
 * that keep each package's design in its own directory (`docs/<package>/`) put a program's children
 * beside the root rather than below it (OD-29).
 */
function childPath(
  root: string,
  raw: unknown,
  canonical: (path: string) => string,
  report: Report,
  repo: string | null
): string | null {
  if (!nonempty(raw) || isAbsolute(raw) || extname(raw).toLowerCase() !== '.md') {
    report('SDD_V2_PATH_INVALID', String(raw), 'child-path-invalid')
    return null
  }
  const base = canonical(dirname(root))
  const path = canonical(resolve(base, raw))
  if (!within(base, path) && !(repo && within(repo, path))) {
    report('SDD_V2_PATH_ESCAPE', raw, 'child-path-escape')
    return null
  }
  return path
}

/** `[NEEDS CLARIFICATION: D1 …]` or `[需澄清: D1 …]`; the first token names the decision. */
const CLARIFICATION = /\[(?:NEEDS CLARIFICATION|需澄清)(?:\s*[:：]\s*([^\s\]]+))?[^\]]*\]/g

/**
 * Checks shared by a leaf and a program root: open-question markers and project principles.
 *
 * A marker whose decision is not in `unresolved_user_decisions` would reach the host as settled
 * prose, so it blocks. `principles` names repository files (for example a spec-kit
 * `.specify/memory/constitution.md` or an `AGENTS.md`) the design was checked against; the body
 * must then record that check. Returns the principle paths to hand to the host.
 */
export function checkDocumentNotes(
  document: Readonly<{ path: string; text: string; index: Item }>,
  marker: 'sdd-contract' | 'sdd-program',
  repo: string | null,
  report: Report
): string[] {
  const body = prose(document.text, marker)
  const decisions = new Set(list(document.index.unresolved_user_decisions).filter(nonempty))
  for (const line of markdownProseLines(body))
    // An inline-code span shows the syntax; only a marker in running prose is an open question.
    for (const match of line.text.replace(/`[^`]*`/g, '').matchAll(CLARIFICATION))
      if (!match[1] || !decisions.has(match[1]))
        report('SDD_V2_CLARIFICATION_UNTRACKED', `${document.path}: ${match[0]}`)
  const principles = document.index.principles
  if (principles === undefined) return []
  if (!Array.isArray(principles) || principles.some((path) => !nonempty(path))) {
    report('SDD_V2_INDEX_SHAPE_INVALID', document.path, 'principles-invalid')
    return []
  }
  const paths: string[] = []
  for (const raw of principles as string[]) {
    if (!pathForm(raw)) {
      report('SDD_V2_PATH_INVALID', `${document.path}: ${raw}`, 'principle-path-invalid')
      continue
    }
    const path = repo ? resolve(repo, raw) : raw
    if (repo && !existsSync(path))
      report('SDD_V2_PATH_NOT_FOUND', `${document.path}: ${raw}`, 'principle-not-found')
    paths.push(path)
  }
  if (paths.length && !section(body, 'Principle Check|原则检查'))
    report('SDD_V2_SECTION_MISSING', document.path, 'principle-check-missing')
  return paths
}

/** Open user decisions block readiness; each needs one prose definition. */
export function checkDecisions(
  index: Item,
  path: string,
  body: string,
  pending: { id: string; path: string }[],
  report: Report
): void {
  if (
    index.unresolved_user_decisions !== undefined &&
    !Array.isArray(index.unresolved_user_decisions)
  )
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'decisions-invalid')
  for (const value of list(index.unresolved_user_decisions)) {
    if (!nonempty(value)) report('SDD_V2_INDEX_SHAPE_INVALID', path, 'decision-id-invalid')
    else {
      pending.push({ id: value, path })
      checkDefinition(body, value, `${path}: ${value}`, report)
    }
  }
}

/** Check a leaf's relation index and its prose anchors. */
function checkLeaf(
  leaf: Leaf,
  report: Report,
  pending: { id: string; path: string }[],
  repo: string | null,
  documentRoot: string,
  io: ReturnType<typeof documentSource>,
  sourcePaths: { owner: string; step: string; path: string }[]
): void {
  const { index, path, text } = leaf
  const body = prose(text, 'sdd-contract')
  const missing = (from: unknown, to: unknown, subtype: string) =>
    report('SDD_V2_REFERENCE_MISSING', `${path}: ${String(from)} -> ${String(to)}`, subtype)
  const externalSteps = new Map<string, string>()
  if (index.step_sources !== undefined && !Array.isArray(index.step_sources))
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'step-sources-invalid')
  for (const item of list(index.step_sources)) {
    if (path === '<stdin>') {
      report('SDD_V2_PATH_INVALID', path, 'step-source-path-required')
      continue
    }
    if (
      !object(item) ||
      !nonempty(item.step) ||
      !nonempty(item.path) ||
      isAbsolute(item.path) ||
      extname(item.path).toLowerCase() !== '.md' ||
      externalSteps.has(item.step)
    ) {
      report('SDD_V2_INDEX_SHAPE_INVALID', path, 'step-source-invalid')
      continue
    }
    const target = io.canonical(resolve(dirname(path), item.path))
    if (!within(documentRoot, target) && !(repo && within(repo, target))) {
      report('SDD_V2_PATH_ESCAPE', `${path}: ${item.path}`, 'step-source-escape')
      continue
    }
    if (!io.isFile(target)) {
      report('SDD_V2_PATH_NOT_FOUND', target, 'step-source-not-found')
      continue
    }
    externalSteps.set(item.step, target)
  }
  if (!nonempty(index.id) || !nonempty(index.revision))
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'id-revision-required')
  const { records: stepList, invalid: invalidSteps } = stepRecords(index)
  for (const value of invalidSteps)
    report('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${JSON.stringify(value)}`, 'step-record-invalid')
  const steps = stepList.map((record) => record.id)
  const acceptance = list(index.acceptance)
  const requirements = list(index.requirements)
  const writes = list(index.writes)
  if (
    !Array.isArray(index.steps) ||
    !Array.isArray(index.acceptance) ||
    !Array.isArray(index.requirements) ||
    !Array.isArray(index.writes)
  )
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'leaf-index-invalid')
  if (!requirements.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', path, 'requirements-required')
  const stepIds = new Set<string>()
  const acceptanceIds = new Set<string>()
  for (const [values, ids, kind] of [
    [steps, stepIds, 'STEP'],
    [acceptance, acceptanceIds, 'ACCEPTANCE']
  ] as const)
    for (const id of values) {
      if (!nonempty(id) || ids.has(id)) {
        if (kind === 'STEP')
          report('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${String(id)}`, 'step-id-invalid')
        else report('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${String(id)}`, 'acceptance-id-invalid')
      } else {
        ids.add(id)
        const source = kind === 'STEP' ? externalSteps.get(id) : undefined
        const sourceText = source ? io.read(source).toString('utf8') : body
        if (checkDefinition(sourceText, id, `${source ?? path}: ${id}`, report) && source)
          sourcePaths.push({ owner: leaf.id, step: id, path: source })
      }
    }
  for (const step of externalSteps.keys())
    if (!stepIds.has(step))
      report('SDD_V2_REFERENCE_MISSING', `${path}: ${step}`, 'step-source-unknown')
  const requirementIds = new Set<string>()
  for (const value of requirements) {
    if (
      !object(value) ||
      !nonempty(value.id) ||
      !['must-ship', 'should', 'non-goal'].includes(String(value.kind))
    ) {
      report('SDD_V2_INDEX_SHAPE_INVALID', path, 'requirement-invalid')
      continue
    }
    if (requirementIds.has(value.id))
      report('SDD_V2_ID_DUPLICATE', `${path}: ${value.id}`, 'requirement-duplicate')
    requirementIds.add(value.id)
    checkDefinition(body, value.id, `${path}: ${value.id}`, report)
    const implementation = list(value.implementation)
    const cases = list(value.acceptance)
    if (
      !Array.isArray(value.implementation) ||
      !Array.isArray(value.acceptance) ||
      (value.kind === 'must-ship' && (!implementation.length || !cases.length))
    )
      report('SDD_V2_MUST_SHIP_CHAIN_INCOMPLETE', `${path}: ${value.id}`)
    for (const id of implementation)
      if (!nonempty(id) || !stepIds.has(id)) missing(value.id, id, 'step-reference-missing')
    for (const id of cases)
      if (!nonempty(id) || !acceptanceIds.has(id))
        missing(value.id, id, 'acceptance-reference-missing')
  }
  const batches = list(index.batches)
  if (!Array.isArray(index.batches) || !batches.length)
    report('SDD_V2_REQUIRED_FIELD_EMPTY', path, 'batches-required')
  const batchIds = new Set<string>()
  const stepOwners = new Map<string, string>()
  for (const value of batches) {
    if (
      !object(value) ||
      !nonempty(value.id) ||
      !Array.isArray(value.steps) ||
      !value.steps.length ||
      !Array.isArray(value.requirements) ||
      !value.requirements.length ||
      (value.depends_on !== undefined && !Array.isArray(value.depends_on))
    ) {
      report('SDD_V2_INDEX_SHAPE_INVALID', path, 'batch-invalid')
      continue
    }
    if (batchIds.has(value.id))
      report('SDD_V2_ID_DUPLICATE', `${path}: ${value.id}`, 'batch-duplicate')
    batchIds.add(value.id)
    checkDefinition(body, value.id, `${path}: ${value.id}`, report)
    for (const id of value.steps) {
      if (!nonempty(id) || !stepIds.has(id)) missing(value.id, id, 'batch-step-missing')
      else if (stepOwners.has(id))
        report('SDD_V2_OWNER_CONFLICT', `${path}: ${id}`, 'step-owner-conflict')
      else stepOwners.set(id, value.id)
    }
    for (const id of value.requirements)
      if (!nonempty(id) || !requirementIds.has(id))
        missing(value.id, id, 'batch-requirement-missing')
  }
  for (const id of stepIds)
    if (!stepOwners.has(id))
      report('SDD_V2_COVERAGE_MISSING', `${path}: ${id}`, 'step-batch-missing')
  const byBatch = new Map(
    batches
      .filter((value): value is Item => object(value) && nonempty(value.id))
      .map((value) => [value.id as string, value])
  )
  for (const [id, batch] of byBatch)
    for (const dependency of list(batch.depends_on))
      if (!nonempty(dependency) || !byBatch.has(dependency) || dependency === id)
        missing(id, dependency, 'batch-dependency-invalid')
  const batchOrder = new Map(
    [...byBatch].map(([id, b]) => [id, new Set(list(b.depends_on).filter(nonempty))])
  )
  for (const [id, before] of ancestors(batchOrder))
    if (before.has(id))
      report('SDD_V2_DEPENDENCY_CYCLE', `${path}: ${id}`, 'batch-dependency-cycle')
  for (const value of requirements) {
    if (!object(value) || value.kind !== 'must-ship' || !nonempty(value.id)) continue
    for (const id of list(value.implementation)) {
      const owner = stepOwners.get(String(id))
      if (owner && !list(byBatch.get(owner)?.requirements).includes(value.id))
        report(
          'SDD_V2_MUST_SHIP_CHAIN_INCOMPLETE',
          `${path}: ${owner} -> ${value.id}`,
          'batch-requirement-link-missing'
        )
    }
  }
  checkStepRecords(path, index, stepList, report)
  checkDecisions(index, path, body, pending, report)
  // A bug fix must show the defect exists and is gone: reproduction, root cause, regression cases.
  if (index.intent !== undefined && index.intent !== 'feature' && index.intent !== 'bug')
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'intent-invalid')
  if (index.intent === 'bug') {
    if (!section(body, 'Reproduction|复现'))
      report('SDD_V2_SECTION_MISSING', path, 'reproduction-missing')
    if (!section(body, 'Root Cause|根因'))
      report('SDD_V2_SECTION_MISSING', path, 'root-cause-missing')
    if (!list(index.regression).length)
      report('SDD_V2_REQUIRED_FIELD_EMPTY', path, 'regression-required')
  }
  // Each declared oracle is the test that decides one acceptance case at convergence.
  if (index.oracles !== undefined && !object(index.oracles))
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'oracles-invalid')
  for (const [id, oracle] of Object.entries(object(index.oracles) ? index.oracles : {})) {
    if (!acceptanceIds.has(id)) missing('oracles', id, 'oracle-acceptance-missing')
    // A test path, or a bounded command: one package script and one observable (a path or text).
    const command =
      object(oracle) &&
      nonempty(oracle.script) &&
      /^[\w:.-]+$/.test(oracle.script) &&
      (nonempty(oracle.exists)
        ? pathForm(oracle.exists) && oracle.stdout === undefined
        : nonempty(oracle.stdout))
    if (!command && (!nonempty(oracle) || !pathForm(oracle)))
      report('SDD_V2_PATH_INVALID', `${path}: ${id} -> ${JSON.stringify(oracle)}`, 'oracle-invalid')
  }
  if (index.regression !== undefined && !Array.isArray(index.regression))
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'regression-invalid')
  for (const id of list(index.regression))
    if (!nonempty(id) || !acceptanceIds.has(id)) missing('regression', id, 'regression-missing')
  // A preserved case passes before and after by design (OD-35); a regression case must fail first.
  if (index.preserve !== undefined && !Array.isArray(index.preserve))
    report('SDD_V2_INDEX_SHAPE_INVALID', path, 'preserve-invalid')
  for (const id of list(index.preserve))
    if (!nonempty(id) || !acceptanceIds.has(id)) missing('preserve', id, 'preserve-missing')
    else if (list(index.regression).includes(id))
      report('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${id}`, 'preserve-regression-conflict')
  for (const field of ['exports', 'consumes'] as const)
    if (index[field] !== undefined && !Array.isArray(index[field]))
      report('SDD_V2_INDEX_SHAPE_INVALID', `${path}: ${field}`, 'interface-index-invalid')
  const exportIds = new Set<string>()
  for (const item of list(index.exports)) {
    if (!object(item) || !nonempty(item.id) || !nonempty(item.version) || !nonempty(item.asset))
      report('SDD_V2_INDEX_SHAPE_INVALID', path, 'export-invalid')
    else {
      if (exportIds.has(item.id))
        report('SDD_V2_ID_DUPLICATE', `${path}: ${item.id}`, 'export-duplicate')
      exportIds.add(item.id)
      checkDefinition(body, item.id, `${path}: ${item.id}`, report)
    }
  }
  for (const item of list(index.consumes))
    if (
      !object(item) ||
      !nonempty(item.document) ||
      !nonempty(item.export) ||
      !nonempty(item.version)
    )
      report('SDD_V2_INDEX_SHAPE_INVALID', path, 'consumer-invalid')
  if (!writes.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', path, 'write-scope-required')
}

/** Parse a new SDD once and return a compact, host-neutral handoff beside diagnostics. */
export function validateV2Document(
  sdd: string,
  text: string,
  documents: readonly DraftDocument[] = [],
  repository?: string
): V2Result | null {
  const contract = contractBlock(text)
  const program = programBlock(text)
  const leafV2 = contract.value?.protocol === 'sdd/v2'
  const rootV2 = program.value?.protocol === 'sdd-program/v2'
  if (!leafV2 && !rootV2) return null

  const diagnostics: DocumentDiagnostic[] = []
  const report: Report = (code, detail, subtype) =>
    diagnostics.push({ code, line: 1, message: subtype ? `${subtype}: ${detail}` : detail })
  const pending: { id: string; path: string }[] = []
  const io = documentSource(documents)
  const source = sdd === '<stdin>' ? sdd : io.canonical(sdd)
  // An explicit repository is a claim to verify. Without one, a git root found above the document
  // is used; finding none only narrows the checks and is reported as an evidence limit.
  let repo: string | null = null
  if (repository) {
    const explicit = io.canonical(repository)
    if (existsSync(explicit) && statSync(explicit).isDirectory()) repo = explicit
    else report('REPOSITORY_NOT_FOUND', repository)
  } else if (source !== '<stdin>') {
    const detected = repositoryRoot(dirname(source))
    if (existsSync(join(detected, '.git'))) repo = detected
  }
  if ((leafV2 && program.value) || (rootV2 && contract.value))
    report('SDD_V2_OWNER_CONFLICT', source, 'block-conflict')
  if (contract.error) report(contract.error, source)
  if (program.error) report(program.error, source)

  let root: Root | null = null
  let selected: Leaf | null = null
  if (rootV2) {
    root = { path: source, text, index: program.value! }
    if (source === '<stdin>') report('SDD_V2_PATH_INVALID', source, 'root-path-required')
  } else if (leafV2) {
    selected = { id: String(contract.value!.id ?? ''), path: source, text, index: contract.value! }
    const backlink = selected.index.root
    if (backlink !== undefined) {
      if (source === '<stdin>' || !nonempty(backlink) || isAbsolute(backlink))
        report('SDD_V2_PATH_INVALID', source, 'root-path-invalid')
      else {
        const rootPath = io.canonical(resolve(dirname(source), backlink))
        if (!io.isFile(rootPath)) report('SDD_V2_PATH_NOT_FOUND', rootPath, 'root-not-found')
        else {
          const rootText = io.read(rootPath).toString('utf8')
          const block = programBlock(rootText)
          if (block.error || block.value?.protocol !== 'sdd-program/v2')
            report('SDD_V2_PROGRAM_LINK_INVALID', rootPath, 'root-invalid')
          else root = { path: rootPath, text: rootText, index: block.value }
        }
      }
    }
  }

  const presentation = root
    ? rootPresentation(root.text)
    : {
        summary: /^#\s+(.+)$/m.exec(text)?.[1] ?? '',
        shared_constraints: '',
        integration_acceptance: ''
      }
  const leaves = new Map<string, Leaf>()
  const children: Child[] = []
  const sourcePaths: { owner: string; step: string; path: string }[] = []
  if (root) {
    if (!presentation.shared_constraints)
      report('SDD_V2_SECTION_MISSING', root.path, 'shared-constraints-missing')
    const index = root.index
    if (
      !nonempty(index.id) ||
      !nonempty(index.revision) ||
      !Array.isArray(index.children) ||
      !index.children.length
    )
      report('SDD_V2_INDEX_SHAPE_INVALID', root.path, 'program-index-invalid')
    const ids = new Set<string>()
    const paths = new Set<string>()
    for (const value of list(index.children)) {
      if (
        !object(value) ||
        !nonempty(value.id) ||
        !Array.isArray(value.depends_on) ||
        value.depends_on.some((id: unknown) => !nonempty(id))
      ) {
        report('SDD_V2_INDEX_SHAPE_INVALID', root.path, 'child-invalid')
        continue
      }
      if (ids.has(value.id)) report('SDD_V2_ID_DUPLICATE', value.id, 'child-id-duplicate')
      ids.add(value.id)
      const path = childPath(root.path, value.sdd, io.canonical, report, repo)
      if (!path) continue
      if (paths.has(path)) report('SDD_V2_ID_DUPLICATE', path, 'child-path-duplicate')
      paths.add(path)
      const available = io.isFile(path)
      children.push({ id: value.id, path, depends_on: value.depends_on as string[], available })
      if (!available) {
        report('SDD_V2_PATH_NOT_FOUND', path, 'child-not-found')
        continue
      }
      const childText = path === source ? text : io.read(path).toString('utf8')
      const block = path === source ? contract : contractBlock(childText)
      if (block.error || block.value?.protocol !== 'sdd/v2') {
        report('SDD_V2_PROGRAM_LINK_INVALID', path, 'child-contract-invalid')
        continue
      }
      const leaf = { id: value.id, path, text: childText, index: block.value }
      leaves.set(value.id, leaf)
      if (block.value.id !== value.id)
        report('SDD_V2_PROGRAM_LINK_INVALID', path, 'child-id-mismatch')
      const link = block.value.root
      if (
        !nonempty(link) ||
        isAbsolute(link) ||
        io.canonical(resolve(dirname(path), link)) !== root.path
      )
        report('SDD_V2_PROGRAM_LINK_INVALID', path, 'child-root-mismatch')
    }
    for (const child of children) {
      if (new Set(child.depends_on).size !== child.depends_on.length)
        report('SDD_V2_ID_DUPLICATE', child.id, 'dependency-duplicate')
      for (const dependency of child.depends_on)
        if (!ids.has(dependency) || dependency === child.id)
          report('SDD_V2_REFERENCE_MISSING', `${child.id} -> ${dependency}`, 'dependency-invalid')
    }
    const childOrder = new Map(children.map((c) => [c.id, new Set(c.depends_on)]))
    for (const [id, before] of ancestors(childOrder))
      if (before.has(id)) report('SDD_V2_DEPENDENCY_CYCLE', id)
    const integration = index.integration
    if (children.length > 1 && !object(integration))
      report('SDD_V2_INTEGRATION_OWNER_REQUIRED', root.path)
    if (integration !== undefined) {
      if (!presentation.integration_acceptance)
        report('SDD_V2_SECTION_MISSING', root.path, 'integration-acceptance-section-missing')
      if (
        !object(integration) ||
        !nonempty(integration.owner) ||
        !ids.has(integration.owner) ||
        !Array.isArray(integration.acceptance) ||
        !integration.acceptance.length
      )
        report('SDD_V2_INDEX_SHAPE_INVALID', root.path, 'integration-invalid')
      else {
        const steps = list(integration.implementation)
        if (
          !Array.isArray(integration.implementation) ||
          !steps.length ||
          steps.some((id) => !nonempty(id)) ||
          new Set(steps).size !== steps.length
        )
          report('SDD_V2_INDEX_SHAPE_INVALID', root.path, 'integration-implementation-invalid')
        const ownerIndex = leaves.get(integration.owner)?.index ?? {}
        const ownerSteps = new Set(stepRecords(ownerIndex).records.map((record) => record.id))
        for (const id of steps)
          if (nonempty(id) && !ownerSteps.has(id))
            report('SDD_V2_REFERENCE_MISSING', `${integration.owner}: ${id}`, 'integration-step')
        for (const id of integration.acceptance) {
          if (!nonempty(id))
            report(
              'SDD_V2_PROSE_DEFINITION_MISSING',
              `${root.path}: ${String(id)}`,
              'integration-acceptance-missing'
            )
          else
            checkDefinition(presentation.integration_acceptance, id, `${root.path}: ${id}`, report)
        }
      }
    }
    checkDecisions(index, root.path, prose(root.text, 'sdd-program'), pending, report)
  } else if (selected) {
    selected = { ...selected, id: 'self' }
    leaves.set('self', selected)
  }

  for (const leaf of leaves.values())
    checkLeaf(
      leaf,
      report,
      pending,
      repo,
      io.canonical(dirname(root?.path ?? leaf.path)),
      io,
      sourcePaths
    )
  if (root)
    for (const leaf of leaves.values())
      if (leaf.index.metas !== undefined)
        report('SDD_V2_OWNER_CONFLICT', leaf.path, 'meta-authority-conflict')
  if (root && selected && !children.some((child) => child.path === source))
    report('SDD_V2_PROGRAM_LINK_INVALID', source, 'child-not-indexed')

  const writes: { owner: string; path: string }[] = []
  const childById = new Map(children.map((child) => [child.id, child]))
  for (const leaf of leaves.values()) {
    for (const raw of list(leaf.index.writes)) {
      if (!nonempty(raw) || !pathForm(raw)) {
        report('SDD_V2_PATH_INVALID', `${leaf.path}: ${String(raw)}`, 'write-path-invalid')
        continue
      }
      const path = posix.normalize(raw)
      if (repo && !within(repo, io.canonical(resolve(repo, path)))) {
        report('SDD_V2_PATH_ESCAPE', `${leaf.path}: ${path}`, 'write-path-escape')
        continue
      }
      writes.push({ owner: leaf.id, path })
    }
    for (const item of list(leaf.index.consumes)) {
      if (!object(item) || !nonempty(item.document)) continue
      const producer = leaves.get(item.document)
      const exported = list(producer?.index.exports).find(
        (value) => object(value) && value.id === item.export
      )
      const problem = !childById.get(leaf.id)?.depends_on.includes(item.document)
        ? 'consumer-dependency-missing'
        : !producer
          ? 'consumer-producer-missing'
          : !object(exported) || exported.version !== item.version
            ? 'consumer-version-mismatch'
            : null
      if (problem)
        report(
          'SDD_V2_INTERFACE_MISMATCH',
          `${leaf.id}: ${item.document}/${String(item.export)}@${String(item.version)}`,
          problem
        )
    }
  }
  for (let left = 0; left < writes.length; left++)
    for (let right = left + 1; right < writes.length; right++) {
      const a = writes[left]!,
        b = writes[right]!
      if (a.owner === b.owner) continue
      if (a.path === b.path || a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`))
        report(
          'SDD_V2_OWNER_CONFLICT',
          `${a.owner}:${a.path}, ${b.owner}:${b.path}`,
          'write-owner-conflict'
        )
    }

  // A leaf may omit the Meta kinds its index already implies; a root may omit its children's (OD-32).
  const meta = root
    ? deriveLeafMetas(
        root.index,
        list(root.index.children).flatMap((child) => {
          if (!object(child) || !nonempty(child.sdd)) return []
          const leaf = leaves.get(String(child.id))
          return leaf ? [{ owner: leaf.id, document: child.sdd, index: leaf.index }] : []
        })
      )
    : deriveLeafMetas(selected?.index ?? {})
  const metaIndex = meta.index
  const metaBody = root ? prose(root.text, 'sdd-program') : prose(text, 'sdd-contract')
  for (const value of list(metaIndex.metas))
    if (
      object(value) &&
      value.kind === 'Entry' &&
      nonempty(value.id) &&
      !meta.derived.has(value.id)
    )
      checkDefinition(metaBody, value.id, `${root?.path ?? source}: ${value.id}`, report)
  const originTexts = new Map<string, string>()
  const originSource = (
    owner: string,
    document: string,
    requirementId: string,
    at: string
  ): string | null => {
    if (!root) {
      if (owner !== 'self' || document !== 'self' || !selected) {
        report('SDD_V2_PATH_INVALID', at, 'module-origin-document-invalid')
        return null
      }
      // checkLeaf already counted this document's anchors; only the origin's existence is new here.
      if (!definitionCount(prose(selected.text, 'sdd-contract'), requirementId))
        report('SDD_V2_PROSE_DEFINITION_MISSING', `${at}: ${requirementId}`, 'origin-id-missing')
      return selected.path
    }
    if (document === 'self' || isAbsolute(document) || extname(document).toLowerCase() !== '.md') {
      report('SDD_V2_PATH_INVALID', at, 'module-origin-document-invalid')
      return null
    }
    const target = io.canonical(resolve(dirname(root.path), document))
    if (!within(io.canonical(dirname(root.path)), target) && !(repo && within(repo, target))) {
      report('SDD_V2_PATH_ESCAPE', `${at}: ${document}`, 'module-origin-document-escape')
      return null
    }
    if (!io.isFile(target)) {
      report('SDD_V2_PATH_NOT_FOUND', `${at}: ${target}`, 'module-origin-document-not-found')
      return null
    }
    let body = originTexts.get(target)
    if (body === undefined) {
      body =
        target === root.path
          ? root.text
          : leaves.get(owner)?.path === target
            ? leaves.get(owner)!.text
            : io.read(target).toString('utf8')
      originTexts.set(target, body)
    }
    checkDefinition(body, requirementId, `${at}: ${target}#${requirementId}`, report)
    return target
  }
  const slices = checkV2MetaGraph(
    metaIndex,
    root?.path ?? null,
    leaves,
    children,
    repo,
    io.canonical,
    originSource,
    report
  )

  const principles = [
    ...(root ? checkDocumentNotes(root, 'sdd-program', repo, report) : []),
    ...[...leaves.values()].flatMap((leaf) => {
      const found = checkDocumentNotes(leaf, 'sdd-contract', repo, report)
      return !selected || leaf.path === source ? found : []
    })
  ]
  // Children in dependency layers: a layer may start once every earlier layer has delivered.
  const parallelChildren = layers(
    children.map((child) => child.id),
    (id) => (childById.get(id)?.depends_on ?? []).filter((dep) => childById.has(dep))
  )

  // A leaf seeded by an assessment cites it; the citation must resolve to a `go` decision.
  let assessment: string | null = null
  if (selected && selected.index.assessment !== undefined) {
    const raw = selected.index.assessment
    const linked =
      nonempty(raw) && !isAbsolute(raw) && source !== '<stdin>'
        ? io.canonical(resolve(dirname(source), raw))
        : null
    const block =
      linked && io.isFile(linked) ? contractBlock(io.read(linked).toString('utf8')) : null
    const decision = block?.value?.decision as Item | undefined
    if (block?.value?.protocol !== 'sdd-assessment/v1' || decision?.outcome !== 'go')
      report('SDD_V2_PROGRAM_LINK_INVALID', `${source}: ${String(raw)}`, 'assessment-link-invalid')
    else assessment = linked
  }
  const target = selected ? children.find((child) => child.path === source) : null
  const direct =
    target?.depends_on.flatMap((id) => {
      const dependency = childById.get(id)
      return dependency ? [{ id, path: dependency.path }] : []
    }) ?? []
  const selectedSourcePaths = selected
    ? sourcePaths
        .filter((item) => item.owner === selected.id)
        .map(({ step, path }) => ({ step, path }))
    : []
  const displayRoot = root ?? { path: source, text, index: contract.value ?? {} }
  // Advisory findings about the selected leaf; a repository preset may promote some to blockers.
  const selectedBody = selected ? prose(selected.text, 'sdd-contract') : ''
  const claimBody = withoutHistory(selectedBody)
  const reads = selected ? (slices.get(root ? selected.id : 'self')?.reads ?? []) : []
  const external = new Map(
    selectedSourcePaths.map(({ step, path }) => [step, io.read(path).toString('utf8')])
  )
  // The recorded pre-handoff review: its findings must cite real clauses and each needs a disposition.
  const review = selected
    ? reviewCandidates(
        selected.index,
        selected.path,
        (id) => definitionCount(selectedBody, id) > 0,
        claimBody
      )
    : { candidates: [], summary: null }
  const candidates = selected
    ? [
        ...review.candidates,
        ...symbolCandidates(selected.index, claimBody, repo, reads, external),
        ...ignoredInputCandidates(selected.index, claimBody, repo, reads),
        ...ownershipCandidates(selected.index, selected.path, selected.text, repo),
        ...forwardDependencyCandidates(selected.index, claimBody, external),
        ...readerCandidates(selected.index, claimBody, repo, reads),
        ...scopeCandidates(selected.index, claimBody),
        ...listCandidates(selected.index, claimBody, repo, selectedBody),
        ...qualityCandidates(selected.index, claimBody, repo)
      ]
    : []
  // OD-37: consumed semantics come from the producer, by fingerprint and citation, not restatement.
  const assetPaths = new Map(
    list(metaIndex.metas)
      .filter((m): m is Item => object(m) && m.kind === 'Asset')
      .map((m) => [String(m.id), m.path])
  )
  const semanticCandidates = checkSemantics(
    [...leaves].map(([id, leaf]) => ({
      id,
      path: leaf.path,
      body: prose(leaf.text, 'sdd-contract'),
      index: leaf.index
    })),
    root
      ? { id: 'root', path: root.path, body: prose(root.text, 'sdd-program'), index: root.index }
      : null,
    assetPaths,
    repo,
    report
  )
  const delegationCandidates = checkDelegations(
    [...leaves].map(([id, leaf]) => ({
      id,
      path: leaf.path,
      body: withoutHistory(prose(leaf.text, 'sdd-contract')),
      index: leaf.index
    })),
    assetPaths,
    repo,
    report
  )
  if (selected)
    candidates.push(...delegationCandidates.filter((c) => c.detail.startsWith(`${selected.id} `)))
  // OD-56: every document of the program is read, and each reports only its own stale copies.
  const versionCandidates = exportVersionCandidates(
    [
      ...[...leaves].map(([id, leaf]) => ({
        id,
        path: leaf.path,
        body: prose(leaf.text, 'sdd-contract'),
        index: leaf.index
      })),
      ...(root
        ? [
            {
              id: 'root',
              path: root.path,
              body: prose(root.text, 'sdd-program'),
              index: root.index
            }
          ]
        : [])
    ],
    withoutHistory
  )
  candidates.push(
    ...versionCandidates.filter((c) => c.detail.startsWith(`${selected ? selected.id : 'root'} `))
  )
  candidates.push(
    ...semanticCandidates.filter((c) =>
      selected
        ? c.code === 'SDD_V2_PRODUCER_SEMANTICS_RESTATED' && c.detail.startsWith(`${selected.id} `)
        : c.code === 'SDD_V2_ROOT_RESTATES_CHILD'
    )
  )
  // OD-65 items 1, 2 and 5: an executed preflight, one source per contract fact, and a leaf small
  // enough to stay self-consistent. All blocking: the leaf is not valid until they hold.
  const preflight = selected
    ? checkPreflight(
        selected.index,
        withoutHistory(selectedBody),
        selected.text,
        selected.path,
        report
      )
    : null
  if (selected) {
    checkSingleSource(
      selected.index,
      selected.text,
      withoutHistory(selectedBody),
      selected.path,
      report
    )
    const lines = selectedBody.split('\n').length
    const steps = list(selected.index.steps).length
    if (lines > LEAF_LINE_LIMIT || steps > LEAF_STEP_LIMIT)
      report(
        'SDD_V2_LEAF_TOO_LARGE',
        `${selected.path}: ${lines} prose lines, ${steps} steps (limit ${LEAF_LINE_LIMIT} lines or ${LEAF_STEP_LIMIT} steps): split it into a program of narrower leaves`
      )
  }
  const preset = loadPreset(repo, report)
  if (preset) {
    const document = selected ?? root!
    const body = selected ? selectedBody : prose(root!.text, 'sdd-program')
    const kind = !selected ? 'program' : selected.index.intent === 'bug' ? 'bug' : 'feature'
    applyPreset(
      preset,
      kind,
      document.index,
      (names) => !!section(body, names),
      candidates,
      document.path,
      report
    )
  }
  const blockers = diagnostics.map((item) => `${item.code}: ${item.message}`)
  const maturity = blockers.length
    ? 'BLOCKED'
    : pending.length
      ? 'AWAITING_USER'
      : 'STRUCTURALLY_READY'
  const evidence_limits = [
    'Structural and path checks do not establish semantic requirement coverage or design quality.',
    'Repository source claims and declared interfaces have not been verified against implementation.',
    'Implementation behavior and acceptance results have not been checked.',
    ...(repo
      ? []
      : ['Repository location is unverified; path escape and existence checks were skipped.'])
  ]
  const includeIntegration =
    !!root &&
    object(root.index.integration) &&
    (!selected || root.index.integration.owner === selected.id)
  return {
    sdd: source,
    valid: diagnostics.length === 0,
    diagnostics,
    handoff: {
      protocol: 'create-sdd-handoff/v2',
      sdd: source,
      repository: repo,
      maturity,
      blockers,
      pending_user_decisions: pending,
      evidence_limits,
      root: {
        path: displayRoot.path,
        summary: presentation.summary,
        shared_constraints: presentation.shared_constraints,
        ...(includeIntegration
          ? { integration_acceptance: presentation.integration_acceptance }
          : {})
      },
      available_documents: selected
        ? root
          ? children.filter(
              (child) =>
                child.path === source || direct.some((dependency) => dependency.id === child.id)
            )
          : [{ id: 'self', path: source, depends_on: [], available: true }]
        : children,
      selected_document: selected?.id ?? null,
      direct_dependencies: direct,
      selected_source_paths: selectedSourcePaths,
      ...(selected ? { execution_slice: slices.get(root ? selected.id : 'self') } : {}),
      meta_source: meta.source,
      candidates,
      ...(review.summary ? { review: review.summary } : {}),
      ...(preflight && preflight.status !== 'NOT_REQUIRED'
        ? { preflight: { ...preflight, host_protocol: HOST_PROTOCOL } }
        : {}),
      preset: preset?.path ?? null,
      intent: selected?.index.intent === 'bug' ? 'bug' : 'feature',
      regression: list(selected?.index.regression).filter(nonempty),
      assessment,
      principles,
      ...(root && !selected ? { parallel_children: parallelChildren } : {}),
      // Principles first: the host reads the rules the design was checked against.
      read_order: [
        ...(repo ? principles : []),
        ...(root && !selected ? [root.path] : [...direct.map((item) => item.path), source]),
        ...selectedSourcePaths.map((item) => item.path)
      ]
    }
  }
}
