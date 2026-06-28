import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BacklogItem } from './daemon.js';
import { ALL_STEPS } from './steps.js';
import type { StepStatus } from '../types/index.js';

// ── Startup inherited-state dashboard (ADR-013 / FR-1, FR-2, FR-3) ────────────
//
// On startup, BEFORE dispatching, the daemon scans `.worktrees/*/` and the
// `.daemon/processed/` ledger and renders a single grouped dashboard so the
// operator sees, at a glance, what is parked, half-built, eligible, and done.
//
// Precedence (a slug appears in exactly one of the first three groups):
//   HALTED  >  PROCESSED (excluded from IN-PROGRESS)  >  IN-PROGRESS  >  ELIGIBLE
//
// Best-effort: every fs/JSON read is guarded. A per-worktree failure is skipped
// (optionally logged), an empty HALT → reason `unknown`, a malformed
// conduct-state → step `unknown`. The scan NEVER throws out of startup (FR-3).

export interface HaltedEntry {
  slug: string;
  /** First non-empty line of `.pipeline/HALT`, or `unknown` when empty. */
  reason: string;
}

export interface InProgressEntry {
  slug: string;
  /** Last meaningful step from conduct-state, or `unknown` when malformed. */
  step: string;
}

export interface InheritedState {
  halted: HaltedEntry[];
  inProgress: InProgressEntry[];
  eligible: string[];
  processedCount: number;
}

export interface ScanInheritedStateDeps {
  /** Directory holding per-feature worktrees (`<projectRoot>/.worktrees`). */
  worktreeBase: string;
  /** The `.daemon/processed/` ledger directory. */
  processedDir: string;
  /** Backlog discovery (build-ready slugs this scan) — usually `discoverBacklog`. */
  discover: () => Promise<BacklogItem[]>;
  /** Optional log sink for skipped-worktree diagnostics. */
  log?: (msg: string) => void;
}

/** List immediate subdirectory names of `dir`; `[]` when `dir` is absent. */
async function listWorktreeSlugs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // missing `.worktrees/` → zero worktrees (FR-3)
  }
}

/** Count entries in the processed ledger; `0` when the dir is absent. */
async function listProcessedSlugs(processedDir: string): Promise<string[]> {
  try {
    const entries = await readdir(processedDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** First non-empty trimmed line of a HALT marker, or `unknown` when empty. */
function haltReason(content: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return 'unknown';
}

/**
 * The last meaningful step recorded in a conduct-state object: the furthest
 * `in_progress` step, else the furthest `done`/`failed` step (canonical
 * `ALL_STEPS` order). `unknown` when no step has a meaningful status.
 */
function lastMeaningfulStep(state: Record<string, unknown>): string {
  const order = ALL_STEPS.map((s) => s.name);
  const statusOf = (name: string): StepStatus | undefined => {
    const v = state[name];
    return typeof v === 'string' ? (v as StepStatus) : undefined;
  };
  let furthestInProgress: string | null = null;
  let furthestSettled: string | null = null;
  for (const name of order) {
    const s = statusOf(name);
    if (s === 'in_progress') furthestInProgress = name;
    if (s === 'done' || s === 'failed') furthestSettled = name;
  }
  return furthestInProgress ?? furthestSettled ?? 'unknown';
}

/**
 * Scan inherited persisted state into the four dashboard groups. Pure of the
 * render — `renderDashboard` formats the returned struct. Injected `discover`
 * keeps eligibility in lockstep with the live `discoverBacklog`.
 */
export async function scanInheritedState(
  deps: ScanInheritedStateDeps,
): Promise<InheritedState> {
  const processedSlugs = new Set(await listProcessedSlugs(deps.processedDir));
  const slugs = await listWorktreeSlugs(deps.worktreeBase);

  const halted: HaltedEntry[] = [];
  const haltedSlugs = new Set<string>();
  const inProgress: InProgressEntry[] = [];

  for (const slug of slugs) {
    try {
      const wt = join(deps.worktreeBase, slug);
      const haltPath = join(wt, '.pipeline/HALT');
      let haltContent: string | null = null;
      try {
        haltContent = await readFile(haltPath, 'utf-8');
      } catch {
        haltContent = null; // no live HALT marker
      }
      if (haltContent !== null) {
        // HALTED wins over every other group, even with a conduct-state present.
        halted.push({ slug, reason: haltReason(haltContent) });
        haltedSlugs.add(slug);
        continue;
      }

      // PROCESSED wins over IN-PROGRESS: a shipped+stateful worktree is not
      // "in progress" (precedence; FR-2 / story negative path).
      if (processedSlugs.has(slug)) continue;

      let stateRaw: string | null = null;
      try {
        stateRaw = await readFile(join(wt, '.pipeline/conduct-state.json'), 'utf-8');
      } catch {
        stateRaw = null; // no conduct-state → not in-progress
      }
      if (stateRaw === null) continue;

      // Has state, no HALT, not processed → IN-PROGRESS. Malformed JSON still
      // appears, with step `unknown` (FR-3).
      let step = 'unknown';
      try {
        const parsed = JSON.parse(stateRaw) as Record<string, unknown>;
        step = lastMeaningfulStep(parsed);
      } catch {
        step = 'unknown';
      }
      inProgress.push({ slug, step });
    } catch (err) {
      // A per-worktree fs error is isolated: skip it, keep scanning (FR-3).
      deps.log?.(
        `dashboard: skipped worktree ${slug} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // ELIGIBLE: build-ready slugs this scan that are neither halted nor processed.
  let eligible: string[] = [];
  try {
    const backlog = await deps.discover();
    eligible = backlog
      .map((b) => b.slug)
      .filter((slug) => !haltedSlugs.has(slug) && !processedSlugs.has(slug));
  } catch (err) {
    deps.log?.(
      `dashboard: backlog discovery failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  return { halted, inProgress, eligible, processedCount: processedSlugs.size };
}

/**
 * Render the four-group dashboard as a single plain-text block. Each group
 * carries a count; HALTED/IN-PROGRESS list member lines, ELIGIBLE lists slugs,
 * PROCESSED is a count only. Zero-state renders every group at `0`.
 */
export function renderDashboard(state: InheritedState): string {
  const lines: string[] = [];
  lines.push('── inherited state ──────────────────────────────────────────');

  lines.push(`HALTED (${state.halted.length})`);
  for (const h of state.halted) lines.push(`  • ${h.slug} — ${h.reason}`);

  lines.push(`IN-PROGRESS (${state.inProgress.length})`);
  for (const p of state.inProgress) lines.push(`  • ${p.slug} — ${p.step}`);

  lines.push(`ELIGIBLE (${state.eligible.length})`);
  if (state.eligible.length > 0) lines.push(`  ${state.eligible.join(', ')}`);

  lines.push(`PROCESSED (${state.processedCount})`);
  lines.push('─────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
