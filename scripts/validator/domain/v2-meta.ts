import { existsSync } from 'node:fs'
import { isAbsolute, posix, relative, resolve } from 'node:path'
import { buildTasks, type Task } from './v2-tasks.ts'

export type Item = Record<string, unknown>
type Kind = 'Entry' | 'Module' | 'Chunk' | 'Bundle' | 'Asset'
type Meta = Item & { id: string; kind: Kind }
type Leaf = Readonly<{ id: string; path: string; index: Item }>
type Child = Readonly<{ id: string; path: string; depends_on: readonly string[] }>
/** Report one diagnostic family; `subtype` names the specific relation that failed. */
export type Report = (code: string, detail: string, subtype?: string) => void

export type ExecutionSlice = Readonly<{
  bundle: string
  reads: readonly string[]
  chunks: readonly { id: string; source_id: string; steps: readonly string[] }[]
  modules: readonly {
    id: string
    source_id: string
    origin: { document: string; requirement_id: string }
  }[]
  required_assets: readonly { id: string; path: string; version: string; producer: string }[]
  /** `existing` or `new` against the repository; `unknown` when no repository was resolved. */
  produced_assets: readonly {
    id: string
    path: string
    version: string
    status: 'existing' | 'new' | 'unknown'
  }[]
  /** Entries (user stories) touching this Bundle, highest priority first; undeclared priority last. */
  entries: readonly {
    id: string
    priority: string | null
    modules: readonly string[]
    acceptance: readonly string[]
  }[]
  /** Entries of the highest declared priority: the smallest independently acceptable slice. */
  mvp: readonly string[]
  /** Chunk layers by batch dependency, higher-priority Entries first within a layer. */
  waves: readonly (readonly string[])[]
  /** Steps as ordered tasks, with touches, closes and derived parallelism. */
  tasks: readonly Task[]
  /** The smallest ordered task set that closes every acceptance of the MVP Entries. */
  mvp_tasks: readonly string[]
}>

/** A phrase that names an earlier value on purpose ("revision 5 及之前为版本 1", "formerly"). */
export const HISTORICAL =
  /及之前|此前|以前|旧版|formerly|previously|before revision|until revision/i
/** Shared v2 guards: a plain object, a non-blank string, and an array or empty list. */
export const object = (value: unknown): value is Item =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
export const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])
const kinds = new Set<Kind>(['Entry', 'Module', 'Chunk', 'Bundle', 'Asset'])

/** A relation list is a set of stable IDs, never an execution status or prose claim. */
function refs(value: unknown, subtype: string, at: string, report: Report): string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => !text(id)) ||
    new Set(value).size !== value.length
  ) {
    report('SDD_V2_INDEX_SHAPE_INVALID', at, subtype)
    return []
  }
  return value as string[]
}

/** `text` quoted for use inside a regular expression. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether repository-relative `path` is `root` or lies under it. */
export const under = (root: string, path: string) => path === root || path.startsWith(`${root}/`)

/** A repository-relative path: not absolute, no backslash, `..`, bare `.` or glob. */
export const pathForm = (path: string): boolean =>
  !isAbsolute(path) &&
  !path.includes('\\') &&
  !path.split('/').includes('..') &&
  posix.normalize(path) !== '.' &&
  !path.includes('*')

/** Whether `target` lies inside `base` (both canonical). */
export const within = (base: string, target: string): boolean => {
  const rel = relative(base, target)
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

/** IDs grouped by dependency depth: layer 0 depends on nothing, layer n on earlier layers only. */
export function layers(
  ids: readonly string[],
  depends: (id: string) => readonly string[]
): string[][] {
  const depth = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0 // a cycle is reported elsewhere; keep the projection finite
    seen.add(id)
    const deps = depends(id)
    const value = deps.length ? 1 + Math.max(...deps.map((dep) => visit(dep, seen))) : 0
    depth.set(id, value)
    return value
  }
  const result: string[][] = []
  for (const id of ids) (result[visit(id, new Set())] ??= []).push(id)
  return result.filter(Boolean)
}

/** Whether a repository path already exists; `unknown` when no repository was resolved. */
export const pathStatus = (repository: string | null, path: string) =>
  !repository
    ? ('unknown' as const)
    : existsSync(resolve(repository, posix.normalize(path)))
      ? ('existing' as const)
      : ('new' as const)

/** Declared Entry priority `P<n>` as a number, lower first; undeclared sorts last. */
export const rank = (priority: unknown): number =>
  typeof priority === 'string' && /^P[1-9]\d*$/.test(priority)
    ? Number(priority.slice(1))
    : Number.POSITIVE_INFINITY

/**
 * Fill the Meta kinds a one-document leaf leaves out, from relations its index already states.
 *
 * Every requirement that is not a non-goal becomes Module `M:<id>`, every batch Chunk `K:<id>` over
 * the Modules of its requirements, the document Bundle `B:self`, and a missing Entry `E:self`
 * groups every Module. Declared Metas win for their kind, and may reference the derived IDs.
 * Derived IDs have no prose anchor to check: the requirement and batch anchors are their source.
 *
 * A program root passes its children as `sources` (OD-32): `M:<child>:<R>`, `K:<child>:<C>` and
 * `B:<child>` requiring the sibling Assets its `consumes` name; the root still declares Entries.
 */
export function deriveLeafMetas(
  index: Item,
  sources: readonly Readonly<{ owner: string; document: string; index: Item }>[] = [
    { owner: 'self', document: 'self', index }
  ]
): {
  index: Item
  source: 'declared' | 'derived' | 'mixed'
  derived: ReadonlySet<string>
} {
  if (index.metas !== undefined && !Array.isArray(index.metas))
    return { index, source: 'declared', derived: new Set() }
  const declared = list(index.metas).filter(object) as Meta[]
  const added: Meta[] = []
  const derive = (kind: Kind, make: () => Meta[]): Meta[] => {
    const present = declared.filter((meta) => meta.kind === kind)
    if (present.length) return present
    added.push(...make())
    return added.filter((meta) => meta.kind === kind)
  }
  /** A derived Meta; `self` keeps leaf IDs (`M:R1`), a child's carry its name (`M:beta:R1`). */
  const scopedMeta = (kind: Kind, owner: string, id: string, rest: Item) =>
    ({ id: owner === 'self' ? id : id.replace(':', `:${owner}:`), kind, owner, ...rest }) as Meta
  /** Every identified item of `field` across the sources, with the source it came from. */
  const all = (field: string) =>
    sources.flatMap((s) =>
      list(s.index[field]).flatMap((v) => (object(v) && text(v.id) ? [[s, v] as const] : []))
    )
  const modules = derive('Module', () =>
    all('requirements')
      .filter(([, r]) => r.kind !== 'non-goal')
      .map(([{ owner, document }, r]) =>
        scopedMeta('Module', owner, `M:${r.id}`, {
          source_id: r.id,
          origin: { document, requirement_id: r.id }
        })
      )
  )
  const chunks = derive('Chunk', () =>
    all('batches').map(([{ owner }, b]) =>
      scopedMeta('Chunk', owner, `K:${b.id}`, {
        source_id: b.id,
        members: modules
          .filter((m) => m.owner === owner && list(b.requirements).includes(m.source_id))
          .map((m) => m.id)
      })
    )
  )
  const assets = new Map(all('exports').map(([s, x]) => [`${s.owner}/${String(x.id)}`, x.asset]))
  derive('Bundle', () =>
    sources.map(({ owner, index: own }) => ({
      id: `B:${owner}`,
      kind: 'Bundle' as const,
      owner,
      members: chunks.filter((c) => c.owner === owner).map((c) => c.id),
      requires: list(own.consumes).flatMap((c) => {
        const asset = object(c) ? assets.get(`${String(c.document)}/${String(c.export)}`) : null
        return text(asset) ? [asset] : []
      })
    }))
  )
  if (sources[0]?.owner === 'self')
    derive('Entry', () => [{ id: 'E:self', kind: 'Entry', members: modules.map((m) => m.id) }])
  if (!added.length) return { index, source: 'declared', derived: new Set() }
  return {
    index: { ...index, metas: [...list(index.metas), ...added] },
    source: declared.length ? 'mixed' : 'derived',
    derived: new Set(added.map((meta) => meta.id))
  }
}

/** Validate five Meta kinds as a projection of normative leaf IDs, then select one compact slice. */
export function checkV2MetaGraph(
  index: Item,
  rootPath: string | null,
  leaves: ReadonlyMap<string, Leaf>,
  children: readonly Child[],
  repository: string | null,
  canonical: (path: string) => string,
  originSource: (
    owner: string,
    document: string,
    requirementId: string,
    at: string
  ) => string | null,
  report: Report
): ReadonlyMap<string, ExecutionSlice> {
  const raw = list(index.metas)
  if (!Array.isArray(index.metas) || !raw.length)
    report('SDD_V2_REQUIRED_FIELD_EMPTY', rootPath ?? 'self', 'metas-required')
  const metas = new Map<string, Meta>()
  for (const value of raw) {
    if (!object(value) || !text(value.id) || !kinds.has(value.kind as Kind)) {
      report('SDD_V2_INDEX_SHAPE_INVALID', rootPath ?? 'self', 'meta-invalid')
      continue
    }
    if (metas.has(value.id)) report('SDD_V2_ID_DUPLICATE', value.id, 'meta-id-duplicate')
    else metas.set(value.id, value as Meta)
  }
  const ofKind = (kind: Kind): Meta[] => [...metas.values()].filter((meta) => meta.kind === kind)
  for (const kind of ['Entry', 'Module', 'Chunk', 'Bundle'] as const)
    if (!ofKind(kind).length) report('SDD_V2_REQUIRED_FIELD_EMPTY', kind, 'meta-kind-missing')
  const modules = ofKind('Module')
  const chunks = ofKind('Chunk')
  const bundles = ofKind('Bundle')
  const assets = ofKind('Asset')
  const moduleByOrigin = new Map<string, Meta>()
  const moduleBySource = new Map<string, Meta>()
  const resolvedOrigins = new Map<string, string>()
  const chunkByBatch = new Map<string, Meta>()
  const bundleByOwner = new Map<string, Meta>()
  const chunkBundle = new Map<string, string>()
  const entryModules = new Set<string>()
  const assetsByProducer = new Map<string, Meta[]>()
  const assetPaths = new Map<string, string>()
  const leafFor = (owner: unknown, at: string): Leaf | null => {
    if (!text(owner) || !leaves.has(owner)) {
      report('SDD_V2_INDEX_SHAPE_INVALID', at, 'meta-owner-invalid')
      return null
    }
    return leaves.get(owner)!
  }

  for (const entry of ofKind('Entry')) {
    if (entry.priority !== undefined && rank(entry.priority) === Number.POSITIVE_INFINITY)
      report('SDD_V2_INDEX_SHAPE_INVALID', entry.id, 'entry-priority-invalid')
    const members = refs(entry.members, 'entry-members-invalid', entry.id, report)
    if (!members.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', entry.id, 'entry-empty')
    for (const id of members) {
      if (metas.get(id)?.kind !== 'Module')
        report('SDD_V2_REFERENCE_MISSING', `${entry.id} -> ${id}`, 'entry-module-missing')
      else entryModules.add(id)
    }
  }
  for (const module of modules) {
    const leaf = leafFor(module.owner, module.id)
    const origin = module.origin
    if (
      !leaf ||
      !text(module.source_id) ||
      !object(origin) ||
      !text(origin.document) ||
      !text(origin.requirement_id)
    ) {
      report('SDD_V2_INDEX_SHAPE_INVALID', module.id, 'module-origin-invalid')
      continue
    }
    const requirement = list(leaf.index.requirements).find(
      (value) => object(value) && value.id === module.source_id
    )
    if (!object(requirement) || requirement.kind === 'non-goal')
      report('SDD_V2_META_SOURCE_MISMATCH', module.id, 'module-source-missing')
    const sourceKey = JSON.stringify([module.owner, module.source_id])
    if (moduleBySource.has(sourceKey))
      report('SDD_V2_OWNER_CONFLICT', sourceKey, 'module-source-duplicate')
    moduleBySource.set(sourceKey, module)
    const document = originSource(
      module.owner as string,
      origin.document,
      origin.requirement_id,
      module.id
    )
    if (!document) continue
    resolvedOrigins.set(module.id, document)
    const originKey = JSON.stringify([document, origin.requirement_id])
    if (moduleByOrigin.has(originKey))
      report('SDD_V2_OWNER_CONFLICT', originKey, 'module-origin-duplicate')
    moduleByOrigin.set(originKey, module)
  }
  for (const module of modules)
    if (!entryModules.has(module.id))
      report('SDD_V2_COVERAGE_MISSING', module.id, 'module-entry-missing')

  for (const chunk of chunks) {
    const leaf = leafFor(chunk.owner, chunk.id)
    if (!leaf || !text(chunk.source_id)) {
      report('SDD_V2_INDEX_SHAPE_INVALID', chunk.id, 'chunk-source-invalid')
      continue
    }
    const batch = list(leaf.index.batches).find(
      (value) => object(value) && value.id === chunk.source_id
    )
    if (!object(batch)) report('SDD_V2_META_SOURCE_MISMATCH', chunk.id, 'chunk-source-missing')
    const key = `${chunk.owner}:${chunk.source_id}`
    if (chunkByBatch.has(key)) report('SDD_V2_OWNER_CONFLICT', key, 'chunk-source-duplicate')
    chunkByBatch.set(key, chunk)
    const members = refs(chunk.members, 'chunk-members-invalid', chunk.id, report)
    if (!members.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', chunk.id, 'chunk-empty')
    const requirements = new Set(list(object(batch) ? batch.requirements : undefined).filter(text))
    const referenced = new Set<string>()
    for (const id of members) {
      const module = metas.get(id)
      if (module?.kind !== 'Module' || module.owner !== chunk.owner || !object(module.origin)) {
        report('SDD_V2_REFERENCE_MISSING', `${chunk.id} -> ${id}`, 'chunk-module-invalid')
        continue
      }
      if (text(module.source_id)) referenced.add(module.source_id)
    }
    if (
      requirements.size !== referenced.size ||
      [...requirements].some((id) => !referenced.has(id))
    )
      report('SDD_V2_META_SOURCE_MISMATCH', chunk.id, 'chunk-source-diverged')
  }

  for (const bundle of bundles) {
    if (!leafFor(bundle.owner, bundle.id)) continue
    if (bundleByOwner.has(bundle.owner as string))
      report('SDD_V2_OWNER_CONFLICT', String(bundle.owner), 'bundle-owner-duplicate')
    else bundleByOwner.set(bundle.owner as string, bundle)
    const members = refs(bundle.members, 'bundle-members-invalid', bundle.id, report)
    if (!members.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', bundle.id, 'bundle-empty')
    for (const id of members) {
      const chunk = metas.get(id)
      if (chunk?.kind !== 'Chunk' || chunk.owner !== bundle.owner)
        report('SDD_V2_REFERENCE_MISSING', `${bundle.id} -> ${id}`, 'bundle-chunk-invalid')
      else if (chunkBundle.has(id)) report('SDD_V2_OWNER_CONFLICT', id, 'chunk-bundle-duplicate')
      else chunkBundle.set(id, bundle.id)
    }
    for (const id of refs(bundle.requires, 'bundle-requires-invalid', bundle.id, report))
      if (metas.get(id)?.kind !== 'Asset')
        report('SDD_V2_REFERENCE_MISSING', `${bundle.id} -> ${id}`, 'required-asset-missing')
    for (const path of refs(bundle.reads ?? [], 'bundle-reads-invalid', bundle.id, report)) {
      if (!pathForm(path)) {
        report('SDD_V2_PATH_INVALID', `${bundle.id}: ${path}`, 'bundle-read-path-invalid')
        continue
      }
      if (repository) {
        const target = canonical(resolve(repository, path))
        if (!within(repository, target))
          report('SDD_V2_PATH_ESCAPE', `${bundle.id}: ${path}`, 'bundle-read-path-escape')
        // A read names input the host must find, so unlike a write it has to exist already.
        else if (!existsSync(target))
          report('SDD_V2_PATH_NOT_FOUND', `${bundle.id}: ${path}`, 'bundle-read-not-found')
      }
    }
  }
  for (const chunk of chunks)
    if (!chunkBundle.has(chunk.id))
      report('SDD_V2_COVERAGE_MISSING', chunk.id, 'chunk-bundle-missing')
  for (const module of modules)
    if (!chunks.some((chunk) => list(chunk.members).includes(module.id)))
      report('SDD_V2_COVERAGE_MISSING', module.id, 'module-chunk-missing')

  for (const asset of assets) {
    const bundle = text(asset.producer) ? metas.get(asset.producer) : undefined
    const leaf = bundle?.kind === 'Bundle' ? leafFor(bundle.owner, asset.id) : null
    if (!leaf || !text(asset.path) || !text(asset.version)) {
      report('SDD_V2_INDEX_SHAPE_INVALID', asset.id, 'asset-invalid')
      continue
    }
    const path = asset.path
    if (!pathForm(path)) report('SDD_V2_PATH_INVALID', asset.id, 'asset-path-invalid')
    const normalized = posix.normalize(path)
    if (repository) {
      if (!within(repository, canonical(resolve(repository, normalized))))
        report('SDD_V2_PATH_ESCAPE', asset.id, 'asset-path-escape')
    }
    if (
      !list(leaf.index.writes).some(
        (write) =>
          text(write) &&
          (normalized === posix.normalize(write) ||
            normalized.startsWith(`${posix.normalize(write)}/`))
      )
    )
      report('SDD_V2_META_SOURCE_MISMATCH', asset.id, 'asset-outside-write-scope')
    const previous = assetPaths.get(normalized)
    if (previous && previous !== asset.producer)
      report(
        'SDD_V2_OWNER_CONFLICT',
        `${previous}, ${asset.producer}: ${normalized}`,
        'asset-producer-conflict'
      )
    assetPaths.set(normalized, asset.producer as string)
    const cases = refs(asset.acceptance, 'asset-acceptance-invalid', asset.id, report)
    if (!cases.length) report('SDD_V2_REQUIRED_FIELD_EMPTY', asset.id, 'asset-acceptance-required')
    for (const id of cases) {
      if (
        !list(leaf.index.acceptance).includes(id) ||
        !list(leaf.index.requirements).some(
          (value) =>
            object(value) && value.kind !== 'non-goal' && list(value.acceptance).includes(id)
        )
      )
        report('SDD_V2_META_SOURCE_MISMATCH', `${asset.id} -> ${id}`, 'asset-acceptance-unowned')
    }
    assetsByProducer.set(bundle!.id, [...(assetsByProducer.get(bundle!.id) ?? []), asset])
  }

  const byChild = new Map(children.map((child) => [child.id, child]))
  for (const bundle of bundles) {
    const owner = bundle.owner as string
    for (const id of list(bundle.requires).filter(text)) {
      const asset = metas.get(id)
      const producer =
        asset?.kind === 'Asset' && text(asset.producer) ? metas.get(asset.producer) : null
      if (!producer || producer.kind !== 'Bundle' || producer.owner === owner) {
        report(
          'SDD_V2_INTERFACE_MISMATCH',
          `${bundle.id} -> ${id}`,
          'bundle-asset-dependency-invalid'
        )
        continue
      }
      if (rootPath && !byChild.get(owner)?.depends_on.includes(producer.owner as string))
        report(
          'SDD_V2_INTERFACE_MISMATCH',
          `${owner} -> ${String(producer.owner)}`,
          'bundle-dependency-missing'
        )
    }
  }
  for (const [owner, leaf] of leaves) {
    if (!bundleByOwner.has(owner)) report('SDD_V2_COVERAGE_MISSING', owner, 'bundle-missing')
    for (const value of list(leaf.index.requirements)) {
      if (!object(value) || !text(value.id) || value.kind === 'non-goal') continue
      const module = moduleBySource.get(JSON.stringify([owner, value.id]))
      if (!module) {
        report('SDD_V2_COVERAGE_MISSING', `${owner}: ${value.id}`, 'module-coverage-missing')
        continue
      }
      if (value.kind !== 'must-ship') continue
      const relatedChunks = chunks.filter(
        (chunk) => chunk.owner === owner && list(chunk.members).includes(module.id)
      )
      const route = relatedChunks.some((chunk) => {
        const batch = list(leaf.index.batches).find(
          (item) => object(item) && item.id === chunk.source_id
        )
        return (
          object(batch) &&
          list(batch.steps).some((step) => list(value.implementation).includes(step)) &&
          chunkBundle.get(chunk.id) === bundleByOwner.get(owner)?.id
        )
      })
      if (!route) report('SDD_V2_MUST_SHIP_CHAIN_INCOMPLETE', `${owner}: ${value.id}`, 'meta-chain')
    }
    for (const batch of list(leaf.index.batches))
      if (object(batch) && text(batch.id) && !chunkByBatch.has(`${owner}:${batch.id}`))
        report('SDD_V2_COVERAGE_MISSING', `${owner}: ${batch.id}`, 'chunk-coverage-missing')
    for (const exported of list(leaf.index.exports)) {
      if (!object(exported) || !text(exported.asset)) continue
      const asset = metas.get(exported.asset)
      const producer =
        asset?.kind === 'Asset' && text(asset.producer) ? metas.get(asset.producer) : null
      if (
        !asset ||
        asset.kind !== 'Asset' ||
        producer?.owner !== owner ||
        asset.version !== exported.version
      )
        report(
          'SDD_V2_META_SOURCE_MISMATCH',
          `${owner}: ${String(exported.id)}`,
          'export-asset-mismatch'
        )
    }
    for (const consumed of list(leaf.index.consumes)) {
      if (!object(consumed) || !text(consumed.document) || !text(consumed.export)) continue
      const provider = leaves.get(consumed.document)
      const exported = list(provider?.index.exports).find(
        (value) => object(value) && value.id === consumed.export
      )
      const bundle = bundleByOwner.get(owner)
      if (
        !object(exported) ||
        !text(exported.asset) ||
        !list(bundle?.requires).includes(exported.asset)
      )
        report(
          'SDD_V2_INTERFACE_MISMATCH',
          `${owner}: ${consumed.document}/${consumed.export}`,
          'consumer-asset-dependency-missing'
        )
    }
  }

  const slices = new Map<string, ExecutionSlice>()
  for (const [owner, bundle] of bundleByOwner) {
    const leaf = leaves.get(owner)!
    const ownedChunks = list(bundle.members).flatMap((id) => {
      const chunk = text(id) ? metas.get(id) : null
      if (!chunk || chunk.kind !== 'Chunk' || !text(chunk.source_id)) return []
      const batch = list(leaf.index.batches).find(
        (value) => object(value) && value.id === chunk.source_id
      )
      return [
        {
          id: chunk.id,
          source_id: chunk.source_id,
          steps: list(object(batch) ? batch.steps : []).filter(text)
        }
      ]
    })
    const ownedModules = new Map<string, ExecutionSlice['modules'][number]>()
    for (const chunk of ownedChunks) {
      const meta = metas.get(chunk.id)!
      for (const id of list(meta.members)) {
        const module = text(id) ? metas.get(id) : null
        if (
          module?.kind === 'Module' &&
          text(module.source_id) &&
          object(module.origin) &&
          text(module.origin.requirement_id) &&
          resolvedOrigins.has(module.id)
        )
          ownedModules.set(module.id, {
            id: module.id,
            source_id: module.source_id,
            origin: {
              document: resolvedOrigins.get(module.id)!,
              requirement_id: module.origin.requirement_id
            }
          })
      }
    }
    const required_assets = list(bundle.requires).flatMap((id) => {
      const asset = text(id) ? metas.get(id) : null
      const producer =
        asset?.kind === 'Asset' && text(asset.producer) ? metas.get(asset.producer) : null
      return asset?.kind === 'Asset' &&
        text(asset.path) &&
        text(asset.version) &&
        producer?.kind === 'Bundle'
        ? [
            {
              id: asset.id,
              path: asset.path,
              version: asset.version,
              producer: String(producer.owner)
            }
          ]
        : []
    })
    const produced_assets = (assetsByProducer.get(bundle.id) ?? []).flatMap((asset) =>
      text(asset.path) && text(asset.version)
        ? [
            {
              id: asset.id,
              path: asset.path,
              version: asset.version,
              status: pathStatus(repository, asset.path)
            }
          ]
        : []
    )
    // Entries are the user stories this Bundle serves; their priority orders MVP and waves.
    const requirementById = new Map(
      list(leaf.index.requirements).flatMap((r) => (object(r) && text(r.id) ? [[r.id, r]] : []))
    )
    const entries = ofKind('Entry')
      .map((entry) => {
        const modules = list(entry.members).filter((id): id is string =>
          ownedModules.has(id as string)
        )
        const acceptance = modules.flatMap((id) =>
          list(requirementById.get(ownedModules.get(id)!.source_id)?.acceptance).filter(text)
        )
        const priority = rank(entry.priority) < Infinity ? (entry.priority as string) : null
        return { id: entry.id, priority, modules, acceptance: [...new Set(acceptance)] }
      })
      .filter((entry) => entry.modules.length)
      .sort((a, b) => rank(a.priority) - rank(b.priority))
    const top = rank(entries[0]?.priority)
    const mvp =
      top < Infinity ? entries.filter((e) => rank(e.priority) === top).map((e) => e.id) : []
    const chunkRank = (id: string) => {
      const members = new Set(list(metas.get(id)?.members))
      return Math.min(
        ...entries.filter((e) => e.modules.some((m) => members.has(m))).map((e) => rank(e.priority))
      )
    }
    const chunkByBatchId = new Map(ownedChunks.map((chunk) => [chunk.source_id, chunk.id]))
    const waves = layers(
      ownedChunks.map((chunk) => chunk.id),
      (id) => {
        const batch = list(leaf.index.batches).find(
          (value) => object(value) && value.id === metas.get(id)?.source_id
        )
        return list(object(batch) ? batch.depends_on : []).flatMap((dep) =>
          text(dep) && chunkByBatchId.has(dep) ? [chunkByBatchId.get(dep)!] : []
        )
      }
    )
    for (const wave of waves) wave.sort((a, b) => chunkRank(a) - chunkRank(b))
    slices.set(owner, {
      bundle: bundle.id,
      reads: list(bundle.reads).filter(text),
      chunks: ownedChunks,
      modules: [...ownedModules.values()],
      required_assets,
      produced_assets,
      entries,
      mvp,
      waves,
      ...buildTasks(
        leaf.index,
        ownedChunks,
        waves,
        entries,
        (id) => new Set(list(metas.get(id)?.members).filter(text)),
        mvp,
        repository
      )
    })
  }
  return slices
}
