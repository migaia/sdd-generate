#!/usr/bin/env bun
/**
 * Run an SDD's executable preflight (OD-65) and write the `sdd-preflight/v1` report that
 * `validate` checks. Each item runs in its own disposable copy of the repository, never in the
 * repository itself:
 *
 *   bun scripts/preflight.ts run --sdd <abs SDD> [--repository <abs root>] [--affected | --only P1,P2] [--out <path>]
 *
 * - The copy is the repository's HEAD (`git archive`), or the directory itself when it is not a Git
 *   repository; installed node_modules are linked in, as `--replay` does.
 * - An item's `patch` (relative to the SDD) is applied first: a BC's candidate change, or the
 *   perturbation a scaling gate must catch (`expect: "fail"`).
 * - The command runs through `sh -c` from `cwd` (repository-relative). Its exit decides PASS or FAIL
 *   against `expect`; a timeout is ERROR.
 * - Afterwards every tracked or new file the command changed is compared with the leaf's `writes`;
 *   a write outside them fails the item, which is how a gate that formats or builds other workspace
 *   members is caught.
 * - `--affected` re-runs only the items covering a clause that changed since the last report or
 *   cites one, plus every gate, and keeps the other results (amendment closure).
 *
 * Exit codes: 0 every item passed, 1 some did not, 2 usage or an unreadable document.
 */
import './lib/require-bun.ts'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { contractBlock } from './lib/contract-source.ts'
import { repositoryRoot } from './facts/repository.ts'
import { prose, withoutHistory } from './validator/domain/v2-document.ts'
import { list, text } from './validator/domain/v2-meta.ts'
import {
  affectedClauses,
  clauseHashes,
  digest,
  preflightItems,
  reportPath,
  type PreflightItem,
  type PreflightReport,
  type PreflightResult
} from './validator/domain/v2-preflight.ts'
import { exportTree, linkInstalled } from './validator/domain/v2-replay.ts'

/** Default per-item limit; an item may set `timeout_s`. */
const DEFAULT_TIMEOUT_S = 600

const sh = (cwd: string, argv: readonly string[], timeout?: number) =>
  Bun.spawnSync([...argv], { cwd, stdout: 'pipe', stderr: 'pipe', timeout })

/** A fresh copy of the repository to run one item in, as a throwaway Git repository. */
function materialise(repository: string): string {
  const tree = mkdtempSync(join(tmpdir(), 'sdd-preflight-'))
  const isGit = existsSync(join(repository, '.git'))
  if (!isGit || !exportTree(repository, 'HEAD', tree))
    cpSync(repository, tree, {
      recursive: true,
      filter: (src) => !/\/(?:\.git|node_modules)(?:\/|$)/.test(src)
    })
  linkInstalled(repository, [tree])
  // A private repository in the copy, so what the command writes can be read back with status.
  const git = (...args: string[]) =>
    sh(tree, ['git', '-c', 'user.name=preflight', '-c', 'user.email=preflight@invalid', ...args])
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'preflight base')
  return tree
}

/** Paths the command changed or created, ignoring linked dependencies. */
function written(tree: string): string[] {
  return sh(tree, ['git', 'status', '--porcelain', '--untracked-files=all'])
    .stdout.toString()
    .split('\n')
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .filter((path) => path && !/(?:^|\/)node_modules(?:\/|$)/.test(path))
}

/** Run one item and judge it against its expectation and the leaf's write scope. */
function runItem(
  item: PreflightItem,
  sdd: string,
  repository: string,
  writes: readonly string[]
): PreflightResult {
  const base = { id: item.id, covers: item.covers, expect: item.expect }
  const tree = materialise(repository)
  try {
    if (item.patch) {
      const applied = sh(tree, [
        'git',
        'apply',
        '--whitespace=nowarn',
        resolve(dirname(sdd), item.patch)
      ])
      if (applied.exitCode !== 0)
        return {
          ...base,
          exit: null,
          outcome: 'ERROR',
          writes_outside: [],
          reason: `patch does not apply: ${applied.stderr.toString().trim().slice(0, 200)}`
        }
      // The patched state becomes the base, so status afterwards shows only what the command wrote.
      sh(tree, ['git', 'add', '-A'])
      sh(tree, [
        'git',
        '-c',
        'user.name=preflight',
        '-c',
        'user.email=preflight@invalid',
        'commit',
        '-q',
        '--no-verify',
        '-m',
        'patch'
      ])
    }
    const run = sh(
      join(tree, item.cwd ?? ''),
      ['sh', '-c', item.command],
      (item.timeout_s ?? DEFAULT_TIMEOUT_S) * 1000
    )
    const outside = written(tree).filter(
      (path) =>
        !writes.some((scope) => path === scope || path.startsWith(`${scope.replace(/\/$/, '')}/`))
    )
    if (run.signalCode)
      return {
        ...base,
        exit: null,
        outcome: 'ERROR',
        writes_outside: outside,
        reason: `timed out or killed (${run.signalCode})`
      }
    const passed = item.expect === 'pass' ? run.exitCode === 0 : run.exitCode !== 0
    const tail = (run.stderr.toString() || run.stdout.toString())
      .trim()
      .split('\n')
      .slice(-3)
      .join(' | ')
    return {
      ...base,
      exit: run.exitCode,
      outcome: passed && !outside.length ? 'PASS' : 'FAIL',
      writes_outside: outside,
      ...(!passed
        ? {
            reason: `${item.expect === 'pass' ? 'expected pass' : 'perturbation not caught'}: exit ${run.exitCode}${tail ? ` — ${tail.slice(0, 240)}` : ''}`
          }
        : outside.length
          ? { reason: 'writes outside the leaf write scope' }
          : {})
    }
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv
  const value = (flag: string) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined)
  const sdd = value('--sdd')
  if (command !== 'run' || !sdd || !isAbsolute(sdd)) {
    console.error(
      'usage: preflight.ts run --sdd <abs SDD> [--repository <abs root>] [--affected | --only P1,P2] [--out <path>]'
    )
    return 2
  }
  const documentText = readFileSync(sdd, 'utf8')
  const index = contractBlock(documentText).value
  if (!index || index.protocol !== 'sdd/v2') {
    console.error(`PREFLIGHT_LEAF_REQUIRED: ${sdd} is not an sdd/v2 leaf`)
    return 2
  }
  const repository = value('--repository') ?? repositoryRoot(dirname(sdd))
  const body = withoutHistory(prose(documentText, 'sdd-contract'))
  const items = preflightItems(index)
  const out = value('--out') ? resolve(value('--out')!) : reportPath(index, sdd)
  const previous: PreflightReport | null = existsSync(out)
    ? (JSON.parse(readFileSync(out, 'utf8')) as PreflightReport)
    : null
  let selected = items
  if (value('--only')) {
    const only = new Set(value('--only')!.split(','))
    selected = items.filter((item) => only.has(item.id))
  } else if (rest.includes('--affected') && previous) {
    const { changed, citing } = affectedClauses(index, body, previous.clause_hashes ?? {})
    const touched = new Set([...changed, ...citing])
    const kept = new Map((previous.items ?? []).map((item) => [item.id, item]))
    selected = items.filter(
      (item) => item.gate || !kept.has(item.id) || item.covers.some((id) => touched.has(id))
    )
  }
  const writes = list(index.writes).filter(text)
  const fresh = new Map(
    selected.map((item) => {
      const result = runItem(item, sdd, repository, writes)
      console.error(`${result.outcome} ${item.id}${result.reason ? ` — ${result.reason}` : ''}`)
      return [item.id, result] as const
    })
  )
  const results = items.map(
    (item) =>
      fresh.get(item.id) ??
      previous?.items?.find((old) => old.id === item.id) ?? {
        id: item.id,
        covers: item.covers,
        expect: item.expect,
        exit: null,
        outcome: 'ERROR' as const,
        writes_outside: [],
        reason: 'not run'
      }
  )
  const head = existsSync(join(repository, '.git'))
    ? sh(repository, ['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim() || null
    : null
  const report: PreflightReport = {
    protocol: 'sdd-preflight/v1',
    sdd,
    sdd_sha: digest(documentText),
    repository,
    repository_head: head,
    dirty: head
      ? sh(repository, ['git', 'status', '--porcelain', '--untracked-files=no']).stdout.length > 0
      : false,
    clause_hashes: clauseHashes(index, body),
    items: results,
    status: results.every((result) => result.outcome === 'PASS') ? 'PASSED' : 'FAILED'
  }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    JSON.stringify({
      protocol: 'sdd-preflight/v1',
      report: out,
      status: report.status,
      ran: [...fresh.keys()],
      failed: results.filter((r) => r.outcome !== 'PASS').map((r) => r.id),
      dirty: report.dirty
    })
  )
  return report.status === 'PASSED' ? 0 : 1
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)))
