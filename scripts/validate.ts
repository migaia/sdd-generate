/**
 * The sdd/v2 document validator, owned by create-sdd because create-sdd defines the format.
 * Exit codes: 0 valid, 1 invalid, 2 for a usage error or a document that could not be read. A
 * document in the retired sdd-loop-delivery/v1 format is reported as SDD_V1_UNSUPPORTED.
 *
 *   validate          --sdd <path> [--repository <root>] [--evidence <report.json> [--replay]]
 *   validate-draft    --sdd <path> | --draft-file <path> | (stdin)
 *                     --sdd <absolute root> --documents-file <json array of {path, content}>
 *   document-check    --sdd <path>
 *   document-next-id  --sdd <path> --prefix <XX>
 */
import './lib/require-bun.ts'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { documentDigest, record } from './lib/telemetry'
import { contractBlock } from './lib/contract-source.ts'
import { checkClosure } from './validator/domain/v2-closure.ts'
import type { V2Result } from './validator/domain/v2-document.ts'
import {
  documentCheck,
  nextDocumentId,
  validateDocument,
  validateDraft,
  validateDraftText
} from './validator/controllers/document.controller'

const COMMANDS = ['validate', 'validate-draft', 'document-check', 'document-next-id'] as const
const USAGE =
  'usage: validate.ts validate|validate-draft|document-check --sdd <path> [--repository <absolute-root>] [--evidence <sdd-evidence.json> [--replay]] | validate-draft --draft-file <path> | validate-draft --sdd <abs> --documents-file <json> | document-next-id --sdd <path> --prefix <XX>'

/** Read `--flag value` pairs; a bare flag reads as present with no value. */
function flags(argv: readonly string[]): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]!
    if (!key.startsWith('--')) throw new Error(`CLI_ARGUMENT_UNEXPECTED:${key}`)
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out.set(key, next)
      index += 1
    } else out.set(key, undefined)
  }
  return out
}

/** Run one command and return its JSON result with the exit code it implies. */
export async function run(
  command: string,
  argv: readonly string[]
): Promise<{ output: unknown; exit: number }> {
  if (!(COMMANDS as readonly string[]).includes(command))
    throw new Error(`CLI_COMMAND_UNKNOWN:${command}`)
  const options = flags(argv)
  const value = (key: string) => options.get(key)
  const byValidity = (result: { valid: boolean }) => ({
    output: result,
    exit: result.valid ? 0 : 1
  })
  const sdd = value('--sdd')
  const repository = value('--repository')
  if (options.has('--repository') && (!repository || !isAbsolute(repository)))
    throw new Error('REPOSITORY_PATH_ABSOLUTE_REQUIRED')
  if (command === 'document-next-id') {
    const prefix = value('--prefix')
    if (!sdd || !prefix) throw new Error('SDD_AND_PREFIX_REQUIRED: pass --sdd and --prefix')
    return { output: nextDocumentId(sdd, prefix), exit: 0 }
  }
  if (command === 'validate-draft' && options.has('--documents-file')) {
    const file = value('--documents-file')
    if (!file || !sdd || !isAbsolute(sdd) || options.has('--draft-file'))
      throw new Error('DRAFT_DOCUMENTS_ARGS_INVALID')
    const documents = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(documents)) throw new Error('DRAFT_DOCUMENTS_ARRAY_REQUIRED')
    const entries = documents as { path?: unknown; content?: unknown }[]
    const roots = entries.filter(
      (entry) => entry && typeof entry.path === 'string' && resolve(entry.path) === resolve(sdd)
    )
    if (roots.length !== 1 || typeof roots[0]!.content !== 'string')
      throw new Error('DRAFT_ROOT_REQUIRED')
    return byValidity(
      validateDraftText(
        roots[0]!.content as string,
        sdd,
        entries as { path: string; content: string }[],
        repository
      )
    )
  }
  if (command === 'validate-draft' && !sdd) {
    const draftFile = value('--draft-file')
    const text = draftFile ? readFileSync(draftFile, 'utf8') : await new Response(Bun.stdin).text()
    return byValidity(validateDraftText(text, draftFile ?? '<stdin>', [], repository))
  }
  if (!sdd) throw new Error('SDD_REQUIRED: pass --sdd /absolute/path/to/document.sdd.md')
  const evidence = value('--evidence')
  if (command === 'validate' && evidence) {
    // Converge: compare a host's evidence report with this leaf's acceptance and revision.
    const result = validateDocument(sdd, repository)
    const index = contractBlock(readFileSync(sdd, 'utf8')).value
    if (!('handoff' in result) || result.handoff.protocol !== 'create-sdd-handoff/v2' || !index)
      throw new Error('EVIDENCE_REQUIRES_V2_LEAF')
    const report: unknown = JSON.parse(readFileSync(evidence, 'utf8'))
    // The protocol check above leaves only the v2 leaf result.
    const v2 = result as V2Result
    const closure = checkClosure(v2, index, report, v2.handoff.repository, {
      replay: options.has('--replay')
    })
    return {
      output: { ...result, closure },
      exit: result.valid && closure.status === 'CLOSED' ? 0 : 1
    }
  }
  return byValidity(
    command === 'validate'
      ? validateDocument(sdd, repository)
      : command === 'validate-draft'
        ? validateDraft(sdd, repository)
        : documentCheck(sdd)
  )
}

/**
 * Pull the codes out of whatever shape the command returned, for the rule ledger.
 *
 * The reported `code` is often an umbrella — `SDD_CONTRACT_INVALID` carries the code that actually
 * fired inside its message. Counting only the umbrella would make almost every contract rule look
 * dead, which is the opposite of what this measurement is for, so the inner codes are harvested too.
 */
function codesOf(output: unknown): readonly string[] {
  const shape = output as
    | {
        diagnostics?: readonly { code?: unknown; message?: unknown }[]
        closure?: { findings?: readonly { code?: unknown; message?: unknown }[] }
      }
    | undefined
  // An evidence closure reports its findings beside the diagnostics, not inside them; both are what
  // this run decided, so both reach the ledger (OD-14).
  const entries = [
    ...(Array.isArray(shape?.diagnostics) ? shape.diagnostics : []),
    ...(Array.isArray(shape?.closure?.findings) ? shape.closure.findings : [])
  ]
  const codes: string[] = []
  for (const entry of entries) {
    const code = String(entry?.code ?? '')
    if (code) codes.push(code)
    for (const match of String(entry?.message ?? '').matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g))
      codes.push(match[1]!)
  }
  return codes
}

/** Advisory codes a v2 handoff reports; they never block, so the ledger keeps them apart (OD-14). */
function candidatesOf(output: unknown): readonly string[] {
  const candidates = (output as { handoff?: { candidates?: readonly { code?: unknown }[] } })
    ?.handoff?.candidates
  return Array.isArray(candidates)
    ? candidates.map((entry) => String(entry?.code ?? '')).filter(Boolean)
    : []
}

/**
 * OD-50: the skill version that produced a result, so a handoff or closure can be reproduced and
 * compared across skill updates. `commit` is null for an install that is not a Git checkout; `dirty`
 * means the checkout has uncommitted changes, so the commit alone does not identify the validator.
 */
function validatorVersion(): { commit: string | null; dirty: boolean } {
  const root = resolve(import.meta.dir, '..')
  const git = (...args: string[]) =>
    Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const head = git('rev-parse', '--short', 'HEAD')
  if (head.exitCode !== 0) return { commit: null, dirty: false }
  return {
    commit: head.stdout.toString().trim(),
    dirty: git('status', '--porcelain', '--', 'scripts', 'references', 'SKILL.md').stdout.length > 0
  }
}

/** Attach the validator version to the result's top level; non-object output passes through. */
function withValidator(output: unknown): unknown {
  return output && typeof output === 'object' && !Array.isArray(output)
    ? { ...(output as Record<string, unknown>), validator: validatorVersion() }
    : output
}

if (import.meta.main) {
  const [command, ...argv] = Bun.argv.slice(2)
  try {
    if (!command) throw new Error(USAGE)
    const { output, exit } = await run(command, argv)
    const sdd = argv[argv.indexOf('--sdd') + 1]
    if (sdd && argv.includes('--sdd') && existsSync(sdd))
      record({
        tool: `validate:${command}`,
        sddSha: documentDigest(readFileSync(sdd, 'utf8')),
        codes: codesOf(output),
        candidateCodes: candidatesOf(output),
        review: (output as { handoff?: { review?: Record<string, Record<string, number>> } })
          ?.handoff?.review
      })
    console.log(JSON.stringify(withValidator(output)))
    process.exit(exit)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
