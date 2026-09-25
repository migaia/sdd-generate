#!/usr/bin/env node
/**
 * Package-runner entry for the installer, so the skill installs the same way from any of them:
 *
 *   npx @migaia/sdd-generate --host claude --host codex
 *   pnpm dlx @migaia/sdd-generate --host claude
 *   bunx @migaia/sdd-generate --host claude
 *   aubx @migaia/sdd-generate --host claude           (aube)
 *   npx github:migaia/sdd-generate --host claude   (no registry release needed)
 *
 * It forwards every argument to the bundled install.sh, which stays the only installer: one
 * agent table, one clone in ~/.create-sdd, the same links. It needs bash and git, like the curl
 * install; Windows users run it from WSL or Git Bash.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'install.sh')
const result = spawnSync('bash', [script, ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error) {
  console.error(
    `error: could not run bash (${result.error.message}); install bash and git, or use WSL / Git Bash on Windows`
  )
  process.exit(1)
}
process.exit(result.status ?? 1)
