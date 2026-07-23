/**
 * Per-feature cost rollup: aggregates token usage, dispatch/retry/halt
 * counts, and unmetered-dispatch tracking from a worktree's
 * `.pipeline/events.jsonl`.
 *
 * Pure/read-only — no side effects, no writes. Tolerates a missing file
 * (returns all-zero rollup) and tolerates corrupt/unparseable lines
 * (skipped, folded into `unmetered.count` so the gap stays visible).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CostRollup {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  costUsd: number;
  dispatches: number;
  retries: number;
  halts: number;
  unmetered: { count: number; durationMs: number };
}

function zeroRollup(): CostRollup {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    costUsd: 0,
    dispatches: 0,
    retries: 0,
    halts: 0,
    unmetered: { count: 0, durationMs: 0 },
  };
}

export async function computeCostRollup(worktreeDir: string): Promise<CostRollup> {
  const rollup = zeroRollup();
  const eventsPath = join(worktreeDir, '.pipeline', 'events.jsonl');

  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf-8');
  } catch {
    return rollup;
  }

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      rollup.unmetered.count += 1;
      continue;
    }

    if (typeof event !== 'object' || event === null || !('type' in event)) {
      rollup.unmetered.count += 1;
      continue;
    }

    const e = event as Record<string, unknown>;

    if (e.type === 'step_completed') {
      rollup.dispatches += 1;
      const tokenUsage = e.tokenUsage as Record<string, unknown> | undefined;
      const isUnmetered = e.unmetered === true || !tokenUsage;

      if (tokenUsage) {
        rollup.tokens.input += Number(tokenUsage.input) || 0;
        rollup.tokens.output += Number(tokenUsage.output) || 0;
        rollup.tokens.cacheRead += Number(tokenUsage.cacheRead) || 0;
        rollup.tokens.cacheCreation += Number(tokenUsage.cacheCreation) || 0;
        rollup.costUsd += Number(tokenUsage.costUsd) || 0;
      }

      if (isUnmetered) {
        rollup.unmetered.count += 1;
        rollup.unmetered.durationMs += Number(tokenUsage?.durationMs) || 0;
      }
      continue;
    }

    if (e.type === 'step_retry') {
      rollup.retries += 1;
      continue;
    }

    if (e.type === 'loop_halt') {
      rollup.halts += 1;
      continue;
    }
  }

  return rollup;
}
