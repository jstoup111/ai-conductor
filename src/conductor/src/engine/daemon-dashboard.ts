import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HALT_MARKER } from './halt-marker.js';
import type { BacklogItem } from './daemon.js';
import { ALL_STEPS } from './steps.js';
import type { ComplexityTier, StepStatus } from '../types/index.js';
import type { BlockerVerdict, IssueRef } from './blocker-resolver.js';
import type { PriorityBand, PriorityResolution } from './backlog-priority.js';
import type { GatedItem } from './daemon-backlog.js';
import {
  classifyHeartbeatAge,
  formatHeartbeatAge,
  heartbeatBelongsToDispatch,
  readStepHeartbeat,
} from './step-heartbeat.js';
import { readFullSuiteEvidence } from './full-suite-evidence.js';
import { computeBuildReviewMetrics, readMergedFeatureEvents } from './build-tail-rollup.js';

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
  /** Provider lifecycle evidence when this halt exhausted preparation recovery. */
  lifecycle?: ProviderLifecycleDiagnostic;
}

/** Lifecycle evidence surfaced from the feature's persisted provider events. */
export interface ProviderLifecycleDiagnostic {
  phase: 'preparing' | 'running' | 'recovering' | 'halted';
  attemptId: string;
  recoveryCount: number;
  reason?: 'preparation-timeout' | 'preparation-timeout-exhausted';
}

export interface InProgressEntry {
  slug: string;
  /** Last meaningful step from conduct-state, or `unknown` when malformed. */
  step: string;
  /** Engineer-assessed complexity tier, if recorded in conduct-state. */
  tier?: ComplexityTier;
  /** PR opened mid-flight (finish precedes the SHIP gates), if any. */
  prUrl?: string;
  /**
   * Age (ms) of `.pipeline/step-heartbeat` at scan time, if the worktree has
   * one. `undefined` when no heartbeat file exists yet — distinct from a
   * present-but-stale heartbeat, so a step that hasn't produced its first
   * activity pulse never renders as "stalled" (see `step-heartbeat.ts`).
   */
  heartbeatAgeMs?: number;
  /** Elapsed time since the current dispatch's `step_started` event. */
  elapsedStepTimeMs?: number;
  /** Latest live provider observation from the current dispatch only. */
  providerStreamProgress?: import('../execution/llm-provider.js').ProviderStreamObservation;
  /** Most recent validated aggregate test outcome, when run evidence exists. */
  lastTestOutcome?: 'PASS' | 'FAIL';
  /**
   * `working` is backed by fresh telemetry from this dispatch; `waiting` is
   * backed by a returned dispatch whose completion gate remains unsatisfied.
   * Undefined deliberately means neither conclusion is supported yet.
   */
  activityState?: 'working' | 'waiting';
  /** Latest RED-evidence lifecycle state from the current dispatch's ledger. */
  acceptanceRedState?: 'required' | 'pending' | 'satisfied' | 'rejected';
  /** Completion predicate's exact unmet-condition reason, when it supplied one. */
  completionCondition?: string;
  /** Current provider preparation/running/recovery phase, if persisted. */
  lifecycle?: ProviderLifecycleDiagnostic;
}

/** A dashboard observation needs only a short current-activity window. */
const DASHBOARD_HEARTBEAT_FRESH_MS = 60_000;

export interface EligibleEntry {
  slug: string;
  /** Engineer-assessed tier carried on the backlog item, if present. */
  tier?: ComplexityTier;
  /** Priority band assigned by the priority resolver (banded mode only). */
  band?: PriorityBand;
}

export interface ProcessedEntry {
  slug: string;
  /** PR URL persisted in the ledger when the feature shipped, if any. */
  prUrl?: string;
}

export interface RetainedWorktreeEntry {
  slug: string;
  /** PR URL recorded in the processed ledger, when available. */
  prUrl?: string;
  /**
   * `pr-open-awaiting-main` — a verified ship whose PR has not yet merged to
   * `origin/main` (the `.daemon/processed/` ledger names it).
   * `pr-closed-unmerged` — the PR closed without merging, but the worktree's
   * pipeline had already reached a completed run (`.pipeline/DONE` present)
   * before that happened, so the stale `.pipeline/HALT` left behind is not a
   * live block — it is surfaced as reclaimable (Story S3/S5).
   * `shipped-no-pr-reference` — the processed ledger proves a ship, but its
   * legacy entry contains no PR URL, so no PR state can be asserted.
   * `pr-state-unknown` — the processed ledger records a PR URL, but no
   * injected probe established whether that PR remains open.
   */
  reason:
    | 'pr-open-awaiting-main'
    | 'pr-closed-unmerged'
    | 'shipped-no-pr-reference'
    | 'pr-state-unknown';
}

/** A PR-state observation, including the PR identity the adapter actually resolved. */
export interface PrStateProbeResult {
  prUrl: string;
  state: 'open' | 'closed';
}

/** Optional PR-state lookup injected by the CLI; the dashboard never performs I/O itself. */
export type PrStateProbe = (prUrl: string) => Promise<PrStateProbeResult | undefined>;

/**
 * A spec held back by an unresolved dependency gate (FR-6). Carries the
 * closed `BlockerVerdict` union so the dashboard can render blockers, cycle
 * members, or an indeterminate reason without re-deriving them.
 */
export interface WaitingEntry {
  slug: string;
  verdict: BlockerVerdict;
}

export interface ParkedEntry {
  slug: string;
  /** Provenance of the park: 'auto' or 'operator' */
  provenance?: 'auto' | 'operator';
  /** Reason for the auto-park (if available) */
  reason?: string;
  /** Reconciliation status supplied by the daemon's parked-feature sweep. */
  annotation?: 'orphan' | 'merged-ready';
}

export interface InheritedState {
  /** Optional read-only build-review summary; skipped coverage is never a pass. */
  buildReviewMetrics?: { lapsToPass?: number; skipped: number; cacheHits: number; infrastructureFailures: number; rubricFailureRates?: Record<string, { failures: number; judged: number }>; skipReasons?: Record<string, number> };
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
  /**
   * Priority resolution result from the resolver, if available. Used by the
   * dashboard to render band annotations (banded mode) or fallback marker
   * (fallback mode) on the ELIGIBLE section. Optional for backward compatibility
   * with callers that don't have a resolver.
   */
  priorityResolution?: PriorityResolution;
  /**
   * Slugs currently operator-parked (FR-6, `.daemon/parked/<slug>`). PARKED
   * has ABSOLUTE precedence over every other group — a parked slug is
   * excluded from HALTED, PROCESSED, IN-PROGRESS, WAITING, and ELIGIBLE, and
   * rendered first. Populated by the caller (daemon-cli) by consulting
   * `isOperatorParked` for every known slug — `scanInheritedState` itself has
   * no opinion on parking. Optional for backward compatibility with callers
   * built before parking existed. Can be either a string[] (legacy) or
   * ParkedEntry[] (with provenance info).
   */
  parked?: string[] | ParkedEntry[];
  /**
   * Specs (and repo-scoped conditions) held back by the OWNERSHIP gate
   * (FR-7/FR-11). Optional for backward compatibility with callers built
   * before owner-gating existed — a bare-array or waiting-only `discover()`
   * return yields no gated items. `kind: 'spec'` entries carry a `slug` and
   * participate in the same precedence chain as WAITING (HALTED > PROCESSED
   * > IN-PROGRESS > GATED > WAITING > ELIGIBLE): a slug already surfaced in a
   * higher-precedence bucket is excluded here. `kind: 'repo'` entries have no
   * slug and are never filtered by precedence.
   */
  gated?: GatedItem[];
  /** Feature worktrees retained after PR open until their branch lands on main. */
  retainedWorktrees?: RetainedWorktreeEntry[];
  /** Feature worktrees that have not yet written pipeline state. */
  neverStarted?: string[];
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
  discover: () => Promise<
    | BacklogItem[]
    | { items: BacklogItem[]; waiting: WaitingEntry[]; gated?: GatedItem[] }
  >;
  /** Optional log sink for skipped-worktree diagnostics. */
  log?: (msg: string) => void;
  /** Optional PR-state lookup for refining processed-ledger retained reasons. */
  prStateProbe?: PrStateProbe;
  /** Injectable clock for deterministic dashboard timing. */
  now?: () => number;
}

/** The completed-run marker; mirrors the private constant in conductor.ts. */
const DONE_MARKER = '.pipeline/DONE';

/** `true` when `path` exists (any type), tolerant of missing/unreadable paths. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
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
 * Read the last valid lifecycle event for the current logical step. Event
 * persistence is best-effort telemetry, so missing, malformed, or unrelated
 * evidence deliberately leaves the dashboard row unchanged.
 */
async function readProviderLifecycleDiagnostic(
  wt: string,
  step: string | undefined,
): Promise<ProviderLifecycleDiagnostic | undefined> {
  let content: string;
  try {
    content = await readFile(join(wt, '.pipeline/events.jsonl'), 'utf-8');
  } catch {
    return undefined;
  }

  let latest: ProviderLifecycleDiagnostic | undefined;
  for (const line of content.split('\n')) {
    const diagnostic = parseProviderLifecycleDiagnostic(line, step);
    if (diagnostic !== undefined) latest = diagnostic ?? undefined;
  }
  return latest;
}

/**
 * Extract the minimum dispatch lifecycle evidence needed to classify an
 * in-progress row. The latest `step_started` starts a new logical dispatch;
 * only an acceptance-RED refusal after that boundary proves the dispatch has
 * returned while its completion gate remains unmet.
 */
async function readDispatchActivity(
  wt: string,
  step: string,
): Promise<{
  startedAtMs?: number;
  completionUnmet: boolean;
  acceptanceRed?: {
    state: 'required' | 'pending' | 'satisfied' | 'rejected';
    reason?: string;
  };
  providerStreamProgress?: import('../execution/llm-provider.js').ProviderStreamObservation;
}> {
  let content: string;
  try {
    content = await readFile(join(wt, '.pipeline/events.jsonl'), 'utf-8');
  } catch {
    return { completionUnmet: false };
  }

  let startedAtMs: number | undefined;
  let completionUnmet = false;
  let acceptanceRed: {
    state: 'required' | 'pending' | 'satisfied' | 'rejected';
    reason?: string;
  } | undefined;
  let providerStreamProgress: import('../execution/llm-provider.js').ProviderStreamObservation | undefined;
  for (const line of content.split('\n')) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event.step !== step) continue;
    const timestamp = typeof event.ts === 'string' ? Date.parse(event.ts) : Number.NaN;
    if (event.type === 'step_started' && Number.isFinite(timestamp)) {
      startedAtMs = timestamp;
      completionUnmet = false;
      acceptanceRed = undefined;
      providerStreamProgress = undefined;
      continue;
    }
    if (startedAtMs !== undefined && event.type === 'acceptance_red' && isAcceptanceRedState(event.state)) {
      acceptanceRed = {
        state: event.state,
        ...(typeof event.reason === 'string' ? { reason: event.reason } : {}),
      };
      completionUnmet = event.state === 'pending' || event.state === 'rejected';
    }
    if (startedAtMs !== undefined && event.type === 'provider_stream_progress'
      && (event.childObservability === 'observed' || event.childObservability === 'unsupported')
      && typeof event.uncachedInputTokens === 'number' && typeof event.outputTokens === 'number') {
      providerStreamProgress = {
        childObservability: event.childObservability,
        ...(typeof event.activeChildren === 'number' ? { activeChildren: event.activeChildren } : {}),
        uncachedInputTokens: event.uncachedInputTokens,
        ...(typeof event.cachedInputTokens === 'number' ? { cachedInputTokens: event.cachedInputTokens } : {}),
        outputTokens: event.outputTokens,
      };
    }
  }
  return { startedAtMs, completionUnmet, acceptanceRed, providerStreamProgress };
}

function isAcceptanceRedState(
  value: unknown,
): value is 'required' | 'pending' | 'satisfied' | 'rejected' {
  return value === 'required' || value === 'pending' || value === 'satisfied' || value === 'rejected';
}

function parseProviderLifecycleDiagnostic(
  line: string,
  step: string | undefined,
): ProviderLifecycleDiagnostic | null | undefined {
  if (!step || line.trim() === '') return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(event) || event.type !== 'provider_attempt' || event.step !== step) return undefined;
  if (!isRecord(event.lifecycle)) return undefined;

  const { phase, attemptId, recoveryCount, reason, outcome } = event.lifecycle;
  if (typeof attemptId !== 'string' || attemptId.length === 0) return undefined;
  if (
    typeof recoveryCount !== 'number'
    || !Number.isInteger(recoveryCount)
    || recoveryCount < 0
    || recoveryCount > 1
  ) {
    return undefined;
  }
  switch (phase) {
    case 'preparing':
    case 'running':
      return reason === undefined ? { phase, attemptId, recoveryCount } : undefined;
    case 'recovering':
      return recoveryCount === 1 && reason === 'preparation-timeout'
        ? { phase, attemptId, recoveryCount, reason }
        : undefined;
    case 'exhausted':
      return recoveryCount === 1 && reason === 'preparation-timeout-exhausted'
        ? { phase: 'halted', attemptId, recoveryCount, reason }
        : undefined;
    case 'settled':
      // A valid terminal event supersedes a prior running/preparing event for
      // this step; do not leave stale activity diagnostics on the dashboard.
      return reason === undefined && (outcome === 'completed' || outcome === 'failed') ? null : undefined;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Scan inherited persisted state into the four dashboard groups. Pure of the
 * render — `renderDashboard` formats the returned struct. Injected `discover`
 * keeps eligibility in lockstep with the live `discoverBacklog`.
 */
export async function scanInheritedState(
  deps: ScanInheritedStateDeps,
): Promise<InheritedState> {
  const now = deps.now ?? Date.now;
  const processed = await readProcessedEntries(deps.processedDir);
  const processedSlugs = new Set(processed.map((p) => p.slug));
  const processedBySlug = new Map(processed.map((entry) => [entry.slug, entry]));
  const slugs = await listWorktreeSlugs(deps.worktreeBase);
  const featureEvents = await Promise.all(slugs.map(async (slug) => {
    try {
      return await readMergedFeatureEvents(join(deps.worktreeBase, slug));
    } catch (err) {
      deps.log?.(
        `dashboard: skipped build-review metrics for ${slug} (${err instanceof Error ? err.message : String(err)})`,
      );
      return undefined;
    }
  }));
  const mergedFeatureEvents = featureEvents.flatMap((events) => events ?? []);
  const buildReviewMetrics = mergedFeatureEvents.some((event) =>
    typeof event.type === 'string' && event.type.startsWith('build_review_'),
  )
    ? computeBuildReviewMetrics(mergedFeatureEvents)
    : undefined;

  const halted: HaltedEntry[] = [];
  const haltedSlugs = new Set<string>();
  const inProgress: InProgressEntry[] = [];
  const retainedWorktrees: RetainedWorktreeEntry[] = [];
  const neverStarted: string[] = [];

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
      // A HALT marker alongside a `.pipeline/DONE` marker is never a live
      // block in production: the false-ship path always removes DONE before
      // writing a real HALT (daemon-runner.ts). So this combination only
      // occurs when a fully-finished pipeline's PR was later closed unmerged
      // — treat it as reclaimable, not as an operator-blocking halt
      // (Story S3/S5), rather than the ordinary halted case below.
      const donePresent = haltContent !== null && (await pathExists(join(wt, DONE_MARKER)));

      if (haltContent !== null && !donePresent) {
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
        const lifecycle = await readProviderLifecycleDiagnostic(wt, entry.step);
        if (lifecycle?.phase === 'halted') entry.lifecycle = lifecycle;
        halted.push(entry);
        haltedSlugs.add(slug);
        continue;
      }

      const { present, state } = await loadWorktreeState(wt);
      const isRetainedFeatureWorktree =
        !slug.startsWith('resolve-') && !slug.startsWith('engineer-');
      if (processedSlugs.has(slug)) {
        if (isRetainedFeatureWorktree) {
          const prUrl = processedBySlug.get(slug)?.prUrl;
          let prState: PrStateProbeResult | undefined;
          if (prUrl && deps.prStateProbe) {
            try {
              prState = await deps.prStateProbe(prUrl);
            } catch {
              // Probe availability is enrichment only: retain this row as
              // unknown while the remaining worktrees continue scanning.
              prState = undefined;
            }
          }
          const matchedPrState = prUrl && prState?.prUrl === prUrl ? prState.state : undefined;
          retainedWorktrees.push({
            slug,
            prUrl,
            reason: matchedPrState === 'closed'
              ? 'pr-closed-unmerged'
              : matchedPrState === 'open'
                ? 'pr-open-awaiting-main'
                : prUrl
                  ? 'pr-state-unknown'
                  : 'shipped-no-pr-reference',
          });
        }
        continue; // processed worktrees are retained, never in-progress
      }
      if (!present) {
        if (isRetainedFeatureWorktree) {
          neverStarted.push(slug);
        }
        continue; // no conduct-state → never-started, not in-progress
      }
      if (donePresent) {
        // Finished pipeline, stale HALT, not (yet) in the processed ledger —
        // a closed-unmerged feature the sweep pruned from the watch registry
        // but left retained on disk for reclaim.
        if (isRetainedFeatureWorktree) {
          retainedWorktrees.push({ slug, reason: 'pr-closed-unmerged' });
        }
        continue;
      }

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
      // Best-effort: a missing/malformed heartbeat file is "no heartbeat yet",
      // never a scan failure — same tolerance as every other worktree read here.
      // A heartbeat naming a different step than the one in flight is a
      // leftover from an earlier dispatch (the file is overwritten, never
      // cleared) — rendering its age against the current step reports a
      // multi-hour "stall" for a step that just started.
      const heartbeat = await readStepHeartbeat(wt);
      if (heartbeat && heartbeat.step === entry.step) {
        const ageMs = now() - Date.parse(heartbeat.ts);
        if (Number.isFinite(ageMs)) entry.heartbeatAgeMs = Math.max(0, ageMs);
      }
      const activity = await readDispatchActivity(wt, entry.step);
      if (activity.startedAtMs !== undefined) {
        entry.elapsedStepTimeMs = Math.max(0, now() - activity.startedAtMs);
      }
      if (activity.providerStreamProgress) entry.providerStreamProgress = activity.providerStreamProgress;
      const testEvidence = await readFullSuiteEvidence(wt);
      if ('evidence' in testEvidence && testEvidence.evidence) {
        entry.lastTestOutcome = testEvidence.evidence.outcome;
      }
      if (activity.acceptanceRed) {
        entry.acceptanceRedState = activity.acceptanceRed.state;
        entry.completionCondition = activity.acceptanceRed.reason;
      }
      if (activity.completionUnmet) {
        entry.activityState = 'waiting';
      } else if (
        activity.startedAtMs !== undefined
        && heartbeatBelongsToDispatch(heartbeat, entry.step, activity.startedAtMs)
        && classifyHeartbeatAge(heartbeat, now(), DASHBOARD_HEARTBEAT_FRESH_MS).kind === 'fresh'
      ) {
        entry.activityState = 'working';
      }
      const lifecycle = await readProviderLifecycleDiagnostic(wt, entry.step);
      if (lifecycle?.phase !== 'halted') entry.lifecycle = lifecycle;
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
  // Also carries the band field when assigned by the priority resolver (banded mode).
  // WAITING: specs held back by an unresolved dependency gate (FR-6) — a
  // bare-array `discover()` (pre-widened callers) yields no waiting items.
  let eligible: EligibleEntry[] = [];
  let waiting: WaitingEntry[] = [];
  let gated: GatedItem[] = [];
  let priorityResolution: PriorityResolution | undefined;
  try {
    const result = await deps.discover();
    const backlog = Array.isArray(result) ? result : result.items;
    waiting = Array.isArray(result) ? [] : result.waiting;
    const rawGated = Array.isArray(result) ? [] : (result.gated ?? []);
    const inProgressSlugs = new Set(inProgress.map((p) => p.slug));
    // GATED precedence: HALTED > PROCESSED > IN-PROGRESS > GATED — a `kind:
    // 'spec'` entry already surfaced in a higher-precedence bucket is dropped
    // here rather than double-listed. `kind: 'repo'` entries have no slug and
    // are never filtered.
    gated = rawGated.filter(
      (g) =>
        g.kind !== 'spec' ||
        (!haltedSlugs.has(g.slug) && !processedSlugs.has(g.slug) && !inProgressSlugs.has(g.slug)),
    );
    const backlogItems = backlog.filter((b) => !haltedSlugs.has(b.slug) && !processedSlugs.has(b.slug));
    eligible = backlogItems.map((b) => ({
      slug: b.slug,
      tier: b.tier,
      band: (b as BacklogItem & { band?: PriorityBand }).band,
    }));

    // Detect the priority resolution mode from the items (set by orderBacklog in the WorkSource):
    // - If any eligible item has resolutionMode='banded', it's banded mode with band annotations
    // - If any eligible item has resolutionMode='fallback', it's fallback mode (resolver threw)
    // - Otherwise, no resolution mode is set (items are in discovery order)
    const resolutionMode = backlogItems.find((b) => (b as BacklogItem & { resolutionMode?: string }).resolutionMode)?.['resolutionMode'];
    if (resolutionMode === 'banded') {
      // Items have band annotations → banded mode (resolver succeeded in WorkSource)
      priorityResolution = { mode: 'banded', bands: new Map(eligible.filter((e) => e.band).map((e) => [e.slug, e.band!])) };
    } else if (resolutionMode === 'fallback') {
      // Resolver threw and fell back → fallback mode (no reordering, no band annotations)
      priorityResolution = { mode: 'fallback' };
    }
  } catch (err) {
    deps.log?.(
      `dashboard: backlog discovery failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  return {
    buildReviewMetrics,
    halted,
    inProgress,
    eligible,
    processed,
    processedCount: processed.length,
    waiting,
    gated,
    priorityResolution,
    retainedWorktrees,
    neverStarted,
  };
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

/**
 * ` (activity telemetry: Ns ago)` suffix for an IN-PROGRESS row. Empty when no
 * heartbeat file exists yet (a step that hasn't produced its first activity
 * pulse) — that state is never rendered as if it were stale.
 */
function heartbeatSuffix(heartbeatAgeMs?: number): string {
  if (heartbeatAgeMs === undefined) return '';
  return ` (activity telemetry: ${formatHeartbeatAge(heartbeatAgeMs)} ago)`;
}

function elapsedStepTimeSuffix(elapsedStepTimeMs?: number): string {
  return elapsedStepTimeMs === undefined ? '' : ` (elapsed: ${formatHeartbeatAge(elapsedStepTimeMs)})`;
}

function lastTestOutcomeSuffix(lastTestOutcome?: 'PASS' | 'FAIL'): string {
  return ` (last test outcome: ${lastTestOutcome ?? 'unavailable'})`;
}

function activityStateSuffix(entry: InProgressEntry): string {
  const state = entry.activityState;
  const redState = entry.acceptanceRedState ? `RED: ${entry.acceptanceRedState}` : undefined;
  if (state === 'waiting') {
    return ` (waiting${redState ? `; ${redState}` : ''}; completion condition: ${entry.completionCondition ?? 'unavailable'})`;
  }
  if (state) return ` (${[state, redState].filter(Boolean).join('; ')})`;
  return redState ? ` (${redState})` : '';
}

function childWorkSuffix(): string {
  // The provider layer cannot observe child work; do not fabricate a zero count (#1441).
  // See jstoup111/ai-conductor#1441.
  return ' (children: unknown)';
}

function lifecycleSuffix(lifecycle?: ProviderLifecycleDiagnostic): string {
  if (!lifecycle) return '';
  const reason = lifecycle.reason ? ` — ${lifecycle.reason}` : '';
  return ` (provider ${lifecycle.phase}: attempt ${lifecycle.attemptId}, recovery ${lifecycle.recoveryCount}${reason})`;
}

/** ` [${band}]` band tag, or empty when no band is assigned. */
function bandTag(band?: PriorityBand): string {
  return band ? ` [${band}]` : '';
}

/** `repo#number` formatting for a blocker/cycle-member ref. */
export function refLabel(ref: IssueRef): string {
  return `${ref.repo}#${ref.number}`;
}

/** Slug + reason + remedy line for a `kind: 'spec'` GATED entry (owner named for `other-owner`). */
function gatedSpecLine(g: GatedItem & { kind: 'spec' }): string {
  const owner = g.reason === 'other-owner' && g.otherOwner ? ` (owner: ${g.otherOwner})` : '';
  return `  • ${g.slug} — ${g.reason}${owner} — ${g.remedy}`;
}

/** Section-level warning line for a `kind: 'repo'` GATED entry (no slug). */
function gatedRepoLine(g: GatedItem & { kind: 'repo' }): string {
  const label =
    g.warning === 'identity-unresolved'
      ? 'building NOTHING — identity unresolved'
      : 'un-owned specs skipped — no owner_gate_cutover configured';
  return `  ⚠ ${label} — ${g.remedy}`;
}

function retainedReason(entry: RetainedWorktreeEntry): string {
  switch (entry.reason) {
    case 'pr-open-awaiting-main':
      return 'retained after ship; PR is open and awaiting main';
    case 'pr-closed-unmerged':
      return 'retained after ship; PR closed without merge';
    case 'shipped-no-pr-reference':
      return 'retained after ship; no PR reference was recorded';
    case 'pr-state-unknown':
      return 'retained after ship; PR state is unknown';
  }
}

function retainedRemedy(entry: RetainedWorktreeEntry): string {
  if (entry.reason === 'pr-open-awaiting-main') {
    return 'no operator action applies; retention ends when the PR lands on main';
  }
  return 'run conduct daemon reclaim-worktree for this row';
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
 * Render the dashboard as a single plain-text block. Each group carries a
 * count and lists its members with the bits an operator triages on: tier,
 * step, PR link, halt reason. PROCESSED lists each shipped slug with its PR
 * link when one was persisted. GATED lists specs (and repo-scoped conditions)
 * held back by the OWNERSHIP gate (FR-7/FR-11) — `kind: 'spec'` entries show
 * slug, reason, and remedy (naming the other operator for `other-owner`);
 * `kind: 'repo'` entries render as section-level warning lines with no slug.
 * Rendered after IN-PROGRESS and before WAITING/ELIGIBLE (precedence HALTED >
 * PROCESSED > IN-PROGRESS > GATED > WAITING > ELIGIBLE); a gated spec slug is
 * excluded from WAITING and ELIGIBLE below. Omitted entirely when `gated` is
 * absent or empty (this also covers the discovery-failure fallback, which
 * degrades `gated` to `[]` the same way it degrades `eligible`). WAITING lists
 * each slug held back by an unresolved dependency gate with its
 * blockers/cycle members/indeterminate reason (FR-6) — a single bucket, not
 * split by verdict kind, rendered after GATED and before ELIGIBLE. Omitted
 * entirely when `waiting` is absent or empty. Zero-state renders every
 * always-present group at `0`.
 *
 * When `priorityResolution` is provided (either in state or as a parameter) in
 * banded mode, ELIGIBLE lines gain band annotations (` [${band}]` suffix). When
 * in fallback mode, a single marker line `(priority: chronological fallback)`
 * is added to the ELIGIBLE section instead of per-line annotations.
 */
export function renderDashboard(
  state: InheritedState,
  opts?: { includeCompleted?: boolean },
  priorityResolution?: PriorityResolution,
): string {
  const lines: string[] = [];
  lines.push('── inherited state ──────────────────────────────────────────');
  if (state.buildReviewMetrics) {
    const metrics = state.buildReviewMetrics;
    lines.push(`BUILD REVIEW: laps-to-pass=${metrics.lapsToPass ?? 'not reached'}; reduced coverage (skipped, not pass)=${metrics.skipped}; cache-hits=${metrics.cacheHits}; infrastructure-failures=${metrics.infrastructureFailures}`);
    for (const [rubric, rate] of Object.entries(metrics.rubricFailureRates ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  raw ${rubric}: failures=${rate.failures}/${rate.judged}`);
    }
    const skipReasons = Object.entries(metrics.skipReasons ?? {});
    if (skipReasons.length > 0) lines.push(`  skip reasons: ${skipReasons.map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
  }

  // PARKED (FR-6) has ABSOLUTE precedence over every other group: it renders
  // FIRST, and a parked slug is excluded from HALTED, PROCESSED, IN-PROGRESS,
  // WAITING, and ELIGIBLE below — a slug appears in exactly one group, and if
  // it's parked, that group is PARKED. Sorted alphabetically for stability.
  const parkedRaw = state.parked ?? [];
  const parkedEntries: ParkedEntry[] = parkedRaw.map((p) =>
    typeof p === 'string' ? { slug: p } : p
  );
  const parkedSlugs = [...parkedEntries].sort((a, b) => a.slug.localeCompare(b.slug));
  const parkedSet = new Set(parkedSlugs.map((p) => p.slug));
  lines.push(`PARKED (${parkedSlugs.length})`);
  for (const entry of parkedSlugs) {
    const reason = entry.provenance === 'auto' ? 'auto-parked' : 'operator-parked';
    const detail = entry.reason ? `: ${entry.reason}` : '';
    const annotation =
      entry.annotation === 'orphan'
        ? ' — orphan — needs manual review'
        : entry.annotation === 'merged-ready'
          ? ' — merged — ready to reconcile'
          : '';
    lines.push(`  • ${entry.slug} — ${reason}${detail}${annotation}; remedy: run conduct daemon unpark for this row`);
  }

  const halted = state.halted.filter((h) => !parkedSet.has(h.slug));
  const haltedSet = new Set(halted.map((h) => h.slug));
  lines.push(`HALTED (${halted.length})`);
  for (const h of halted) {
    const step = h.step ? ` @${h.step}` : '';
    lines.push(`  • ${h.slug}${tierTag(h.tier)}${step} — reason: ${h.reason}${lifecycleSuffix(h.lifecycle)}${prSuffix(h.prUrl)}; remedy: clear this row's .pipeline/HALT to resume`);
  }

  const inProgress = state.inProgress.filter((p) => !parkedSet.has(p.slug) && !haltedSet.has(p.slug));
  lines.push(`IN-PROGRESS (${inProgress.length})`);
  for (const p of inProgress) {
    lines.push(`  • ${p.slug}${tierTag(p.tier)} @${p.step}${activityStateSuffix(p)}${lifecycleSuffix(p.lifecycle)}${heartbeatSuffix(p.heartbeatAgeMs)}${elapsedStepTimeSuffix(p.elapsedStepTimeMs)}${lastTestOutcomeSuffix(p.lastTestOutcome)}${childWorkSuffix()}${prSuffix(p.prUrl)}`);
  }

  const retainedWorktrees = (state.retainedWorktrees ?? []).filter(
    (entry) => !parkedSet.has(entry.slug) && !haltedSet.has(entry.slug),
  );
  const retainedWorktreeSet = new Set(retainedWorktrees.map((entry) => entry.slug));
  if (retainedWorktrees.length > 0) {
    lines.push(`RETAINED WORKTREES (${retainedWorktrees.length})`);
    for (const entry of retainedWorktrees) {
      lines.push(`  • ${entry.slug} — reason: ${retainedReason(entry)}${prSuffix(entry.prUrl)}; remedy: ${retainedRemedy(entry)}`);
    }
  }

  const neverStarted = (state.neverStarted ?? []).filter(
    (slug) => !parkedSet.has(slug) && !haltedSet.has(slug) && !retainedWorktreeSet.has(slug),
  );
  if (neverStarted.length > 0) {
    lines.push(`NEVER-STARTED (${neverStarted.length})`);
    for (const slug of neverStarted) {
      lines.push(`  • ${slug} — reason: no pipeline state was ever written; remedy: no operator action applies; feature remains dispatchable`);
    }
  }

  // GATED (FR-7/FR-11): specs (and repo-scoped conditions) held back by the
  // OWNERSHIP gate. Precedence HALTED > IN-PROGRESS > RETAINED > GATED >
  // WAITING > ELIGIBLE > PROCESSED — a `kind: 'spec'` slug already excluded upstream from
  // higher-precedence buckets is rendered here and then excluded below from
  // WAITING and ELIGIBLE. `kind: 'repo'` entries have no slug and render as
  // section-level warning lines. Omitted entirely when `gated` is absent or
  // empty, matching the WAITING empty convention (and the ELIGIBLE
  // discovery-failure fallback, which likewise degrades to an empty list
  // rather than rendering a distinct failure line).
  const processedSlugsSet = new Set(state.processed.map((p) => p.slug));
  const gated = (state.gated ?? []).filter(
    (g) =>
      g.kind !== 'spec' ||
      (!parkedSet.has(g.slug) &&
        !haltedSet.has(g.slug) &&
        !retainedWorktreeSet.has(g.slug) &&
        !processedSlugsSet.has(g.slug)),
  );
  const gatedSlugs = new Set(
    gated.filter((g): g is GatedItem & { kind: 'spec' } => g.kind === 'spec').map((g) => g.slug),
  );
  if (state.gated !== undefined) {
    lines.push(`GATED (${gated.length})`);
    for (const g of gated) {
      lines.push(g.kind === 'spec' ? gatedSpecLine(g) : gatedRepoLine(g));
    }
  }

  const waiting = (state.waiting ?? []).filter(
    (w) =>
      !parkedSet.has(w.slug) &&
      !haltedSet.has(w.slug) &&
      !retainedWorktreeSet.has(w.slug) &&
      !gatedSlugs.has(w.slug),
  );
  const waitingSlugs = new Set(waiting.map((w) => w.slug));
  if (waiting.length > 0) {
    lines.push(`WAITING (${waiting.length})`);
    for (const w of waiting) {
      lines.push(`  • ${w.slug} — ${waitingDetail(w.verdict)}`);
    }
  }

  // Defensive: a slug should never appear in both ELIGIBLE and WAITING/GATED,
  // but if it does, the higher-precedence bucket wins (HALTED > PROCESSED >
  // IN-PROGRESS > GATED > WAITING > ELIGIBLE) — filter it out of ELIGIBLE
  // rather than double-list it.
  const eligible = state.eligible.filter(
    (e) =>
      !waitingSlugs.has(e.slug) &&
      !gatedSlugs.has(e.slug) &&
      !parkedSet.has(e.slug) &&
      !haltedSet.has(e.slug) &&
      !retainedWorktreeSet.has(e.slug),
  );
  lines.push(`ELIGIBLE (${eligible.length})`);

  // Render band annotations or fallback mode marker
  // Use parameter if provided, otherwise use state's resolution
  const resolution = priorityResolution ?? state.priorityResolution;
  const isInFallbackMode = resolution?.mode === 'fallback';
  const isBandedMode = resolution?.mode === 'banded';
  for (const e of eligible) {
    // Only show band annotations in banded mode, not in fallback mode
    const bandAnnotation = isBandedMode ? bandTag(e.band) : '';
    lines.push(`  • ${e.slug}${tierTag(e.tier)}${bandAnnotation}`);
  }
  if (isInFallbackMode && eligible.length > 0) {
    lines.push(`  (priority: chronological fallback)`);
  }

  if (opts?.includeCompleted) {
    const processed = state.processed.filter(
      (p) => !parkedSet.has(p.slug) && !retainedWorktreeSet.has(p.slug),
    );
    lines.push(`PROCESSED (${processed.length})`);
    for (const p of processed) lines.push(`  • ${p.slug}${prSuffix(p.prUrl)}`);
  }

  lines.push('─────────────────────────────────────────────────────────────');
  return lines.join('\n');
}
