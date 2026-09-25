#!/usr/bin/env bun
import { join } from 'node:path'

/**
 * Aggregate automated checks for this skill. They prove structure only: that scripts type-check
 * and pass their tests, links resolve and behavior cases are
 * well formed. They do not prove that an authoring agent reads, understands or follows the rules.
 */
const ROOT = join(import.meta.dir, '..')

/** Every check this skill owns; the first failure ends the review with its output. */
const checks: readonly (readonly [name: string, argv: readonly string[]])[] = [
  ['tests', ['run', 'test']],
  ['format', ['run', 'format:check']],
  ['lint', ['run', 'lint']],
  ['typecheck', ['run', 'typecheck']],
  ['links', ['scripts/check-links.ts']],
  [
    'behavior-cases',
    ['scripts/behavior-eval.ts', '--suite', 'cases/behavior-cases.json', '--runs', '1']
  ],
  ['defect-cases', ['scripts/behavior-eval.ts', '--mechanical']],
  ['budget', ['scripts/check-budget.ts']]
]

const results: { check: string; exitCode: number | null }[] = []
for (const [check, command] of checks) {
  const result = Bun.spawnSync([process.execPath, ...command], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  results.push({ check, exitCode: result.exitCode })
  if (result.exitCode !== 0) {
    if (result.stdout.length) console.error(result.stdout.toString())
    console.error(result.stderr.toString())
    console.error(JSON.stringify({ protocol: 'release-review/v1', valid: false, results }))
    process.exit(result.exitCode || 1)
  }
}
console.log(
  JSON.stringify({
    protocol: 'release-review/v1',
    valid: true,
    scope: 'automated-checks-only',
    doesNotProve: ['agent-reading', 'agent-understanding', 'document-quality'],
    checks: results
  })
)
