import { readFile } from 'fs/promises';
import { join } from 'path';
import type { HarnessConfig } from '../types/config.js';

/**
 * Resolve the audit sample percentage from config. Returns the configured value
 * if present and valid, or the default (10) if absent. The config parsing
 * already validates and clamps this value at load time, so this function
 * is safe to call without additional validation.
 */
export function resolveAttributionAuditSamplePct(config: HarnessConfig): number {
  return config.attribution_audit_sample_pct ?? 10;
}

/**
 * Path to the advisory dispatch telemetry written by the session PRE hook.
 */
export function dispatchCountPath(root: string): string {
  return join(root, '.pipeline', 'dispatch-count');
}

/**
 * Parsed breakdown of `.pipeline/dispatch-count`: how many recorded
 * dispatches carried a real task id ("Task: <id>") versus were unattributed
 * ("Task: none"), plus the attributed task ids in file order. Malformed
 * lines (matching neither form) are ignored — not counted in either bucket,
 * never thrown on. Absent/empty file yields all zeros / an empty array.
 */
export interface DispatchAttribution {
  attributed: number;
  unattributed: number;
  taskIds: string[];
}

export async function readDispatchAttribution(root: string): Promise<DispatchAttribution> {
  let raw: string;
  try {
    raw = await readFile(dispatchCountPath(root), 'utf8');
  } catch {
    return { attributed: 0, unattributed: 0, taskIds: [] };
  }
  let attributed = 0;
  let unattributed = 0;
  const taskIds: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(/^Task:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value === 'none') {
      unattributed++;
    } else if (value.length > 0) {
      attributed++;
      taskIds.push(value);
    }
  }
  return { attributed, unattributed, taskIds };
}

// Unattributed-dispatch detection is advisory telemetry only. A count-based
// threshold keeps the signal useful in mixed dispatch cycles.

export interface UnattributedDispatchResult {
  triggered: true;
  reason: 'unattributed_dispatch';
  unattributedCount: number;
}

/**
 * Detect an unattributed-dispatch streak within a single build cycle's
 * `DispatchAttribution`. Triggers when `unattributed` is nonzero and meets
 * or exceeds `threshold` (default 3). Returns `null` when quiet (no
 * dispatch activity at all, or below threshold).
 */
export function detectUnattributedDispatch(
  attribution: DispatchAttribution,
  threshold = 3,
): UnattributedDispatchResult | null {
  const { unattributed } = attribution;
  if (unattributed <= 0) return null;
  if (unattributed < threshold) return null;
  return { triggered: true, reason: 'unattributed_dispatch', unattributedCount: unattributed };
}
