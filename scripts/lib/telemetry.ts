/**
 * Local record of which rule fired, so pruning can be decided from evidence instead of taste.
 *
 * This skill's own first invariant says to correct violations at their cause rather than adding
 * incident-specific clauses, yet its history is thirteen commits of +14000/-730: rules only ever
 * arrive. Nothing could say otherwise, because nothing measured which rule had ever caught anything.
 * This file supplies rule-health observations; pruning still needs concrete per-rule evidence.
 *
 * What is written: a run id, a timestamp, the tool, a digest of the document, and the codes that
 * fired. What is never written: the document, its path, its contents, or anything about the author.
 * The local file is ignored by Git and nothing sends it anywhere. RSI aggregates entries by the
 * document digest, so rechecking one revision does not create another debt observation. Set
 * `CREATE_SDD_TELEMETRY=0` to disable it; checks behave identically either way.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = join(import.meta.dir, '..', '..')
export const TELEMETRY_FILE = join(ROOT, 'rsi', 'telemetry.jsonl')

export type TelemetryEntry = Readonly<{
  run_id: string
  ts: string
  tool: string
  sdd_sha: string
  codes: readonly string[]
  candidate_codes: readonly string[]
  /** Per-lens dispositions of a recorded pre-handoff review, when the document records one. */
  review?: Readonly<Record<string, Readonly<Record<string, number>>>>
}>

/** One id per process, so several checks over one document group into a single observation. */
const RUN_ID = createHash('sha256')
  .update(`${process.pid}:${Date.now()}:${Math.random()}`)
  .digest('hex')
  .slice(0, 12)

/** Identify a document by content, never by path: the path can name a private tree. */
export function documentDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/**
 * Append one observation.
 *
 * Failures are swallowed on purpose and this is the only place in the skill where that is correct:
 * a measurement that can break a check would make the check less trustworthy than not measuring.
 */
export function record(entry: {
  readonly tool: string
  readonly sddSha: string
  readonly codes: readonly string[]
  readonly candidateCodes?: readonly string[]
  readonly review?: Readonly<Record<string, Readonly<Record<string, number>>>>
}): void {
  // `bun test` sets NODE_ENV=test and child checks inherit it. Without this, the skill's own test
  // suite filled the ledger with fixture runs, and a dormancy window of fifty runs measured nothing
  // but fixtures.
  if (process.env.CREATE_SDD_TELEMETRY === '0' || process.env.NODE_ENV === 'test') return
  try {
    mkdirSync(dirname(TELEMETRY_FILE), { recursive: true })
    const line: TelemetryEntry = {
      run_id: RUN_ID,
      ts: new Date().toISOString(),
      tool: entry.tool,
      sdd_sha: entry.sddSha,
      codes: [...new Set(entry.codes)].sort(),
      candidate_codes: [...new Set(entry.candidateCodes ?? [])].sort(),
      ...(entry.review ? { review: entry.review } : {})
    }
    appendFileSync(TELEMETRY_FILE, `${JSON.stringify(line)}\n`)
  } catch {
    // A missing measurement is a gap in the ledger; a thrown one would be a defect in the gate.
  }
}

/** Read the ledger back, tolerating a partially written trailing line. */
export function readTelemetry(file = TELEMETRY_FILE): readonly TelemetryEntry[] {
  try {
    const text = require('node:fs').readFileSync(file, 'utf8') as string
    const entries: TelemetryEntry[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as TelemetryEntry)
      } catch {
        // A truncated last line is expected after an interrupted run; earlier lines stay usable.
      }
    }
    return entries
  } catch {
    return []
  }
}
