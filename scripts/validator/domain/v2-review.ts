import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { list, object, text, type Item } from './v2-meta.ts'

type Candidate = { code: string; detail: string }
/** How an author closes one finding: fixed, ruled invalid with its reason, or out of scope. */
const DISPOSITION = /^(?:fixed|ruled-invalid:.+|out-of-scope)$/
/** Per-lens disposition counts, the review's own precision signal: fixed / (fixed + ruled-invalid). */
export type ReviewSummary = Record<
  string,
  { fixed: number; ruled_invalid: number; out_of_scope: number; open: number }
>

/** How many must-ship requirements make a review worth its cost without any other signal. */
const MUST_SHIP_THRESHOLD = 5

/**
 * The built-in assessment of whether a pre-handoff review earns its cost (100–250k tokens) when
 * none is recorded. It recommends one for the defect classes the review lenses were measured on:
 * a behaviour change (a `BC<n>` clause: other tests and clauses may still assert the old
 * behaviour), a consumed export (restated or contradicted producer semantics), or a design with
 * MUST_SHIP_THRESHOLD or more must-ship requirements. Advisory: skipping it is a reported choice.
 */
function recommendation(index: Item, body: string): Candidate[] {
  const reasons: string[] = []
  const changes = [...new Set(body.match(/^\s*[-*]\s+(BC\d+[a-z]?)\b/gm) ?? [])].map((line) =>
    line.replace(/^\s*[-*]\s+/, '')
  )
  if (changes.length) reasons.push(`behaviour change ${changes.join(', ')}`)
  if (list(index.consumes).length) reasons.push(`consumes ${list(index.consumes).length} export(s)`)
  const mustShip = list(index.requirements).filter(
    (r) => object(r) && r.kind === 'must-ship'
  ).length
  if (mustShip >= MUST_SHIP_THRESHOLD) reasons.push(`${mustShip} must-ship requirements`)
  return reasons.length
    ? [
        {
          code: 'SDD_V2_REVIEW_RECOMMENDED',
          detail: `${reasons.join('; ')}: run the pre-handoff review (references/review.md) and record it in review, or say in the report why it was skipped`
        }
      ]
    : []
}

/**
 * The recorded pre-handoff review (`references/review.md`): `index.review` names the reviewer's
 * `sdd-review-findings/v1` file, relative to the SDD, and the author's disposition for each finding
 * ID. Advisory only: a review is a reading aid, never a readiness gate. Reports a missing file, a
 * finding that cites a clause the document does not define, and a finding left without a disposition.
 */
export function reviewCandidates(
  index: Item,
  sdd: string,
  defined: (id: string) => boolean,
  body = ''
): { candidates: Candidate[]; summary: ReviewSummary | null } {
  const review = object(index.review) ? index.review : null
  if (!review || !text(review.findings))
    return { candidates: recommendation(index, body), summary: null }
  const file = resolve(dirname(sdd), review.findings)
  if (!existsSync(file))
    return {
      candidates: [
        {
          code: 'SDD_V2_REVIEW_FINDINGS_MISSING',
          detail: `review findings ${review.findings} not found`
        }
      ],
      summary: null
    }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    parsed = null
  }
  const findings = object(parsed) ? list(parsed.findings).filter(object) : []
  const dispositions = object(review.dispositions) ? review.dispositions : {}
  const candidates: Candidate[] = []
  const summary: ReviewSummary = {}
  for (const [at, finding] of findings.entries()) {
    const id = text(finding.id) ? finding.id : `F${at + 1}`
    const lens = text(finding.lens) ? finding.lens : 'unknown'
    const unknown = list(finding.clauses).filter((clause) => text(clause) && !defined(clause))
    if (unknown.length)
      candidates.push({
        code: 'SDD_V2_REVIEW_CLAUSE_UNKNOWN',
        detail: `${id} cites ${unknown.join(', ')}, which this document does not define`
      })
    const said = dispositions[id]
    const counts = (summary[lens] ??= { fixed: 0, ruled_invalid: 0, out_of_scope: 0, open: 0 })
    if (!text(said) || !DISPOSITION.test(said)) {
      counts.open += 1
      candidates.push({
        code: 'SDD_V2_REVIEW_UNDISPOSED',
        detail: `${id} (${lens}) needs fixed, ruled-invalid:<reason> or out-of-scope in review.dispositions`
      })
    } else if (said === 'fixed') counts.fixed += 1
    else if (said === 'out-of-scope') counts.out_of_scope += 1
    else counts.ruled_invalid += 1
  }
  return { candidates, summary }
}
