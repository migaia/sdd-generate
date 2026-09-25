import { readFileSync } from 'node:fs'
import { checkDocument } from '../domain/document-check'
import { validateAssessment } from '../domain/v2-assessment'
import { validateV2Document } from '../domain/v2-document'

export type DocumentCheckResult = Readonly<{
  sdd: string
  valid: boolean
  diagnostics: ReturnType<typeof checkDocument>
}>

/** A document that carries a contract block but not the sdd/v2 protocol (the retired v1 format). */
const LEGACY_CONTRACT = /<!--\s*sdd-(?:contract|program):start/

/** The diagnostic for a document this skill no longer validates. */
const unsupported = (sdd: string) => ({
  code: 'SDD_V1_UNSUPPORTED',
  line: 1,
  message: `${sdd} is not an sdd/v2 document; the sdd-loop-delivery/v1 format is retired. Rewrite it with init.ts --kind feature|bug|program and carry its IDs over`
})

/** Check a document that does not target implementation; an sdd/v2 document gets its own checks. */
export function documentCheck(sdd: string): DocumentCheckResult {
  const text = readFileSync(sdd, 'utf8')
  const v2 = validateAssessment(sdd, text) ?? validateV2Document(sdd, text)
  if (v2) return { sdd: v2.sdd, valid: v2.valid, diagnostics: v2.diagnostics }
  if (LEGACY_CONTRACT.test(text)) return { sdd, valid: false, diagnostics: [unsupported(sdd)] }
  const diagnostics = checkDocument(sdd)
  return { sdd, valid: diagnostics.length === 0, diagnostics }
}

/** One in-memory implementation backs both persisted and draft validation. */
function validateText(
  text: string,
  sdd: string,
  documents: readonly { path: string; content: string }[] = [],
  repository?: string
) {
  const v2 = validateAssessment(sdd, text) ?? validateV2Document(sdd, text, documents, repository)
  if (v2) return v2
  return { sdd, valid: false, diagnostics: [unsupported(sdd)] }
}

export function validateDocument(sdd: string, repository?: string) {
  return validateText(readFileSync(sdd, 'utf8'), sdd, [], repository)
}

/** File-backed draft validation shares the exact memory parser and never creates state. */
export function validateDraft(sdd: string, repository?: string) {
  return validateDraftText(readFileSync(sdd, 'utf8'), sdd, [], repository)
}

/** Validate candidate bytes without creating an SDD or sidecar. */
export function validateDraftText(
  text: string,
  source = '<stdin>',
  documents: readonly { path: string; content: string }[] = [],
  repository?: string
) {
  return {
    ...validateText(text, source, documents, repository),
    draft: true as const,
    persisted: false as const
  }
}

/** Suggest the next stable identifier without modifying the document. */
export function nextDocumentId(
  sdd: string,
  prefix: string
): Readonly<{ prefix: string; next: string }> {
  if (!/^[A-Z]{2}$/.test(prefix)) throw new Error('DOCUMENT_PREFIX_INVALID')
  const text = readFileSync(sdd, 'utf8')
  const values = [...text.matchAll(new RegExp(`\\b${prefix}([0-9]{2,4})\\b`, 'g'))].map((m) =>
    Number(m[1])
  )
  const next = (values.length ? Math.max(...values) + 1 : 1).toString().padStart(2, '0')
  if (next.length > 4) throw new Error('DOCUMENT_ID_EXHAUSTED')
  return { prefix, next: `${prefix}${next}` }
}
