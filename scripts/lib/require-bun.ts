/**
 * Imported first by CLI entry points. The scripts use bun APIs throughout (import.meta.dir,
 * Bun.argv, Bun.spawnSync); under node or tsx they crash part-way through their imports, so this
 * module, evaluated before the others, says how to run them instead (OD-53).
 */
if (typeof Bun === 'undefined') {
  console.error('create-sdd scripts run under bun: bun <create-sdd-root>/scripts/<script>.ts …')
  process.exit(2)
}
