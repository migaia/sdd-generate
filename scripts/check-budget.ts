#!/usr/bin/env bun
import { budgetLimits, measure, overBudget } from './rsi.ts'

/**
 * Hold the skill to the size limits `rsi.ts budgetLimits` derives.
 *
 * This skill's history is thirteen commits of +14000/-730, and nothing was measuring that. The
 * limits are the measurement made blocking: they say nothing about whether a line is good, only
 * that growth past a recorded number is a decision somebody has to make in a `--kind budget-change`
 * round rather than a drift nobody sees.
 */
const measured = measure()
const over = overBudget(measured)

console.log(
  JSON.stringify({
    protocol: 'create-sdd-budget/v1',
    valid: over.length === 0,
    measured,
    limits: budgetLimits(),
    over,
    hint: over.length
      ? 'pay it back in a rsi.ts consolidation round, or raise it in a budget-change round with the reason'
      : undefined
  })
)
process.exit(over.length ? 1 : 0)
