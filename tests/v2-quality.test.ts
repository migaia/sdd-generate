import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contractBlock } from '../scripts/lib/contract-source'
import { prose } from '../scripts/validator/domain/v2-document'
import { qualityCandidates } from '../scripts/validator/domain/v2-quality'

const FIXTURES = join(import.meta.dir, '..', 'cases', 'fixtures')
const REPOSITORY = join(FIXTURES, 'v2-quality')

/** Quality codes reported for one fixture document, with the fixture repository attached. */
const codes = (name: string): string[] => {
  const text = readFileSync(join(FIXTURES, name), 'utf8')
  const index = contractBlock(text).value as Record<string, unknown>
  return qualityCandidates(index, prose(text, 'sdd-contract'), REPOSITORY).map((c) => c.code)
}

test('the repaired document reports no acceptance-quality finding', () => {
  expect(codes('v2-quality.md')).toEqual([])
})

test.each([
  ['od15', 'SDD_V2_NEGATIVE_SEARCH_GENERIC_TOKEN'],
  ['od16', 'SDD_V2_INDEX_ORACLE_DIRTY_TREE'],
  ['od17', 'SDD_V2_REPO_GATE_NO_DISPOSITION'],
  ['od18', 'SDD_V2_BUDGET_GATE_UNOWNED'],
  ['od19', 'SDD_V2_COUNT_ONLY_PRESERVATION'],
  ['od20', 'SDD_V2_SURFACE_INVENTORY_INCOMPLETE'],
  ['od21', 'SDD_V2_ORACLE_PROCEDURE_UNSCRIPTED'],
  ['od22', 'SDD_V2_REQUIREMENT_OUTCOME_UNCOVERED'],
  ['od23', 'SDD_V2_FAILURE_CLAUSE_UNBOUND'],
  ['od24', 'SDD_V2_QUANTIFIER_FIXTURE_UNDISCRIMINATING'],
  ['od25', 'SDD_V2_ORACLE_BELOW_BOUNDARY'],
  ['od26a', 'SDD_V2_INVARIANT_INVENTORY_MISSING'],
  ['od26b', 'SDD_V2_INVENTORY_ENTRY_UNCOVERED'],
  ['od27', 'SDD_V2_ERROR_POSITION_UNSTATED'],
  ['od28a', 'SDD_V2_PRINCIPLE_CHECK_UNBOUND'],
  ['od28b', 'SDD_V2_CAUSE_OVERWRITE_PRESCRIBED'],
  ['od105', 'SDD_V2_ORACLE_PROCEDURE_UNSCRIPTED'],
  ['od106', 'SDD_V2_PERF_BASELINE_UNGUARDED']
])('%s reports only %s', (variant, code) => {
  // One decisive change per variant must surface as exactly its own finding.
  expect(codes(`v2-quality-${variant}.md`)).toEqual([code])
})

test.each([
  ['od26c', ['SDD_V2_INVARIANT_INVENTORY_MISSING']],
  ['od26d', []],
  ['od25b', []],
  ['od31a', []],
  ['od31b', []],
  ['od33', ['SDD_V2_ACCEPTANCE_SUBJECT_UNOBSERVABLE']],
  ['od33.ok', []],
  ['od35', ['SDD_V2_ACCEPTANCE_BASELINE_UNFALSIFIABLE']],
  ['od35.ok', []]
])('review variant %s reports %j', (variant, expected) => {
  // An inventory shell does not silence the guard; a bare prohibition is not a state guard; a
  // test-support module under src does not put an oracle below its boundary.
  // OD-31: a backticked arrow chain and a 、-enumeration discriminate a quantifier. OD-33: an
  // acceptance naming a private member of the interface fence cannot be observed. OD-35: a golden
  // equivalence holds before the change too, so it is listed in `preserve`.
  expect(codes(`v2-quality-${variant}.md`)).toEqual(expected)
})

test('a published subpath counts as a boundary, an unpublished module does not', () => {
  const text = readFileSync(join(FIXTURES, 'v2-quality-od25.md'), 'utf8')
  const index = contractBlock(text).value as Record<string, unknown>
  const found = qualityCandidates(index, prose(text, 'sdd-contract'), REPOSITORY)
  expect(found[0]?.detail).toContain('../src/internal.ts')
  expect(qualityCandidates(index, prose(text, 'sdd-contract'), null)).toEqual([])
})

test('OD-34: a test promised unchanged may not assert an export the leaf removes', () => {
  const found = (name: string) => {
    const text = readFileSync(join(FIXTURES, name), 'utf8')
    const index = contractBlock(text).value as Record<string, unknown>
    return qualityCandidates(
      index,
      prose(text, 'sdd-contract'),
      join(FIXTURES, 'v2-removed-export')
    )
  }
  expect(found('v2-removed-export-unchanged.md')).toEqual([
    {
      code: 'SDD_V2_REMOVED_EXPORT_ASSERTED_UNCHANGED',
      detail: 'packages/pipe/test/signal.test.ts asserts removed runSync but is promised unchanged'
    }
  ])
  // An explicit rule for export assertions replaces the promise.
  expect(found('v2-removed-export-rewritten.md')).toEqual([])
})
