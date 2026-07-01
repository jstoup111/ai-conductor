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

import { HALT_MARKER, writeHaltMarker } from '../halt-marker.js';

/** Re-exported from the canonical marker module for existing importers. */
export { HALT_MARKER };

/** A gate outcome: pass, or fail with a distinct, operator-facing reason. */
export type GateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Park the self-build for the operator. `reason` becomes the first line (the
 * dashboard reason); a shared resume procedure follows. Delegates the
 * best-effort marker write to `writeHaltMarker` — the HALT is a signal, never
 * itself a hard failure.
 */
export async function writeSelfHostHalt(projectRoot: string, reason: string): Promise<void> {
  const body =
    `${reason}\n\n` +
    `Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).\n` +
    `Resume procedure:\n` +
    `  1. Address the gate reason above.\n` +
    `  2. Re-install the harness (bin/install --update) and run /verify.\n` +
    `  3. rm .pipeline/HALT, then merge the PR yourself.\n`;
  await writeHaltMarker(projectRoot, body);
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
