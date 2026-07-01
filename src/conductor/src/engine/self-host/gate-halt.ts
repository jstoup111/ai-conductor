// self-host/gate-halt.ts — shared HALT plumbing for the self-host finish gates.
//
// The version + release-artifact gates run in the daemon's `auto` mode where
// there is no human to prompt (adr-2026-06-30-halt-based-release-gates). A gate
// that cannot self-satisfy writes `.pipeline/HALT` and the finish flow stops
// BEFORE opening a PR — the feature parks until the operator resumes. Each gate
// supplies its own distinct first-line reason (the daemon dashboard surfaces the
// first non-empty line), so the operator sees exactly which gate parked the
// build. ADR-005/ADR-010 invariant: the daemon never merges — every self-build
// ends at a HALT for the operator to re-install, `/verify`, and merge.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The park-for-human marker the daemon loop already treats as a stop. */
export const HALT_MARKER = '.pipeline/HALT';

/** A gate outcome: pass, or fail with a distinct, operator-facing reason. */
export type GateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Park the self-build for the operator. `reason` becomes the first line (the
 * dashboard reason); a shared resume procedure follows. Best-effort writes
 * (mkdir/write failures are swallowed) mirror the rebase writeHalt contract —
 * the HALT is a signal, never itself a hard failure.
 */
export async function writeSelfHostHalt(projectRoot: string, reason: string): Promise<void> {
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
  const body =
    `${reason}\n\n` +
    `Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).\n` +
    `Resume procedure:\n` +
    `  1. Address the gate reason above.\n` +
    `  2. Re-install the harness (bin/install --update) and run /verify.\n` +
    `  3. rm .pipeline/HALT, then merge the PR yourself.\n`;
  await writeFile(join(projectRoot, HALT_MARKER), body, 'utf-8').catch(() => {});
}

/** First non-empty, trimmed line of a text blob, or null when there is none. */
export function firstNonEmptyLine(text: string | null | undefined): string | null {
  if (text == null) return null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t !== '') return t;
  }
  return null;
}
