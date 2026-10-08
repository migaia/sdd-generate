/**
 * Detector for OD-14: does a `validate` run's telemetry line carry what the run reported?
 *
 * The defect lives on the recording side, not in validate's output, so an ordinary detector that
 * reads the output cannot see it. This probe runs the real `scripts/validate.ts` with telemetry
 * enabled, reads the line it appended, restores the ledger byte for byte, and reports one code when
 * the line carries every code the run reported in the inspected place:
 *
 *   candidates  candidates[].code (handoff.candidates before OD-108)  must appear in the line's
 *               candidate_codes
 *   closure     closure.findings[].code    must appear in the line's codes
 *
 * Usage: bun cases/fixtures/rsi-telemetry-probe.ts <candidates|closure> <fixture> <repository>
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Skill root, two levels above this fixture. */
const ROOT = join(import.meta.dir, '..', '..')
/** The local, git-ignored ledger `record()` appends to. */
const LEDGER = join(ROOT, 'rsi', 'telemetry.jsonl')

const [mode, fixture, repository] = Bun.argv.slice(2)
if ((mode !== 'candidates' && mode !== 'closure') || !fixture || !repository) {
  console.error('usage: rsi-telemetry-probe.ts <candidates|closure> <fixture> <repository>')
  process.exit(2)
}

/** validate arguments for the inspected channel. */
const args =
  mode === 'closure'
    ? ['validate', '--sdd', fixture, '--evidence', join(repository, 'evidence.json')]
    : ['validate', '--sdd', fixture, '--repository', repository]

/** Ledger bytes before the run, or null when no ledger exists yet. */
const before = existsSync(LEDGER) ? readFileSync(LEDGER) : null
/** Parsed validate output. */
let output: {
  candidates?: { code?: string }[]
  handoff?: { candidates?: { code?: string }[] }
  closure?: { findings?: { code?: string }[] }
} = {}
/** The telemetry line this run appended, if any. */
let recorded: { codes?: string[]; candidate_codes?: string[] } | undefined
try {
  // The suite disables telemetry for every detector; this probe needs it on for its own child, and
  // `bun test` would disable it again through NODE_ENV.
  const env = { ...process.env }
  delete env.CREATE_SDD_TELEMETRY
  delete env.NODE_ENV
  const run = Bun.spawnSync([process.execPath, join(ROOT, 'scripts', 'validate.ts'), ...args], {
    cwd: ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const text = run.stdout.toString()
  output = JSON.parse(text.slice(text.indexOf('{')))
  const after = existsSync(LEDGER) ? readFileSync(LEDGER) : Buffer.alloc(0)
  const appended = after
    .subarray(before ? before.length : 0)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
  recorded = appended.length ? JSON.parse(appended.at(-1)!) : undefined
} finally {
  // A fixture run is not an observation of the corpus; leave the ledger exactly as it was.
  if (before) writeFileSync(LEDGER, before)
  else rmSync(LEDGER, { force: true })
}

/** Codes the run reported in the inspected place. */
const reported = (
  mode === 'closure'
    ? (output.closure?.findings ?? [])
    : (output.candidates ?? output.handoff?.candidates ?? [])
)
  .map((item) => item.code)
  .filter((code): code is string => typeof code === 'string')
/** Codes the telemetry line kept for that place. */
const kept = (mode === 'closure' ? recorded?.codes : recorded?.candidate_codes) ?? []
/** Whether every reported code reached the ledger. */
const carried = reported.length > 0 && reported.every((code) => kept.includes(code))

console.log(
  JSON.stringify({
    protocol: 'rsi-telemetry-probe/v1',
    diagnostics: carried
      ? [
          {
            code:
              mode === 'closure'
                ? 'RSI_TELEMETRY_CLOSURE_RECORDED'
                : 'RSI_TELEMETRY_CANDIDATES_RECORDED'
          }
        ]
      : []
  })
)
