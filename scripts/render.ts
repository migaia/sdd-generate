#!/usr/bin/env bun
/**
 * Write the generated regions of an SDD from its contract JSON (OD-65 item 2: one source per fact):
 *
 *   bun scripts/render.ts --sdd <abs SDD> [--check]
 *
 * A region is `<!-- sdd-generated:exports|preserve|gates -->` … `<!-- /sdd-generated:NAME -->`;
 * only regions already in the document are rewritten, nothing is inserted. `--check` writes nothing
 * and exits 1 when a region differs from what the contract renders. Exit 2 on usage errors.
 */
import './lib/require-bun.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { contractBlock } from './lib/contract-source.ts'
import { renderRegions } from './validator/domain/v2-render.ts'

const argv = Bun.argv.slice(2)
const sdd = argv.includes('--sdd') ? argv[argv.indexOf('--sdd') + 1] : undefined
if (!sdd || !isAbsolute(sdd)) {
  console.error('usage: render.ts --sdd <abs SDD> [--check]')
  process.exit(2)
}
const documentText = readFileSync(sdd, 'utf8')
const index = contractBlock(documentText).value
if (!index) {
  console.error(`RENDER_CONTRACT_REQUIRED: ${sdd} has no sdd-contract block`)
  process.exit(2)
}
const rendered = renderRegions(documentText, index)
const changed = rendered !== documentText
if (!argv.includes('--check') && changed) writeFileSync(sdd, rendered)
console.log(
  JSON.stringify({
    protocol: 'create-sdd-render/v1',
    sdd,
    changed,
    written: changed && !argv.includes('--check')
  })
)
process.exit(argv.includes('--check') && changed ? 1 : 0)
