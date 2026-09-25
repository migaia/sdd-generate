import { list, object, text, type Item, type Report } from './v2-meta.ts'
import { preflightItems } from './v2-preflight.ts'

/**
 * One source per contract fact (item 2 of OD-65). Export versions and fingerprints, the preserve
 * list and the gate commands live in the contract JSON. Prose either shows them inside a generated
 * region that `scripts/render.ts` writes from the JSON, or names them by ID only. A copy anywhere
 * else is a second authority that can go stale, and each copy stopped a delivery once.
 */

/** The facts a region can render. */
export const REGIONS = ['exports', 'preserve', 'gates'] as const
export type Region = (typeof REGIONS)[number]

/** `<!-- sdd-generated:exports -->` … `<!-- /sdd-generated:exports -->`, content captured. */
const REGION = /<!--\s*sdd-generated:(\w+)\s*-->\n?([\s\S]*?)\n?<!--\s*\/sdd-generated:\1\s*-->/g

/** The generated content of one region, from the contract. */
export function render(index: Item, region: Region): string {
  if (region === 'exports') {
    const rows = [
      ...list(index.exports)
        .filter(object)
        .map(
          (e) =>
            `| export | \`${String(e.id)}\` | ${String(e.version ?? '')} | \`${String(e.fingerprint ?? '')}\` |`
        ),
      ...list(index.consumes)
        .filter(object)
        .map(
          (c) =>
            `| consumes | \`${String(c.document)}/${String(c.export)}\` | ${String(c.version ?? '')} | \`${String(c.fingerprint ?? '')}\` |`
        )
    ]
    return [
      '| Direction | Interface | Version | Fingerprint |',
      '| --- | --- | --- | --- |',
      ...rows
    ].join('\n')
  }
  if (region === 'preserve') {
    const ids = list(index.preserve).filter(text)
    return ids.length ? `Preserve acceptance: ${ids.join(', ')}.` : 'No preserve acceptance.'
  }
  return preflightItems(index)
    .filter((item) => item.gate)
    .map((item) => `- ${item.id}: \`${item.command}\``)
    .join('\n')
}

/** Replace every region's content with what the contract renders; unknown regions are kept. */
export function renderRegions(documentText: string, index: Item): string {
  return documentText.replace(REGION, (whole, name: string) =>
    (REGIONS as readonly string[]).includes(name)
      ? `<!-- sdd-generated:${name} -->\n${render(index, name as Region)}\n<!-- /sdd-generated:${name} -->`
      : whole
  )
}

/** Prose with every generated region blanked, keeping line positions, for restatement checks. */
export const withoutRegions = (body: string) =>
  body.replace(REGION, (whole) => whole.replace(/[^\n]/g, ''))

/** A phrase that names an earlier value on purpose ("revision 5 及之前为版本 1", "formerly"). */
const HISTORICAL = /及之前|此前|以前|旧版|formerly|previously|before revision|until revision/i
/** A version token right after an interface name. */
const VERSION_AFTER = /^[^|\n]{0,30}?(?:\bv|\bversion\s*|版本\s*)\d+\b/i
/** A prose preserve list ("Preserve acceptance: A3, A7", "保持验收：A3、A7"), not "无保持验收". */
const PRESERVE_LIST = /(?:保持验收|preserve acceptance)\s*[:：]\s*A[\w-]*\d/i

/**
 * Check the leaf's prose (history sections and generated regions already removed by the caller for
 * restatements; regions read from the full text for staleness):
 * - SDD_V2_GENERATED_STALE: a region's content differs from what the contract renders;
 * - SDD_V2_CONTRACT_FIELD_RESTATED: an export or consumed interface followed by a version, a
 *   contract fingerprint, a preserve list, or a gate item's command outside a region.
 */
export function checkSingleSource(
  index: Item,
  documentText: string,
  claimBody: string,
  path: string,
  report: Report
): void {
  for (const [, name, content] of documentText.matchAll(REGION))
    if (
      (REGIONS as readonly string[]).includes(name!) &&
      content!.trim() !== render(index, name as Region).trim()
    )
      report(
        'SDD_V2_GENERATED_STALE',
        `${path}: ${name}: run bun <create-sdd-root>/scripts/render.ts --sdd ${path}`
      )
  const interfaces = [
    ...list(index.exports)
      .filter(object)
      .map((e) => String(e.id)),
    ...list(index.consumes)
      .filter(object)
      .map((c) => String(c.export))
  ].filter(Boolean)
  const fingerprints = [
    ...list(index.exports)
      .filter(object)
      .map((e) => e.fingerprint),
    ...list(index.consumes)
      .filter(object)
      .map((c) => c.fingerprint)
  ].filter(text)
  const commands = preflightItems(index).map((item) => item.command)
  const restated: string[] = []
  for (const line of withoutRegions(claimBody).split('\n'))
    for (const segment of line.split(/[()（）;；。]/)) {
      if (HISTORICAL.test(segment)) continue
      for (const id of interfaces) {
        const name = new RegExp(`(?<![\\w-])\`?${id.replace(/-/g, '\\-')}\`?(?![\\w-])`, 'g')
        for (const match of segment.matchAll(name))
          if (VERSION_AFTER.test(segment.slice(match.index! + match[0].length)))
            restated.push(`${id} version ("${segment.trim().slice(0, 60)}")`)
      }
      for (const print of fingerprints)
        if (segment.includes(print)) restated.push(`fingerprint ${print}`)
      if (PRESERVE_LIST.test(segment))
        restated.push(`preserve list ("${segment.trim().slice(0, 60)}")`)
      for (const command of commands)
        if (segment.includes(`\`${command}\``)) restated.push(`gate command \`${command}\``)
    }
  if (restated.length)
    report(
      'SDD_V2_CONTRACT_FIELD_RESTATED',
      `${path}: ${[...new Set(restated)].join('; ')}: name the ID only, or place a <!-- sdd-generated:exports|preserve|gates --> region and run render.ts`
    )
}
