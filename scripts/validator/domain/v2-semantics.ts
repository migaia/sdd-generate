import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { list, object, text, type Item, type Report } from './v2-meta.ts'
import { sourceCorpus, stepText } from './v2-symbols.ts'

type Doc = Readonly<{ id: string; path: string; body: string; index: Item }>
type Candidate = { code: string; detail: string }

/**
 * The fingerprint of an export's semantics: each listed clause's prose (its anchor line and what
 * follows it), whitespace collapsed, hashed together. A producer that edits a listed clause changes
 * it, so the recorded fingerprint and every consumer pin show the edit.
 */
export function fingerprint(body: string, clauses: readonly string[]): string {
  const texts = clauses.map((id) => stepText(body, id).split(/\s+/).join(' ').trim())
  return createHash('sha256').update(texts.join('\n')).digest('hex').slice(0, 12)
}

/** Leaves by ID, and one leaf's export entry by document and export ID. */
function lookup(leaves: readonly Doc[]) {
  const byId = new Map(leaves.map((leaf) => [leaf.id, leaf]))
  const exportOf = (document: unknown, id: unknown) =>
    list(byId.get(String(document))?.index.exports).find(
      (value): value is Item => object(value) && value.id === id
    )
  return { byId, exportOf }
}

/** Names a producer's delivered file exports: the symbols a consumer could restate. */
function exportedNames(repository: string | null, path: unknown): string[] {
  if (!repository || !text(path) || !existsSync(join(repository, path))) return []
  const source = readFileSync(join(repository, path), 'utf8')
  const pattern = /export\s+(?:async\s+)?(?:function|const|let|class|type|interface)\s+(\w+)/g
  return [...source.matchAll(pattern)].map((match) => match[1]!)
}

/**
 * OD-37: the producer is the single source of the semantics it exports.
 * - An export may list `semantics` (clause IDs in the producer) and must then record their
 *   `fingerprint`; an edit to a listed clause without a new fingerprint (and version) is stale.
 * - A consumer of such an export pins the fingerprint; a pin that differs is stale.
 * - `relies_on` ({acceptance: [{document, export, clause}]}) cites the producer clauses an
 *   acceptance exercises; a consumer acceptance that names a producer symbol without a citation,
 *   or a root integration acceptance that names a child's symbol without citing child acceptances,
 *   is a restatement candidate: the case should assert the consumer's own effects and cite the rule.
 */
export function checkSemantics(
  leaves: readonly Doc[],
  root: Doc | null,
  assets: ReadonlyMap<string, unknown>,
  repository: string | null,
  report: Report
): Candidate[] {
  const { byId, exportOf } = lookup(leaves)
  const current = new Map<string, string>()
  for (const leaf of leaves)
    for (const value of list(leaf.index.exports)) {
      if (!object(value) || value.semantics === undefined) continue
      const clauses = list(value.semantics).filter(text)
      const owned = new Set([
        ...list(leaf.index.requirements).map((r) => (object(r) ? r.id : r)),
        ...list(leaf.index.acceptance)
      ])
      for (const clause of clauses)
        if (!owned.has(clause))
          report(
            'SDD_V2_REFERENCE_MISSING',
            `${leaf.path}: ${String(value.id)} -> ${clause}`,
            'semantics-clause-missing'
          )
      const now = fingerprint(leaf.body, clauses)
      current.set(`${leaf.id}/${String(value.id)}`, now)
      if (!text(value.fingerprint))
        report(
          'SDD_V2_REQUIRED_FIELD_EMPTY',
          `${leaf.path}: ${String(value.id)} fingerprint ${now}`,
          'export-fingerprint-required'
        )
      else if (value.fingerprint !== now)
        report(
          'SDD_V2_EXPORT_FINGERPRINT_STALE',
          `${leaf.path}: ${String(value.id)}@${String(value.version)} records ${value.fingerprint}, its clauses now hash to ${now}; bump the version and fingerprint`
        )
    }
  const candidates: Candidate[] = []
  for (const leaf of leaves) {
    const consumed = list(leaf.index.consumes).filter(object)
    for (const pin of consumed) {
      const now = current.get(`${String(pin.document)}/${String(pin.export)}`)
      if (now && pin.fingerprint !== now)
        report(
          'SDD_V2_INTERFACE_MISMATCH',
          `${leaf.path}: ${String(pin.document)}/${String(pin.export)} pinned ${String(pin.fingerprint)}, producer is ${now}`,
          'consumer-pin-stale'
        )
    }
    const cites = object(leaf.index.relies_on) ? leaf.index.relies_on : {}
    for (const [id, refs] of Object.entries(cites))
      for (const ref of list(refs)) {
        const known =
          object(ref) &&
          list(leaf.index.acceptance).includes(id) &&
          consumed.some((pin) => pin.document === ref.document && pin.export === ref.export) &&
          list(exportOf(ref.document, ref.export)?.semantics).includes(ref.clause)
        if (!known)
          report(
            'SDD_V2_REFERENCE_MISSING',
            `${leaf.path}: ${id} -> ${JSON.stringify(ref)}`,
            'relies-on-invalid'
          )
      }
    const symbols = consumed.flatMap((pin) =>
      exportedNames(repository, assets.get(String(exportOf(pin.document, pin.export)?.asset))).map(
        (name) => ({ name, from: `${String(pin.document)}/${String(pin.export)}` })
      )
    )
    for (const id of list(leaf.index.acceptance).filter(text)) {
      if (cites[id] !== undefined) continue
      const line = stepText(leaf.body, id)
      for (const { name, from } of symbols)
        if (new RegExp(`\\b${name}\\b`).test(line))
          candidates.push({
            code: 'SDD_V2_PRODUCER_SEMANTICS_RESTATED',
            detail: `${leaf.id} ${id} names ${name} from ${from}; cite the producer clause in relies_on and assert only this document's effects`
          })
    }
  }
  if (root) {
    const cites = object(root.index.relies_on) ? root.index.relies_on : {}
    for (const [id, refs] of Object.entries(cites))
      for (const ref of list(refs))
        if (
          !object(ref) ||
          !list(byId.get(String(ref.document))?.index.acceptance).includes(ref.acceptance)
        )
          report(
            'SDD_V2_REFERENCE_MISSING',
            `${root.path}: ${id} -> ${JSON.stringify(ref)}`,
            'relies-on-invalid'
          )
    const symbols = leaves.flatMap((leaf) =>
      list(leaf.index.exports).flatMap((value) =>
        object(value)
          ? exportedNames(repository, assets.get(String(value.asset))).map((name) => ({
              name,
              from: leaf.id
            }))
          : []
      )
    )
    const integration = object(root.index.integration)
      ? list(root.index.integration.acceptance)
      : []
    for (const id of integration.filter(text)) {
      if (cites[id] !== undefined) continue
      const line = stepText(root.body, id)
      for (const { name, from } of symbols)
        if (new RegExp(`\\b${name}\\b`).test(line))
          candidates.push({
            code: 'SDD_V2_ROOT_RESTATES_CHILD',
            detail: `${id} names ${name} from ${from}; cite the child acceptance in relies_on instead of restating it`
          })
    }
  }
  return candidates
}

/** A delta row: the consumer's prior behaviour is kept, changed by a registered BC, or guarded. */
const DELTA = /^(?:identical|BC\d+[a-z]?|guarded:\S+)$/
/** An error disposition: the producer's error reaches the caller, is wrapped, or cannot occur. */
const DISPOSITION = /^(?:propagate|unreachable|wrap:[A-Z][A-Z0-9_]*)$/
/**
 * A blanket preservation claim against a named earlier revision ("same as R2", "与 R2 相同").
 * A bare "unchanged" is a local assertion, not a claim about a prior revision, and is not matched.
 */
/** A version token after an export name: `v2`, `version 2`, `版本 2`. */
const VERSION_AFTER = /^[^|\n]{0,30}?(?:\bv|\bversion\s*|版本\s*)(\d+)\b/i
/** A phrase that talks about an earlier version on purpose ("revision 5 及之前为版本 1", "formerly"). */
const HISTORICAL = /及之前|此前|以前|旧版|formerly|previously|before revision|until revision/i

/**
 * OD-56: an export version restated in prose (a leaf header, a root table row, plan text) that
 * differs from the producer's current `exports[].version`. The contract JSON is the authority; a
 * stale prose copy reads as a producer/consumer conflict to the host. A parenthetical or clause
 * that names an earlier version on purpose is skipped.
 */
export function exportVersionCandidates(
  documents: readonly Doc[],
  withoutHistory: (body: string) => string
): Candidate[] {
  const versions = new Map<string, string>()
  for (const doc of documents)
    for (const value of list(doc.index.exports))
      if (object(value) && text(value.id) && value.version !== undefined)
        versions.set(value.id, String(value.version))
  const found: Candidate[] = []
  for (const doc of documents)
    for (const line of withoutHistory(doc.body).split('\n'))
      for (const segment of line.split(/[()（）;；。]/)) {
        if (HISTORICAL.test(segment)) continue
        for (const [id, version] of versions) {
          const name = new RegExp(`(?<![\\w-])\`?${id.replace(/[-]/g, '\\-')}\`?(?![\\w-])`, 'g')
          for (const match of segment.matchAll(name)) {
            const rest = segment.slice(match.index! + match[0].length)
            const stated =
              VERSION_AFTER.exec(rest)?.[1] ??
              (line.trimStart().startsWith('|')
                ? rest
                    .split('|')
                    .map((cell) => /^\s*v?(\d+)\s*$/i.exec(cell)?.[1])
                    .find(Boolean)
                : undefined)
            if (stated && stated !== version)
              found.push({
                code: 'SDD_V2_EXPORT_VERSION_PROSE_STALE',
                detail: `${doc.id} says ${id} version ${stated} ("${segment.trim().slice(0, 80)}"); the producer exports version ${version}: point to the contract instead of restating it, or update the prose`
              })
          }
        }
      }
  return found
}

export const PRESERVATION =
  /(?:same as|unchanged (?:from|since)|identical to)\s+R\d+|与\s*R\d+\s*(?:相同|一致)|R\d+\s*(?:的)?(?:行为)?(?:不变|相同)/i
/** The line's own anchor ID (`- R7 …`), which is not a revision reference. */
const ANCHOR = /^\s*(?:#{1,6}\s+|[-*]\s+|\|\s*)\S+\s+/

/**
 * OD-38: a consumer surface delegated to a consumed export changes whatever the producer's rules
 * change. `delegations` ({clause: {document, export, delta, errors}}) records, for the clause that
 * hands the surface over, one delta row per rule in the export's `semantics` and one disposition
 * per error the export declares; a missing row blocks. Candidates flag a clause that calls an
 * export's symbol without a delegation, a preservation claim ("same as R2 except BC3") whose
 * exception set misses a non-identical delta, and a code in the consumer's `error_registry` that
 * nothing under its writes throws and no BC removes.
 */
export function checkDelegations(
  leaves: readonly Doc[],
  assets: ReadonlyMap<string, unknown>,
  repository: string | null,
  report: Report
): Candidate[] {
  const { exportOf } = lookup(leaves)
  const candidates: Candidate[] = []
  for (const leaf of leaves) {
    const consumed = list(leaf.index.consumes).filter(object)
    const delegations = object(leaf.index.delegations) ? leaf.index.delegations : {}
    const deltas: string[] = []
    for (const [clause, raw] of Object.entries(delegations)) {
      const at = `${leaf.path}: ${clause}`
      const exp = object(raw) ? exportOf(raw.document, raw.export) : undefined
      if (
        !object(raw) ||
        !exp ||
        !consumed.some((p) => p.document === raw.document && p.export === raw.export)
      ) {
        report('SDD_V2_REFERENCE_MISSING', at, 'delegation-export-missing')
        continue
      }
      const delta = object(raw.delta) ? raw.delta : {}
      for (const rule of list(exp.semantics).filter(text)) {
        const value = delta[rule]
        if (!text(value) || !DELTA.test(value))
          report(
            'SDD_V2_DELEGATION_INCOMPLETE',
            `${at} -> ${rule}: identical, BC<n> or guarded:<clause>`,
            'delta-missing'
          )
        else if (value !== 'identical') deltas.push(value)
      }
      const errors = object(raw.errors) ? raw.errors : {}
      for (const code of list(exp.errors).filter(text))
        if (!text(errors[code]) || !DISPOSITION.test(errors[code] as string))
          report(
            'SDD_V2_DELEGATION_INCOMPLETE',
            `${at} -> ${code}: propagate, wrap:<CODE> or unreachable`,
            'error-disposition-missing'
          )
    }
    const symbols = consumed.flatMap((pin) =>
      exportedNames(repository, assets.get(String(exportOf(pin.document, pin.export)?.asset))).map(
        (name) => ({ name, from: `${String(pin.document)}/${String(pin.export)}` })
      )
    )
    const clauses = [
      ...list(leaf.index.steps).map((s) => (object(s) ? s.id : s)),
      ...list(leaf.index.requirements).map((r) => (object(r) ? r.id : r))
    ].filter(text)
    for (const id of clauses) {
      if (delegations[id] !== undefined) continue
      const line = stepText(leaf.body, id)
      for (const { name, from } of symbols)
        if (new RegExp(`\\b${name}\\b`).test(line))
          candidates.push({
            code: 'SDD_V2_DELEGATION_UNDECLARED',
            detail: `${leaf.id} ${id} hands behaviour to ${name} from ${from}; declare it in delegations with a delta per rule`
          })
    }
    const semantic = consumed.some(
      (pin) => list(exportOf(pin.document, pin.export)?.semantics).length
    )
    if (semantic)
      for (const line of leaf.body
        .split('\n')
        .filter((l) => PRESERVATION.test(l.replace(ANCHOR, '')))) {
        const excepted = new Set(line.match(/BC\d+[a-z]?/g) ?? [])
        const missing = Object.keys(delegations).length
          ? deltas.filter((d) => !excepted.has(d))
          : ['no delegation delta declared']
        if (missing.length)
          candidates.push({
            code: 'SDD_V2_PRESERVATION_CLAIM_UNCHECKED',
            detail: `${leaf.id} claims preserved behaviour ("${line.trim().slice(0, 80)}") but the delegation changes it: ${missing.join(', ')}`
          })
      }
    const registry = leaf.index.error_registry
    if (registry !== undefined && repository && text(registry)) {
      if (!existsSync(join(repository, registry))) {
        report('SDD_V2_PATH_NOT_FOUND', `${leaf.path}: ${registry}`, 'error-registry-not-found')
        continue
      }
      const codes = [
        ...readFileSync(join(repository, registry), 'utf8').matchAll(/\b([A-Z][A-Z0-9_]{3,})\s*:/g)
      ].map((m) => m[1]!)
      const sources = sourceCorpus(repository, list(leaf.index.writes).filter(text), registry)
      for (const code of new Set(codes)) {
        const removed = leaf.body.split('\n').some((l) => l.includes(code) && /\bBC\d+/.test(l))
        if (!new RegExp(`\\b${code}\\b`).test(sources) && !removed)
          candidates.push({
            code: 'SDD_V2_ERROR_CODE_UNREACHABLE',
            detail: `${leaf.id} registers ${code} in ${registry} but nothing under its writes throws it and no BC removes it`
          })
      }
    }
  }
  return candidates
}
