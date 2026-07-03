import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HALT_MARKER } from './halt-marker.js';
import type { BacklogItem } from './daemon.js';
import { ALL_STEPS } from './steps.js';
import type { ComplexityTier, StepStatus } from '../types/index.js';
import type { BlockerVerdict, IssueRef } from './blocker-resolver.js';

// ── Startup inherited-state dashboard (ADR-013 / FR-1, FR-2, FR-3) ────────────
//
// On startup, BEFORE dispatching, the daemon scans `.worktrees/*/` and the
// `.daemon/processed/` ledger and renders a single grouped dashboard so the
// operator sees, at a glance, what is parked, half-built, eligible, and done —
// the full "state of everything" for the repo. Beyond the slug, each row carries
// the bits an operator actually triages on: complexity tier, the step a feature
// reached, and the PR link once one is open.
//
// Precedence (a slug appears in exactly one of the first three groups):
//   HALTED  >  PROCESSED (excluded from IN-PROGRESS)  >  IN-PROGRESS  >  ELIGIBLE
//
// Best-effort: every fs/JSON read is guarded. A per-worktree failure is skipped
// (optionally logged), an empty HALT → reason `unknown`, a malformed
// conduct-state → step `unknown` (and no tier/PR enrichment). The scan NEVER
// throws out of startup (FR-3).

export interface HaltedEntry {
  slug: string;
  /** First non-empty line of `.pipeline/HALT`, or `unknown` when empty. */
  reason: string;
  /** Step the feature reached before halting (from conduct-state), if readable. */
  step?: string;
  /** Engineer-assessed complexity tier, if recorded in conduct-state. */
  tier?: ComplexityTier;
  /** PR opened before the halt (finish runs before some SHIP gates), if any. */
  prUrl?: string;
}

export interface InProgressEntry {
  slug: string;
  /** Last meaningful step from conduct-state, or `unknown` when malformed. */
  step: string;
  /** Engineer-assessed complexity tier, if recorded in conduct-state. */
  tier?: ComplexityTier;
  /** PR opened mid-flight (finish precedes the SHIP gates), if any. */
  prUrl?: string;
}

export interface EligibleEntry {
  slug: string;
  /** Engineer-assessed tier carried on the backlog item, if present. */
  tier?: ComplexityTier;
}

export interface ProcessedEntry {
  slug: string;
  /** PR URL persisted in the ledger when the feature shipped, if any. */
  prUrl?: string;
}

/**
 * A spec held back by an unresolved dependency gate (FR-6). Carries the
 * closed `BlockerVerdict` union so the dashboard can render blockers, cycle
 * members, or an indeterminate reason without re-deriving them.
 */
export interface WaitingEntry {
  slug: string;
  verdict: BlockerVerdict;
}

export interface InheritedState {
  halted: HaltedEntry[];
  inProgress: InProgressEntry[];
  eligible: EligibleEntry[];
  processed: ProcessedEntry[];
  /** Convenience count of `processed` (kept for callers that only need the total). */
  processedCount: number;
  /**
   * Specs waiting on an unresolved dependency (FR-6). Optional for backward
   * compatibility with callers built before this bucket existed; renders as a
   * single WAITING group (not split by verdict kind), with precedence
   * HALTED > PROCESSED > IN-PROGRESS > WAITING > ELIGIBLE.
   */
  waiting?: WaitingEntry[];
}

export interface ScanInheritedStateDeps {
  /** Directory holding per-feature worktrees (`<projectRoot>/.worktrees`). */
  worktreeBase: string;
  /** The `.daemon/processed/` ledger directory. */
  processedDir: string;
  /**
   * Backlog discovery — usually `discoverBacklog`. Returns build-ready
   * `items` alongside `waiting` (specs held back by an unresolved dependency
   * gate, FR-6). A bare-array return (pre-widened callers) is also accepted
   * for backward compatibility and treated as `{ items, waiting: [] }`.
   */
  discover: () => Promise<BacklogItem[] | { items: BacklogItem[]; waiting: WaitingEntry[] }>;
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

/**
 * Read the processed ledger into entries (slug + optional PR url). New ledger
 * files hold JSON (`{ status, prUrl }`); legacy files hold the plain text
 * `shipped` — both parse to an entry, the legacy one simply without a PR.
 * Absent dir → `[]`.
 */
async function readProcessedEntries(processedDir: string): Promise<ProcessedEntry[]> {
  let names: string[];
  try {
    const entries = await readdir(processedDir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
  const out: ProcessedEntry[] = [];
  for (const slug of names) {
    let prUrl: string | undefined;
    try {
      const raw = await readFile(join(processedDir, slug), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'prUrl' in parsed) {
        const v = (parsed as { prUrl?: unknown }).prUrl;
        if (typeof v === 'string' && v.length > 0) prUrl = v;
      }
    } catch {
      // Legacy `shipped` text (or an unreadable file) → no PR enrichment.
    }
    out.push({ slug, prUrl });
  }
  return out;
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

/** Pull the operator-facing extras (tier, PR url) out of a parsed conduct-state. */
function stateExtras(state: Record<string, unknown>): {
  tier?: ComplexityTier;
  prUrl?: string;
} {
  const tier =
    state.complexity_tier === 'S' ||
    state.complexity_tier === 'M' ||
    state.complexity_tier === 'L'
      ? (state.complexity_tier as ComplexityTier)
      : undefined;
  const prUrl =
    typeof state.pr_url === 'string' && state.pr_url.length > 0 ? state.pr_url : undefined;
  return { tier, prUrl };
}

/**
 * Load a worktree's `conduct-state.json`. `present` distinguishes "no file on
 * disk" (skip the worktree) from "file exists but is malformed" (still counts as
 * in-progress, just with no step/tier/PR enrichment) — FR-3.
 */
async function loadWorktreeState(
  wt: string,
): Promise<{ present: boolean; state: Record<string, unknown> | null }> {
  let raw: string;
  try {
    raw = await readFile(join(wt, '.pipeline/conduct-state.json'), 'utf-8');
  } catch {
    return { present: false, state: null }; // no conduct-state on disk
  }
  try {
    return { present: true, state: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return { present: true, state: null }; // malformed JSON
  }
}

/**
 * Scan inherited persisted state into the four dashboard groups. Pure of the
 * render — `renderDashboard` formats the returned struct. Injected `discover`
 * keeps eligibility in lockstep with the live `discoverBacklog`.
 */
export async function scanInheritedState(
  deps: ScanInheritedStateDeps,
): Promise<InheritedState> {
  const processed = await readProcessedEntries(deps.processedDir);
  const processedSlugs = new Set(processed.map((p) => p.slug));
  const slugs = await listWorktreeSlugs(deps.worktreeBase);

  const halted: HaltedEntry[] = [];
  const haltedSlugs = new Set<string>();
  const inProgress: InProgressEntry[] = [];

  for (const slug of slugs) {
    try {
      const wt = join(deps.worktreeBase, slug);
      const haltPath = join(wt, HALT_MARKER);
      let haltContent: string | null = null;
      try {
        haltContent = await readFile(haltPath, 'utf-8');
      } catch {
        haltContent = null; // no live HALT marker
      }
      if (haltContent !== null) {
        // HALTED wins over every other group, even with a conduct-state present.
        // A halted worktree is KEPT for the human, so its conduct-state is still
        // on disk — mine it for the step reached, tier, and any PR already open.
        const entry: HaltedEntry = { slug, reason: haltReason(haltContent) };
        const { state } = await loadWorktreeState(wt);
        if (state) {
          entry.step = lastMeaningfulStep(state);
          const { tier, prUrl } = stateExtras(state);
          if (tier) entry.tier = tier;
          if (prUrl) entry.prUrl = prUrl;
        }
        halted.push(entry);
        haltedSlugs.add(slug);
        continue;
      }

      // PROCESSED wins over IN-PROGRESS: a shipped+stateful worktree is not
      // "in progress" (precedence; FR-2 / story negative path).
      if (processedSlugs.has(slug)) continue;

      const { present, state } = await loadWorktreeState(wt);
      if (!present) continue; // no conduct-state → not in-progress

      // Has state, no HALT, not processed → IN-PROGRESS. Malformed JSON still
      // appears, with step `unknown` and no enrichment (FR-3).
      const entry: InProgressEntry = {
        slug,
        step: state ? lastMeaningfulStep(state) : 'unknown',
      };
      if (state) {
        const { tier, prUrl } = stateExtras(state);
        if (tier) entry.tier = tier;
        if (prUrl) entry.prUrl = prUrl;
      }
      inProgress.push(entry);
    } catch (err) {
      // A per-worktree fs error is isolated: skip it, keep scanning (FR-3).
      deps.log?.(
        `dashboard: skipped worktree ${slug} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  // ELIGIBLE: build-ready items this scan that are neither halted nor processed,
  // carrying their tier so the operator sees the size of what's queued.
  // WAITING: specs held back by an unresolved dependency gate (FR-6) — a
  // bare-array `discover()` (pre-widened callers) yields no waiting items.
  let eligible: EligibleEntry[] = [];
  let waiting: WaitingEntry[] = [];
  try {
    const result = await deps.discover();
    const backlog = Array.isArray(result) ? result : result.items;
    waiting = Array.isArray(result) ? [] : result.waiting;
    eligible = backlog
      .filter((b) => !haltedSlugs.has(b.slug) && !processedSlugs.has(b.slug))
      .map((b) => ({ slug: b.slug, tier: b.tier }));
  } catch (err) {
    deps.log?.(
      `dashboard: backlog discovery failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  return { halted, inProgress, eligible, processed, processedCount: processed.length, waiting };
}

// ── Render helpers ────────────────────────────────────────────────────────────

/** ` [M]` tier tag, or empty when no tier is known. */
function tierTag(tier?: ComplexityTier): string {
  return tier ? ` [${tier}]` : '';
}

/** `  → <url>` PR suffix, or empty when no PR is open. */
function prSuffix(prUrl?: string): string {
  return prUrl ? `  → ${prUrl}` : '';
}

/** `repo#number` formatting for a blocker/cycle-member ref. */
export function refLabel(ref: IssueRef): string {
  return `${ref.repo}#${ref.number}`;
}

/** Verdict-kind-specific detail suffix for a WAITING row. */
export function waitingDetail(verdict: BlockerVerdict): string {
  switch (verdict.kind) {
    case 'blocked':
      return `blocked by ${verdict.blockers.map(refLabel).join(', ')}`;
    case 'cycle':
      return `cycle: ${verdict.members.map(refLabel).join(', ')}`;
    case 'indeterminate':
      return `indeterminate: ${verdict.detail}`;
    case 'unblocked':
      return 'unblocked';
  }
}

/**
 * Render the five-group dashboard as a single plain-text block. Each group
 * carries a count and lists its members with the bits an operator triages on:
 * tier, step, PR link, halt reason. PROCESSED lists each shipped slug with its
 * PR link when one was persisted. WAITING lists each slug held back by an
 * unresolved dependency gate with its blockers/cycle members/indeterminate
 * reason (FR-6) — a single bucket, not split by verdict kind, rendered after
 * IN-PROGRESS and before ELIGIBLE (precedence HALTED > PROCESSED >
 * IN-PROGRESS > WAITING > ELIGIBLE). Omitted entirely when `waiting` is
 * absent or empty. Zero-state renders every present group at `0`.
 */
export function renderDashboard(state: InheritedState): string {
  const lines: string[] = [];
  lines.push('── inherited state ──────────────────────────────────────────');

  lines.push(`HALTED (${state.halted.length})`);
  for (const h of state.halted) {
    const step = h.step ? ` @${h.step}` : '';
    lines.push(`  • ${h.slug}${tierTag(h.tier)}${step} — ${h.reason}${prSuffix(h.prUrl)}`);
  }

  lines.push(`IN-PROGRESS (${state.inProgress.length})`);
  for (const p of state.inProgress) {
    lines.push(`  • ${p.slug}${tierTag(p.tier)} @${p.step}${prSuffix(p.prUrl)}`);
  }

  const waiting = state.waiting ?? [];
  const waitingSlugs = new Set(waiting.map((w) => w.slug));
  if (waiting.length > 0) {
    lines.push(`WAITING (${waiting.length})`);
    for (const w of waiting) {
      lines.push(`  • ${w.slug} — ${waitingDetail(w.verdict)}`);
    }
  }

  // Defensive: a slug should never appear in both ELIGIBLE and WAITING, but
  // if it does, WAITING wins (precedence HALTED > PROCESSED > IN-PROGRESS >
  // WAITING > ELIGIBLE) — filter it out of ELIGIBLE rather than double-list it.
  const eligible = state.eligible.filter((e) => !waitingSlugs.has(e.slug));
  lines.push(`ELIGIBLE (${eligible.length})`);
  for (const e of eligible) lines.push(`  • ${e.slug}${tierTag(e.tier)}`);

  lines.push(`PROCESSED (${state.processedCount})`);
  for (const p of state.processed) lines.push(`  • ${p.slug}${prSuffix(p.prUrl)}`);

  lines.push('─────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
