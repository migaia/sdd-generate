import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { reviewCandidates } from '../scripts/validator/domain/v2-review'
import { reviewLenses } from '../scripts/rsi'

const SDD = join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-review', 'feature.sdd.md')
const defined = (id: string) => ['R1', 'A1', 'S1'].includes(id)
const review = (dispositions: Record<string, string>, findings = 'findings.json') =>
  reviewCandidates({ review: { findings, dispositions } }, SDD, defined)

test('every finding needs a disposition; closed ones are counted per lens', () => {
  const open = review({ F1: 'fixed' })
  expect(open.candidates.map((c) => c.code)).toEqual(['SDD_V2_REVIEW_UNDISPOSED'])
  expect(open.summary).toEqual({
    L2: { fixed: 1, ruled_invalid: 0, out_of_scope: 0, open: 0 },
    L3: { fixed: 0, ruled_invalid: 0, out_of_scope: 0, open: 1 }
  })
  const closed = review({ F1: 'fixed', F2: 'ruled-invalid:S1 creates the file' })
  expect(closed.candidates).toEqual([])
  expect(review({ F1: 'fixed', F2: 'ruled-invalid' }).candidates).toHaveLength(1)
})

test('a missing findings file or an unknown clause is reported', () => {
  expect(review({}, 'absent.json').candidates.map((c) => c.code)).toEqual([
    'SDD_V2_REVIEW_FINDINGS_MISSING'
  ])
  const strict = reviewCandidates(
    { review: { findings: 'findings.json', dispositions: { F1: 'fixed', F2: 'fixed' } } },
    SDD,
    (id) => id !== 'S1'
  )
  expect(strict.candidates.map((c) => c.code)).toEqual(['SDD_V2_REVIEW_CLAUSE_UNKNOWN'])
  expect(reviewCandidates({}, SDD, defined)).toEqual({ candidates: [], summary: null })
})

test('lens precision counts the latest review of each revision once', () => {
  const entry = (sha: string, fixed: number, ruled: number) => ({
    run_id: 'r',
    ts: 't',
    tool: 'validate:validate',
    sdd_sha: sha,
    codes: [],
    candidate_codes: [],
    review: { L2: { fixed, ruled_invalid: ruled, out_of_scope: 0, open: 0 } }
  })
  const lenses = reviewLenses([entry('a', 1, 1), entry('a', 2, 1), entry('b', 1, 0)])
  expect(lenses.L2).toEqual({
    fixed: 3,
    ruled_invalid: 1,
    out_of_scope: 0,
    open: 0,
    precision: 0.75
  })
})
