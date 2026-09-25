import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'scripts', 'validate.ts')
const run = (...args: string[]) => {
  const proc = Bun.spawnSync([process.execPath, CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const out = proc.stdout.toString()
  return {
    exit: proc.exitCode,
    json: out.trim() ? (JSON.parse(out) as Record<string, unknown>) : undefined,
    stderr: proc.stderr.toString()
  }
}

/**
 * The document validator runs from this skill alone.
 *
 * It used to be reachable only through the delivery loop's CLI, so an SDD written here could be
 * checked only where that skill was installed — and every rule added to catch a document defect
 * early lived in a skill this one does not own. The exit codes are the contract callers read:
 * 0 valid, 1 invalid, 2 for a usage error.
 */
test('validate runs from create-sdd with the loop-compatible exit codes', () => {
  const root = mkdtempSync(join(tmpdir(), 'validate-cli-'))
  try {
    // A fixture this skill ships is a valid sdd/v2 document by construction.
    const body = readFileSync(
      join(import.meta.dir, '..', 'cases', 'fixtures', 'v2-scope', 'enum.ok.md'),
      'utf8'
    )
    const sdd = join(root, 'example.sdd.md')
    writeFileSync(sdd, body)
    const valid = run('validate-draft', '--draft-file', sdd)
    expect(valid.exit).toBe(0)
    expect(valid.json).toMatchObject({ valid: true, draft: true })
    // What the loop adds on top is not a property of the document and is not reported here.
    expect(valid.json).not.toHaveProperty('runtimeWriteRequests')

    // A document that cannot pass reports its reasons and exits 1, not 2.
    const broken = join(root, 'broken.sdd.md')
    writeFileSync(broken, '# Not an SDD\n')
    const invalid = run('validate', '--sdd', broken)
    expect(invalid.exit).toBe(1)
    expect(invalid.json).toMatchObject({ valid: false })

    // Identifier allocation reads the document without changing it.
    expect(run('document-next-id', '--sdd', sdd, '--prefix', 'XQ').json).toMatchObject({
      prefix: 'XQ'
    })

    // A usage error is distinguishable from an invalid document.
    expect(run('validate').exit).toBe(2)
    expect(run('no-such-command').exit).toBe(2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
