import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// #788: phase-active marker — mirrors attribution-enforcement.ts's
// build-step-active marker pattern, but carries richer session-hook-visible
// state (current step name, BUILD/SHIP phase, and an .docs allow-list) so a
// write-guard hook can distinguish "docs/spec artifacts changed mid-BUILD"
// (block) from "changed during DECIDE/SHIP, or via an explicitly allowed
// prefix" (permit) without needing IPC into the running engine.

/**
 * Path to the phase-active marker file, relative to `root`.
 * Pure function — does not touch the filesystem.
 */
export function phaseMarkerPath(root: string): string {
  if (!root) {
    throw new Error('phaseMarkerPath requires a non-empty root path');
  }
  return join(root, '.pipeline', 'phase-active');
}

export interface WritePhaseMarkerOptions {
  /** Step name currently dispatched, e.g. "acceptance_specs" or "build". */
  step: string;
  /** Phase bucket the step belongs to. */
  phase: 'BUILD' | 'SHIP' | string;
  /** Path prefixes (relative to repo root) that are exempt from the guard. */
  allow: string[];
}

/**
 * Write the phase-active marker, creating the `.pipeline` directory if
 * necessary. Content is line-oriented (not JSON/YAML) so shell/bash hooks
 * can read it without a parser: `step: <name>`, `phase: <BUILD|SHIP>`,
 * `written: <ISO-8601>`, followed by zero or more `allow: <prefix>` lines.
 */
export function writePhaseMarker(root: string, opts: WritePhaseMarkerOptions, now: Date = new Date()): void {
  const path = phaseMarkerPath(root);
  mkdirSync(join(root, '.pipeline'), { recursive: true });
  const lines = [
    `step: ${opts.step}`,
    `phase: ${opts.phase}`,
    `written: ${now.toISOString()}`,
    ...opts.allow.map((prefix) => `allow: ${prefix}`),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Remove the phase-active marker. Idempotent — does nothing (does not
 * throw) if the marker is already absent.
 */
export function removePhaseMarker(root: string): void {
  const path = phaseMarkerPath(root);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

/**
 * Per-step .docs write-allowlist entries, keyed by step name. Entries here
 * are in ADDITION to `DOCS_WRITE_ALWAYS_ALLOWED`.
 */
export const DOCS_WRITE_ALLOWLIST: Record<string, string[]> = {
  retro: ['.docs/retros/', '.docs/stories/'],
};

/**
 * Path prefixes always exempt from the .docs write-guard, regardless of
 * which step is currently dispatched.
 */
export const DOCS_WRITE_ALWAYS_ALLOWED: string[] = ['.docs/release-waivers/'];

/**
 * Resolve the full .docs write-allowlist for a given step name: the
 * always-allowed prefixes, followed by any step-specific prefixes. Unknown
 * step names resolve to just the always-allowed list.
 */
export function resolveDocsAllowlist(stepName: string): string[] {
  const perStep = DOCS_WRITE_ALLOWLIST[stepName] ?? [];
  return [...DOCS_WRITE_ALWAYS_ALLOWED, ...perStep];
}
