// `conduct kpi` — CLI surface for the read-only per-feature token/cost KPI
// report (plan Task 7). Mirrors the evidence-cli/task-cli dispatch pattern.

import { renderKpi } from './kpi-report.js';

export type KpiDispatch = { kind: 'report' };

/**
 * Parse argv for the `kpi` subcommand.
 *   conduct kpi → {kind:'report'}
 *   (any other sub) → null
 */
export function detectKpiCommand(argv: string[]): KpiDispatch | null {
  const sub = argv[2];
  if (sub !== 'kpi') return null;
  return { kind: 'report' };
}

export interface KpiDispatchDeps {
  print?: (msg: string) => void;
  cwd?: string;
}

/**
 * Dispatch the `kpi` subcommand. Always exits 0 — this is a read-only report
 * over committed shipped records; a missing/empty `.docs/shipped` prints a
 * friendly message rather than an error, and `renderKpi` itself never
 * throws on malformed records.
 */
export async function dispatchKpi(
  _cmd: KpiDispatch,
  deps: KpiDispatchDeps = {},
): Promise<number> {
  const { print = console.log, cwd = process.cwd() } = deps;
  const report = await renderKpi(cwd);
  print(report);
  return 0;
}
