#!/usr/bin/env bun
import { growthOver, measure } from './rsi.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Hold the skill to the ceilings it set for itself.
 *
 * This skill's history is thirteen commits of +14000/-730, and nothing was measuring that. The
 * ceilings are the measurement made blocking: they say nothing about whether a line is good, only
 * that growth past a recorded number is a decision somebody has to make in a `--kind budget-change`
 * round rather than a drift nobody sees.
 */
const ROOT = join(import.meta.dir, '..')
const BUDGET = join(ROOT, 'rsi', 'budget.json')

const ceilings: Record<string, number> = existsSync(BUDGET)
  ? ((JSON.parse(readFileSync(BUDGET, 'utf8')) as { ceilings?: Record<string, number> }).ceilings ??
    {})
  : {}
const measured = measure()
const over = Object.entries(ceilings)
  .filter(([dimension, limit]) => (measured[dimension] ?? 0) > limit)
  .map(([dimension, limit]) => ({ dimension, ceiling: limit, measured: measured[dimension] ?? 0 }))
// Raised ceilings cannot hide cumulative growth: past the window only a consolidation helps.
const grown = growthOver(measured)

console.log(
  JSON.stringify({
    protocol: 'create-sdd-budget/v1',
    valid: over.length === 0 && grown.length === 0,
    measured,
    ceilings,
    over,
    over_growth: grown,
    hint: grown.length
      ? 'growth window exceeded: run a rsi.ts open --kind consolidation round'
      : over.length
        ? 'raise it in a rsi.ts open --kind budget-change round, with the reason'
        : undefined
  })
)
process.exit(over.length || grown.length ? 1 : 0)
