import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateV2Document } from '../scripts/validator/domain/v2-document'
import { fingerprint } from '../scripts/validator/domain/v2-semantics'

const DIR = join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-consume')
const REPO = join(DIR, 'repo')
const check = (variant: string, file: string, text?: string) =>
  validateV2Document(
    join(DIR, variant, file),
    text ?? readFileSync(join(DIR, variant, file), 'utf8'),
    [],
    REPO
  )!

/** Diagnostics other than the preflight gate, which these fixtures do not run (see v2-preflight.test.ts). */
const structural = <T extends { code: string }>(result: { diagnostics: readonly T[] }) =>
  result.diagnostics.filter((d) => !d.code.startsWith('SDD_V2_PREFLIGHT_'))

/** Defect candidates only: a review recommendation is advice about cost, not a document defect. */
const defects = (result: { handoff: { candidates: readonly { code: string }[] } }) =>
  result.handoff.candidates.filter((c) => c.code !== 'SDD_V2_REVIEW_RECOMMENDED')

test('a program whose consumer and root cite the producer is clean', () => {
  for (const file of ['root.sdd.md', 'capability.sdd.md', 'host.sdd.md']) {
    const result = check('ok', file)
    expect(structural(result)).toEqual([])
    expect(defects(result)).toEqual([])
  }
})

test('the fingerprint follows the listed clauses and nothing else', () => {
  const body = '- R9 Rebind a direct dependent.\n- R10 Unrelated.\n'
  const before = fingerprint(body, ['R9'])
  expect(fingerprint(body.replace('Unrelated', 'Changed'), ['R9'])).toBe(before)
  expect(fingerprint(body.replace('Rebind', 'Restart'), ['R9'])).not.toBe(before)
  expect(fingerprint(body.replace('- R9 Rebind', '- R9   Rebind'), ['R9'])).toBe(before)
})

test('exports without a fingerprint, and citations of unknown clauses, are reported', () => {
  const producer = readFileSync(join(DIR, 'ok', 'capability.sdd.md'), 'utf8')
  const unpinned = producer.replace(/,\s*"fingerprint": "[0-9a-f]+"/, '')
  const missing = check('ok', 'capability.sdd.md', unpinned).diagnostics.map((d) => d.message)
  expect(missing.some((m) => m.startsWith('export-fingerprint-required'))).toBe(true)
  const consumer = readFileSync(join(DIR, 'ok', 'host.sdd.md'), 'utf8')
  const wrong = consumer.replace('"clause": "R9"', '"clause": "R7"')
  const found = check('ok', 'host.sdd.md', wrong).diagnostics.map((d) => d.message)
  expect(found.some((m) => m.startsWith('relies-on-invalid'))).toBe(true)
})

const DELEGATE = join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-delegate')
const delegate = (variant: string, text?: string) =>
  validateV2Document(
    join(DELEGATE, variant, 'host.sdd.md'),
    text ?? readFileSync(join(DELEGATE, variant, 'host.sdd.md'), 'utf8'),
    [],
    join(DELEGATE, 'repo')
  )!

test('a declared delegation with every delta and error disposition is clean', () => {
  const result = delegate('ok')
  expect(structural(result)).toEqual([])
  expect(defects(result)).toEqual([])
})

test('delegation gaps: error dispositions, and preservation claims in either language', () => {
  const ok = readFileSync(join(DELEGATE, 'ok', 'host.sdd.md'), 'utf8')
  const noErrors = ok.replace(/"errors": \{[^}]*\}/, '"errors": {}')
  expect(
    structural(delegate('ok', noErrors)).map(
      (d) => (d as { message: string }).message.split(':')[0]
    )
  ).toEqual(['error-disposition-missing'])
  const zh = ok.replace(
    'Except BC3 and BC4, pipeline behaviour for the four modes is the same as R2.',
    '除 BC3 外，四种 mode 的 pipeline 行为与 R2 相同。'
  )
  expect(defects(delegate('ok', zh)).map((c) => c.code)).toEqual([
    'SDD_V2_PRESERVATION_CLAIM_UNCHECKED'
  ])
  const local = ok.replace(
    'Except BC3 and BC4, pipeline behaviour for the four modes is the same as R2.',
    'Install counts stay unchanged for resumed stages.'
  )
  expect(defects(delegate('ok', local))).toEqual([])
})
