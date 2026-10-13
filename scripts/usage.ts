/**
 * Usage harvest: what implementing an SDD actually cost, attributed to its six Meta levels.
 *
 * A quote ("this Entry costs about this much, its tests that much") needs observed cost per unit of
 * design, and nothing recorded one: `validate` sees documents, not the agent work they cause. The
 * agent hosts already log every model call with its token usage, so this script reads those logs
 * (Claude Code `~/.claude/projects`, Codex `~/.codex/sessions`) and attributes each call by the
 * paths it edits or reads to the step, Chunk, Module, Entry, Asset and Bundle that own them, and by
 * what it did to an activity: design, implement, test, review or other. Calls that only read or
 * think take the attribution of the next call in the same transcript that does something, because
 * reading precedes the edit it serves. Block signals (failed checks and the calls spent until a
 * check passes again, tool errors, interrupts, compactions, human wait) are kept apart: they are
 * the bias a later estimate must add on top of the clean cost.
 *
 * Only counts, timestamps, Meta IDs and repository paths are read out of a transcript; message text
 * never leaves this process. Costs stay in tokens per model: prices change, so turning tokens into
 * money belongs to the report that quotes, not to the record.
 *
 *   usage.ts harvest --sdd <abs SDD or program root> [--repository <abs root>]
 *                    [--since <iso>] [--until <iso>] [--claude <dir>] [--codex <dir>] [--record]
 *
 * `--record` appends a path-free summary to rsi/usage.jsonl (ignored by Git; `CREATE_SDD_TELEMETRY=0`
 * disables it). Exit codes: 0 harvested, 1 no transcript matched, 2 usage or an unreadable document.
 */
import './lib/require-bun.ts'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { contractBlock, programBlock } from './lib/contract-source.ts'
import { documentDigest } from './lib/telemetry.ts'
import { flags } from './validate.ts'

const USAGE =
  'usage: usage.ts harvest --sdd <abs SDD> [--repository <abs root>] [--since <iso>] [--until <iso>] [--claude <dir>] [--codex <dir>] [--record]'
const LEDGER = join(import.meta.dir, '..', 'rsi', 'usage.jsonl')

/** Child `validate` runs at once; one can hold gigabytes on a large document tree (7.8 GB seen). */
const VALIDATE_CONCURRENCY = 1

/** A gap longer than this between two calls of one transcript is idle, not work. */
const IDLE_CAP_MS = 5 * 60_000
/** Waiting on a human longer than this is time away, not a wait inside the work. */
const WAIT_CAP_MS = 30 * 60_000

/** What a call did. `other` is a call with no path or check to place it, even after look-ahead. */
const ACTIVITIES = ['design', 'implement', 'test', 'review', 'other'] as const
type Activity = (typeof ACTIVITIES)[number]
/** The six levels a call is attributed to; `Step` is the task row of the Meta table. */
const LEVELS = ['Bundle', 'Entry', 'Module', 'Chunk', 'Step', 'Asset'] as const
type Level = (typeof LEVELS)[number]

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$/
const TEST_COMMAND =
  /\b(bun test|vitest|jest|pytest|cargo test|go test|(npm|pnpm|yarn)( run)? test|playwright|mocha)\b|preflight\.ts|--evidence/
const DESIGN_COMMAND =
  /\b(validate\.ts|validate-draft|document-check|init\.ts|render\.ts|type-probe\.ts)\b/
/** Commands whose failure blocks progress: tests, builds, type checks, lints and this skill's checks. */
const CHECK_COMMAND = new RegExp(
  `${TEST_COMMAND.source}|${DESIGN_COMMAND.source}|\\b(tsc|cargo (build|check)|go (build|vet)|(npm|pnpm|yarn)( run)? (build|lint|typecheck))\\b`
)
const REVIEW_PROMPT = /\breview(er)?\b|审查|评审/i
const CODEX_FAILED = /exit(ed)? (with )?code:? ?[1-9]|Process exited with code [1-9]/i

type Tokens = {
  input: number
  cache_write: number
  cache_read: number
  output: number
  reasoning: number
}
/** One model call: its usage, the paths it edited or read, its commands and whether one failed. */
type Call = {
  at: number
  active_ms: number
  model: string
  tokens: Tokens
  edits: string[]
  reads: string[]
  commands: string[]
  failed: boolean
  ok_check: boolean
  review: boolean
  /** Block signals: errors of this call's tools, and the waits, interrupts and compactions before it. */
  events: Events
}
type Events = { tool_errors: number; wait_ms: number; interrupts: number; compactions: number }
type Transcript = { host: 'claude' | 'codex'; root: string; calls: Call[] }
const noEvents = (): Events => ({ tool_errors: 0, wait_ms: 0, interrupts: 0, compactions: 0 })
const newCall = (fields: Partial<Call>, events: Events): Call => ({
  at: 0,
  active_ms: 0,
  model: 'unknown',
  tokens: zero(),
  edits: [],
  reads: [],
  commands: [],
  failed: false,
  ok_check: false,
  review: false,
  ...fields,
  events
})

const zero = (): Tokens => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, reasoning: 0 })
const addTokens = (into: Tokens, from: Tokens, share = 1) => {
  for (const key of Object.keys(into) as (keyof Tokens)[]) into[key] += from[key] * share
}

/** Record one tool result on the call that ran it: an error, or a check that passed. */
function settle(call: Call, failed: boolean) {
  if (failed) {
    call.events.tool_errors += 1
    call.failed = true
  } else if (call.commands.some((c) => CHECK_COMMAND.test(c))) call.ok_check = true
}

const files = (dir: string, suffix: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith(suffix))
        .map((entry) => join(dir, entry))
    : []

/** Parse a JSONL transcript one line at a time; holding a whole session parsed costs gigabytes. */
function* lines(file: string): Generator<Record<string, any>> {
  for (const line of readFileSync(file, 'utf8').split('\n'))
    if (line.trim())
      try {
        yield JSON.parse(line)
      } catch {}
}

/** The first `cwd` a transcript records, read from its head without reading the rest. */
async function cwdOf(file: string): Promise<string | undefined> {
  return /"cwd":"([^"]+)"/.exec(await Bun.file(file).slice(0, 65_536).text())?.[1]
}

/**
 * The checkouts of one repository: the main tree, its live Git worktrees, and Codex's own worktree
 * convention (`~/.codex/worktrees/<name>/<repository name>`), which survives the worktree's removal.
 * A transcript belongs to the repository when its working directory lies inside one of them, and
 * its paths are read relative to that checkout.
 */
function checkoutsOf(repository: string): (cwd: unknown) => string | null {
  const listed = Bun.spawnSync(['git', '-C', repository, 'worktree', 'list', '--porcelain'], {
    stdout: 'pipe'
  })
  const roots = [
    repository,
    ...[...listed.stdout.toString().matchAll(/^worktree (.+)$/gm)].map((m) => m[1]!)
  ]
  const codex = new RegExp(
    `^(.*/\\.codex/worktrees/[^/]+/${basename(repository).replace(/\W/g, '\\$&')})(/|$)`
  )
  return (cwd) => {
    if (typeof cwd !== 'string') return null
    return (
      roots.find((root) => cwd === root || cwd.startsWith(`${root}/`)) ??
      codex.exec(cwd)?.[1] ??
      null
    )
  }
}
type Checkout = ReturnType<typeof checkoutsOf>

/**
 * Active time of a call: the gap since the previous call or human prompt of its transcript, capped,
 * so it covers the model's latency and the tools the previous call ran. A gap before a human prompt
 * is waiting, never work, so it goes to `wait_ms` instead.
 */
function clock(at: number, previous: number | undefined, cap = IDLE_CAP_MS) {
  return previous === undefined ? 0 : Math.max(0, Math.min(at - previous, cap))
}

/**
 * Claude Code: one assistant `message.id` is one model call, logged once per content block with the
 * same usage, so lines are merged by id. Subagent transcripts live in `<session>/subagents/`.
 */
function claudeTranscripts(root: string, repository: string, checkout: Checkout): Transcript[] {
  const out: Transcript[] = []
  if (!existsSync(root)) return out
  // A project directory is its working directory with every non-alphanumeric character as `-`;
  // worktree directories are kept for the per-line `cwd` check to decide.
  const prefix = repository.replace(/[^A-Za-z0-9]/g, '-')
  for (const project of readdirSync(root).filter(
    (name) => name.startsWith(prefix) || name.includes('-worktrees-')
  ))
    for (const file of files(join(root, project), '.jsonl')) {
      // Claude logs `cwd` on most lines but not the first ones, so the checkout is read as it appears.
      const t: Transcript = { host: 'claude', root: '', calls: [] }
      let carry = noEvents()
      const byId = new Map<string, Call>()
      const byTool = new Map<string, Call>()
      // A subagent whose first prompt asks for a review is a reviewer, known once that prompt is read.
      let review: boolean | undefined
      let previous: number | undefined
      for (const entry of lines(file)) {
        t.root ||= checkout(entry.cwd) ?? ''
        if (review === undefined && entry.type === 'user')
          review =
            file.includes('/subagents/') &&
            REVIEW_PROMPT.test(JSON.stringify(entry.message?.content ?? ''))
        const at = Date.parse(entry.timestamp ?? '')
        if (Number.isNaN(at)) continue
        const content = entry.message?.content
        if (entry.isCompactSummary || entry.subtype === 'compact_boundary') carry.compactions += 1
        if (entry.type === 'user') {
          const results = Array.isArray(content)
            ? content.filter((c: any) => c?.type === 'tool_result')
            : []
          for (const result of results) {
            const call = byTool.get(result.tool_use_id)
            if (call) settle(call, Boolean(result.is_error))
          }
          if (!results.length && !entry.isMeta && !entry.isCompactSummary) {
            if (JSON.stringify(content ?? '').includes('[Request interrupted'))
              carry.interrupts += 1
            else if (previous !== undefined) carry.wait_ms += clock(at, previous, WAIT_CAP_MS)
            previous = at
          }
          continue
        }
        const model = entry.message?.model
        if (
          entry.type !== 'assistant' ||
          !entry.message?.id ||
          entry.isApiErrorMessage ||
          model === '<synthetic>'
        )
          continue
        const usage = entry.message.usage ?? {}
        let call = byId.get(entry.message.id)
        if (!call) {
          call = newCall(
            {
              at,
              active_ms: clock(at, previous),
              model: model ?? 'unknown',
              review: Boolean(review)
            },
            carry
          )
          carry = noEvents()
          byId.set(entry.message.id, call)
          t.calls.push(call)
        }
        call.tokens = {
          input: usage.input_tokens ?? 0,
          cache_write: usage.cache_creation_input_tokens ?? 0,
          cache_read: usage.cache_read_input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          reasoning: usage.output_tokens_details?.thinking_tokens ?? 0
        }
        for (const use of Array.isArray(content) ? content : []) {
          if (use?.type !== 'tool_use') continue
          byTool.set(use.id, call)
          const input = use.input ?? {}
          const path = input.file_path ?? input.notebook_path
          if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(use.name) && path)
            call.edits.push(path)
          else if (['Read', 'Grep', 'Glob'].includes(use.name) && (path ?? input.path))
            call.reads.push(path ?? input.path)
          else if (use.name === 'Bash' && input.command) call.commands.push(String(input.command))
          else if (
            ['Agent', 'Task'].includes(use.name) &&
            REVIEW_PROMPT.test(String(input.prompt ?? input.description ?? ''))
          )
            call.review = true
        }
        previous = at
      }
      if (t.root && t.calls.length) out.push(t)
    }
  return out
}

/**
 * Codex: a `token_count` event closes one model call and carries its `last_token_usage`; the tool
 * calls logged since the previous one are what that call asked for. Codex counts cached input inside
 * `input_tokens`, so the uncached part is the difference. A subagent session has a non-user
 * `thread_source`.
 */
async function codexTranscripts(root: string, checkout: Checkout): Promise<Transcript[]> {
  const out: Transcript[] = []
  for (const file of files(root, '.jsonl')) {
    const home = checkout(await cwdOf(file))
    if (!home) continue
    const t: Transcript = { host: 'codex', root: home, calls: [] }
    // A Codex subagent's task arrives encrypted and its first user turn is AGENTS.md, so the
    // readable signal is the task name its parent gave it (`agent_path`, e.g. `/root/closure_review`).
    let review = false
    const byTool = new Map<string, Call>()
    let model = 'unknown'
    let pending = newCall({}, noEvents())
    let pendingIds: string[] = []
    let previous: number | undefined
    let lastTotal = -1
    for (const entry of lines(file)) {
      const at = Date.parse(entry.timestamp ?? '')
      if (Number.isNaN(at)) continue
      const p = entry.payload ?? {}
      if (entry.type === 'session_meta')
        review = REVIEW_PROMPT.test(p.source?.subagent?.thread_spawn?.agent_path ?? '')
      if (entry.type === 'turn_context' && p.model) model = p.model
      if (entry.type === 'compacted') pending.events.compactions += 1
      if (p.type === 'turn_aborted') pending.events.interrupts += 1
      if (p.type === 'message' && p.role === 'user') {
        if (previous !== undefined) pending.events.wait_ms += clock(at, previous, WAIT_CAP_MS)
        previous = at
      }
      if (p.type === 'custom_tool_call' || p.type === 'function_call') {
        const text = String(p.input ?? p.arguments ?? '')
        for (const m of text.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n"\\]+)/g))
          pending.edits.push(m[1]!.trim())
        for (const m of text.matchAll(/"?(?:cmd|command)"?\s*:\s*"((?:[^"\\]|\\.)*)"/g))
          pending.commands.push(m[1]!)
        if (p.name === 'spawn_agent' && REVIEW_PROMPT.test(text)) pending.review = true
        pendingIds.push(p.call_id)
      }
      if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
        const call = byTool.get(p.call_id)
        if (call) settle(call, CODEX_FAILED.test(String(p.output ?? '')))
      }
      const usage = p.type === 'token_count' ? p.info?.last_token_usage : undefined
      const total = p.info?.total_token_usage?.total_tokens
      if (usage && total !== lastTotal) {
        lastTotal = total
        Object.assign(pending, {
          at,
          active_ms: clock(at, previous),
          model,
          tokens: {
            input: Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0)),
            cache_write: usage.cache_write_input_tokens ?? 0,
            cache_read: usage.cached_input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            reasoning: usage.reasoning_output_tokens ?? 0
          }
        })
        t.calls.push(pending)
        for (const id of pendingIds) byTool.set(id, pending)
        pending = newCall({}, noEvents())
        pendingIds = []
        previous = at
      }
    }
    if (review) for (const call of t.calls) call.review = true
    if (t.calls.length) out.push(t)
  }
  return out
}

/** One Bundle as the attribution needs it: its own files, steps, and the Metas each step reaches. */
type Plan = {
  bundle: string
  sdd: string
  /** The SDD and its companions (same directory, same stem): editing them is design. */
  design: (path: string) => boolean
  steps: {
    id: string
    chunk?: string
    entries: string[]
    modules: string[]
    touches: { path: string; status: string }[]
  }[]
  assets: { id: string; path: string }[]
  writes: string[]
  features: Record<string, unknown>
}

const under = (path: string, surface: string) =>
  path === surface || path.startsWith(`${surface.replace(/\/$/, '')}/`)

/**
 * The handoff's `execution_slice`, from a `validate` subprocess: a program's children then validate
 * in parallel, and their runs stay out of the rule telemetry, which counts authoring checks.
 */
async function sliceOf(sdd: string, repository: string): Promise<Record<string, any>> {
  const run = Bun.spawn(
    [
      'bun',
      join(import.meta.dir, 'validate.ts'),
      'validate',
      '--sdd',
      sdd,
      '--repository',
      repository
    ],
    { stdout: 'pipe', stderr: 'ignore', env: { ...process.env, CREATE_SDD_TELEMETRY: '0' } }
  )
  try {
    return JSON.parse(await new Response(run.stdout).text()).handoff?.execution_slice ?? {}
  } catch {
    return {}
  }
}

async function planOf(sdd: string, repository: string): Promise<Plan> {
  const text = readFileSync(sdd, 'utf8')
  const index = contractBlock(text).value ?? {}
  const slice = await sliceOf(sdd, repository)
  const stem = basename(sdd).replace(/\.sdd\.md$/, '')
  const dir = relative(repository, dirname(sdd))
  const moduleOf = new Map<string, string[]>()
  for (const requirement of index.requirements ?? [])
    for (const step of requirement.implementation ?? [])
      moduleOf.set(step, [...(moduleOf.get(step) ?? []), requirement.id])
  const steps = (slice.tasks ?? []).map((task: any) => ({
    id: task.id,
    chunk: task.chunk,
    entries: task.entries ?? [],
    modules: moduleOf.get(task.id) ?? [],
    touches: task.touches ?? []
  }))
  return {
    bundle: slice.bundle ?? `B:${index.id ?? stem}`,
    sdd,
    design: (path) => dirname(path) === dir && basename(path).startsWith(`${stem}.`),
    steps,
    assets: [...(slice.produced_assets ?? []), ...(slice.required_assets ?? [])].filter(
      (a: any) => a.path
    ),
    writes: index.writes ?? [],
    // What a later fit regresses cost on; counts only, so the record stays path-free.
    features: {
      kind: index.intent === 'bug' ? 'bug' : index.review ? 'reviewed' : 'leaf',
      requirements: (index.requirements ?? []).length,
      acceptance: (index.acceptance ?? []).length,
      preflight: (index.preflight ?? []).length,
      chunks: (slice.chunks ?? []).length,
      waves: (slice.waves ?? []).length,
      steps: Object.fromEntries(
        steps.map((s: Plan['steps'][number]) => [
          s.id,
          {
            touches_new: s.touches.filter((t) => t.status === 'new').length,
            touches_existing: s.touches.filter((t) => t.status !== 'new').length,
            test_touches: s.touches.filter((t) => TEST_PATH.test(t.path)).length,
            modules: s.modules.length
          }
        ])
      )
    }
  }
}

/** The plans of a leaf, or of a program root and each child it lists. */
async function plansOf(
  sdd: string,
  repository: string
): Promise<{ plans: Plan[]; entryOf: Map<string, string[]> }> {
  const program = programBlock(readFileSync(sdd, 'utf8')).value
  if (!program) return { plans: [await planOf(sdd, repository)], entryOf: new Map() }
  // Each validate holds a document tree in memory, so children run a few at a time, not all at once.
  const paths: string[] = (program.children ?? []).map((child: any) =>
    resolve(dirname(sdd), child.sdd)
  )
  const plans: Plan[] = []
  for (let at = 0; at < paths.length; at += VALIDATE_CONCURRENCY)
    plans.push(
      ...(await Promise.all(
        paths.slice(at, at + VALIDATE_CONCURRENCY).map((path) => planOf(path, repository))
      ))
    )
  const stem = basename(sdd).replace(/\.sdd\.md$/, '')
  const dir = relative(repository, dirname(sdd))
  plans.unshift({
    bundle: `B:${program.id ?? stem}`,
    sdd,
    design: (p: string) => dirname(p) === dir && basename(p).startsWith(`${stem}.`),
    steps: [],
    assets: [],
    writes: [],
    features: { kind: 'program', children: plans.length }
  })
  // A root Entry binds child Modules through `members`; a call on a child Module (`M:<child>:<R>`)
  // also reaches every root Entry that binds it.
  const metas = new Map<string, any>((program.metas ?? []).map((m: any) => [m.id, m]))
  const entryOf = new Map<string, string[]>()
  for (const entry of metas.values())
    for (const member of entry.kind === 'Entry' ? (entry.members ?? []) : []) {
      const m = metas.get(member)
      const id = m && `M:${m.owner}:${m.source_id}`
      if (id) entryOf.set(id, [...(entryOf.get(id) ?? []), entry.id])
    }
  return { plans, entryOf }
}

type Totals = {
  calls: number
  active_ms: number
  tokens: Tokens
  activity: Record<string, { calls: number; active_ms: number; tokens: Tokens }>
  models: Record<string, Tokens>
}
const totals = (): Totals => ({ calls: 0, active_ms: 0, tokens: zero(), activity: {}, models: {} })
function charge(into: Totals, call: Call, activity: Activity, share: number) {
  into.calls += share
  into.active_ms += call.active_ms * share
  addTokens(into.tokens, call.tokens, share)
  const a = (into.activity[activity] ??= { calls: 0, active_ms: 0, tokens: zero() })
  a.calls += share
  a.active_ms += call.active_ms * share
  addTokens(a.tokens, call.tokens, share)
  addTokens((into.models[call.model] ??= zero()), call.tokens, share)
}

/** Where one call lands: its activity and, per level, the IDs that share it. */
/**
 * `own` is true when the call touched a plan's SDD file or a step's path. Only such calls open the
 * window and admit a transcript: `writes` often names shared files that unrelated work also edits.
 */
type Target = {
  activity: Activity | null
  metas: [Level, string][] | 'foreign' | null
  own?: boolean
}

function target(
  call: Call,
  plans: Plan[],
  root: string,
  checkout: Checkout,
  entryOf: Map<string, string[]>
): Target {
  // An absolute path is read against the checkout that holds it; a worktree nested in the checkout
  // (`.claude/worktrees/<name>/`) holds the same repository paths.
  const rel = (path: string) =>
    (isAbsolute(path) ? relative(checkout(path) ?? root, path) : path).replace(
      /^(\.claude\/)?\.?worktrees\/[^/]+\//,
      ''
    )
  const edits = call.edits.map(rel).filter((p) => !p.startsWith('..'))
  const reads = call.reads.map(rel).filter((p) => !p.startsWith('..'))
  const metas: [Level, string][] = []
  // A shell host (Codex) reads the SDD with `cat`/`sed`, so a command naming the file reads it too.
  const commands = call.commands.join('\n')
  const designs = plans.filter(
    (plan) => [...edits, ...reads].some(plan.design) || commands.includes(basename(plan.sdd))
  )
  for (const path of edits.length ? edits : reads)
    for (const plan of plans) {
      const steps = plan.steps.filter((s) => s.touches.some((t) => under(path, t.path)))
      for (const step of steps) {
        metas.push(['Step', `${plan.bundle}/${step.id}`])
        if (step.chunk) metas.push(['Chunk', step.chunk])
        for (const id of step.entries) metas.push(['Entry', id])
        for (const id of step.modules.map((m) => `M:${plan.bundle.slice(2)}:${m}`)) {
          metas.push(['Module', id])
          for (const entry of entryOf.get(id) ?? []) metas.push(['Entry', entry])
        }
      }
      for (const asset of plan.assets.filter((a) => under(path, a.path)))
        metas.push(['Asset', asset.id])
      if (steps.length || plan.writes.some((w) => under(path, w)) || plan.design(path))
        metas.push(['Bundle', plan.bundle])
    }
  for (const plan of designs) metas.push(['Bundle', plan.bundle])
  // Another SDD's file, or an edit outside every plan, marks other work in a shared session; it
  // stops the fill below, so that work is not charged here.
  const foreign =
    edits.length > 0 ||
    [...edits, ...reads].some((p) => p.endsWith('.sdd.md') && !plans.some((plan) => plan.design(p)))
  if (foreign && !metas.length) return { activity: null, metas: 'foreign' }
  const own = designs.length > 0 || metas.some(([level]) => level === 'Step')
  const activity: Activity | null = call.review
    ? 'review'
    : edits.some((p) => plans.some((plan) => plan.design(p))) ||
        (DESIGN_COMMAND.test(commands) && !/--evidence/.test(commands))
      ? 'design'
      : edits.some((p) => TEST_PATH.test(p)) || TEST_COMMAND.test(commands)
        ? 'test'
        : edits.length
          ? 'implement'
          : null
  return { activity, metas: metas.length ? metas : null, own }
}

/**
 * Attribute every call. A call with no activity or no Meta of its own takes the next decided one in
 * its transcript (reading precedes the edit it serves), else the previous; a transcript none of
 * whose calls reaches the plans is not this SDD's work and is skipped. Calls between a failed check
 * and the next passing one are rework: still charged where they land, and also counted as block.
 */
export async function harvest(
  sdd: string,
  repository: string,
  options: { since?: number; until?: number; claude: string; codex: string }
) {
  const { plans, entryOf } = await plansOf(sdd, repository)
  const checkout = checkoutsOf(repository)
  const transcripts = [
    ...claudeTranscripts(options.claude, repository, checkout),
    ...(await codexTranscripts(options.codex, checkout))
  ]
  const decided = transcripts.map((t) =>
    t.calls.map((call) => target(call, plans, t.root, checkout, entryOf))
  )
  // Default start: the first call that touched one of the plans' SDD files, i.e. when design began.
  const since =
    options.since ??
    Math.min(
      ...transcripts.flatMap((t, i) =>
        t.calls.filter((_, j) => decided[i]![j]!.own).map((c) => c.at)
      )
    )
  const until = options.until ?? Infinity
  const byLevel = Object.fromEntries(
    LEVELS.map((level) => [level, {} as Record<string, Totals>])
  ) as Record<Level, Record<string, Totals>>
  const all = totals()
  const unattributed = totals()
  const blocks = {
    failed_checks: 0,
    rework: totals(),
    tool_errors: 0,
    interrupts: 0,
    compactions: 0,
    wait_ms: 0
  }
  const spans: [number, number][] = []
  let used = 0
  transcripts.forEach((t, i) => {
    const marks = decided[i]!
    const inWindow = t.calls.map((c) => c.at >= since && c.at <= until)
    if (!marks.some((m, j) => m.own && inWindow[j])) return
    used += 1
    const fill = <K extends keyof Target>(key: K) => {
      const out: Target[K][] = marks.map((m) => m[key])
      for (let j = out.length - 2; j >= 0; j -= 1) out[j] ??= out[j + 1]!
      for (let j = 1; j < out.length; j += 1) out[j] ??= out[j - 1]!
      return out
    }
    const activities = fill('activity')
    const metas = fill('metas')
    let blocked = false
    t.calls.forEach((call, j) => {
      if (!inWindow[j]) return
      const activity = activities[j] ?? 'other'
      const landed = metas[j]
      if (landed === 'foreign') return
      charge(all, call, activity, 1)
      spans.push([call.at - call.active_ms, call.at])
      if (blocked) charge(blocks.rework, call, activity, 1)
      for (const key of Object.keys(call.events) as (keyof Events)[])
        blocks[key] += call.events[key]
      if (call.failed && call.commands.some((c) => CHECK_COMMAND.test(c))) {
        blocks.failed_checks += 1
        blocked = true
      } else if (call.ok_check) blocked = false
      if (!landed) return charge(unattributed, call, activity, 1)
      // Every included call is this SDD's work, so the Bundle level sums to the total.
      if (!landed.some(([level]) => level === 'Bundle')) landed.push(['Bundle', plans[0]!.bundle])
      for (const level of LEVELS) {
        const ids = [...new Set(landed.filter(([l]) => l === level).map(([, id]) => id))]
        for (const id of ids)
          charge((byLevel[level][id] ??= totals()), call, activity, 1 / ids.length)
      }
    })
  })
  // Wall-clock elapsed is the union of active spans, so parallel subagents are not counted twice.
  spans.sort((a, b) => a[0] - b[0])
  let elapsed = 0
  let end = -Infinity
  for (const [start, stop] of spans) {
    elapsed += Math.max(0, stop - Math.max(start, end))
    end = Math.max(end, stop)
  }
  return {
    protocol: 'create-sdd-usage/v1',
    sdd,
    sdd_sha: documentDigest(readFileSync(sdd, 'utf8')),
    window: {
      since: Number.isFinite(since) ? new Date(since).toISOString() : null,
      until: Number.isFinite(until) ? new Date(until).toISOString() : null
    },
    sources: { transcripts: used, scanned: transcripts.length },
    totals: all,
    elapsed_ms: elapsed,
    metas: byLevel,
    unattributed,
    // Share of calls placed below the Bundle; low when the SDD's steps carry no `touches`.
    coverage: all.calls
      ? Object.values(byLevel.Step).reduce((sum, s) => sum + s.calls, 0) / all.calls
      : 0,
    blocks,
    features: Object.fromEntries(plans.map((plan) => [plan.bundle, plan.features]))
  }
}

/** Round fractional shares in output; the record keeps whole tokens and milliseconds. */
const rounded = (_: string, value: unknown) =>
  typeof value === 'number' ? Math.round(value * 100) / 100 : value

if (import.meta.main) {
  const [command, ...argv] = Bun.argv.slice(2)
  try {
    if (command !== 'harvest') throw new Error(USAGE)
    const options = flags(argv)
    const sdd = options.get('--sdd')
    if (!sdd || !isAbsolute(sdd) || !existsSync(sdd)) throw new Error(USAGE)
    const git = Bun.spawnSync(['git', '-C', dirname(sdd), 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe'
    })
    const repository =
      options.get('--repository') ??
      (git.exitCode === 0 ? git.stdout.toString().trim() : dirname(sdd))
    const time = (key: string) => (options.get(key) ? Date.parse(options.get(key)!) : undefined)
    const output = await harvest(sdd, repository, {
      since: time('--since'),
      until: time('--until'),
      claude: options.get('--claude') ?? join(homedir(), '.claude', 'projects'),
      codex: options.get('--codex') ?? join(homedir(), '.codex', 'sessions')
    })
    if (
      options.has('--record') &&
      process.env.CREATE_SDD_TELEMETRY !== '0' &&
      output.sources.transcripts
    ) {
      const { sdd: _, ...pathFree } = output
      appendFileSync(
        LEDGER,
        `${JSON.stringify({ ts: new Date().toISOString(), ...pathFree }, rounded)}\n`
      )
    }
    console.log(JSON.stringify(output, rounded))
    process.exit(output.sources.transcripts ? 0 : 1)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
