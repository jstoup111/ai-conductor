/**
 * Brain memory store (Phase 9.1).
 *
 * On daemon feature completion the daemon emits a structured *signal* + a
 * *narrative* to a cross-project store at `~/.ai-conductor/brain/` so a future
 * brain (Phase 9.3) can learn from how features fared — without writing retro
 * clutter into the feature's repo.
 *
 * Layout (ADR-002, locked):
 *   ~/.ai-conductor/brain/
 *     signals.jsonl                         — append-only, one JSON line / run
 *     narratives/<project>/<feature>-<runId>.md
 *
 * Design invariants:
 *   - Append is a single atomic `O_APPEND` write (concurrency-safe — FR-11).
 *   - Narratives live in their own files keyed by runId (re-runs never
 *     overwrite — FR-8); only a small `narrativeRef` lives inline.
 *   - The whole emission is best-effort: every error is logged + swallowed so a
 *     learning-signal failure can never break a real ship (FR-10).
 */

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { FeatureOutcome } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import {
  parseEvents,
  aggregateDurations,
  aggregateRetryHotspots,
  aggregateTokens,
  aggregateKickbacks,
  aggregateHalts,
  type RetryHotspot,
  type KickbackEntry,
  type HaltEntry,
} from './report-renderer.js';

/** Current on-disk schema version for a signal record. Bump on schema change. */
export const SCHEMA_VERSION = 1;

const SIGNALS_LOG = 'signals.jsonl';
const NARRATIVES_DIR = 'narratives';

/**
 * One per-feature-run record. Each line in `signals.jsonl` is a serialized
 * `BrainSignal` (FR-3). Empty signal categories serialize as `[]` (never
 * missing/null) so a reader can aggregate uniformly; `narrativeRef` is optional
 * (absent when the retro step was tier-skipped).
 */
export interface BrainSignal {
  schemaVersion: number;
  /** ISO timestamp the record was assembled. */
  ts: string;
  project: string;
  feature: string;
  /** Distinguishes re-runs of the same feature (FR-8). */
  runId: string;
  outcome: FeatureOutcome['status'];
  kickbacks: KickbackEntry[];
  halts: HaltEntry[];
  retryHotspots: RetryHotspot[];
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  /** Per-step wall time in ms (start→complete). */
  durationByStep: Record<string, number>;
  /** Relative path to the narrative under the brain dir; absent if none. */
  narrativeRef?: string;
}

/**
 * Types-only reader interface for Phase 9.3's brain consumer. No runtime
 * behavior is provided here — it documents the read contract over the store so
 * the producer (9.1) and consumer (9.3) agree on shape.
 */
export interface BrainStoreReader {
  /** Read all signal records (optionally scoped to a project/feature). */
  readSignals(filter?: { project?: string; feature?: string }): Promise<BrainSignal[]>;
  /**
   * Like `readSignals` but also reports the number of malformed / unparseable
   * lines that were skipped (FR-5 skipped-count observability).
   */
  readSignalsWithStats(filter?: {
    project?: string;
    feature?: string;
  }): Promise<{ signals: BrainSignal[]; skipped: number }>;
}

/**
 * Options for `createBrainStoreReader`. Both fields are optional; when omitted
 * the reader falls back to `resolveBrainDir()` (which itself honours
 * `$AI_CONDUCTOR_BRAIN_DIR` or the default `~/.ai-conductor/brain/`).
 */
export interface BrainStoreReaderOpts {
  /** Direct path to the brain directory. Overrides env if provided. */
  brainDir?: string;
  /** Passed to `resolveBrainDir` when `brainDir` is not given. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Create a `BrainStoreReader` that reads `signals.jsonl` from the brain
 * directory resolved from `opts` (or env / home defaults). Implements
 * FR-1 (open store) and FR-5 (flywheel source):
 *
 * - Reads signals.jsonl line by line.
 * - Skips blank lines and malformed JSON lines (resilient — same convention as
 *   `parseEvents` in report-renderer.ts, reused here so no parallel parser).
 * - Applies project / feature filter when provided.
 * - Returns [] when signals.jsonl does not exist (best-effort / no crash).
 */
export function createBrainStoreReader(opts: BrainStoreReaderOpts = {}): BrainStoreReader {
  const dir = opts.brainDir ?? resolveBrainDir({ home: opts.home, env: opts.env });

  /**
   * Core parse helper: reads signals.jsonl and returns both the valid signals
   * and the count of skipped malformed lines. Used by both `readSignals` and
   * `readSignalsWithStats` to avoid duplication.
   */
  async function parseSignalsFile(filter?: {
    project?: string;
    feature?: string;
  }): Promise<{ signals: BrainSignal[]; skipped: number }> {
    let raw: string;
    try {
      raw = await readFile(join(dir, SIGNALS_LOG), 'utf-8');
    } catch {
      // Missing or unreadable file → empty result (store not yet written to).
      return { signals: [], skipped: 0 };
    }

    // Reuse the same resilient line-parse pattern as parseEvents() in
    // report-renderer.ts: split on newlines, skip blank + malformed lines.
    const signals: BrainSignal[] = [];
    let skipped = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Count malformed lines for observability (FR-5 skipped-count).
        skipped++;
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        skipped++;
        continue;
      }
      const sig = parsed as BrainSignal;
      if (filter?.project !== undefined && sig.project !== filter.project) continue;
      if (filter?.feature !== undefined && sig.feature !== filter.feature) continue;
      signals.push(sig);
    }
    return { signals, skipped };
  }

  return {
    async readSignals(filter?: { project?: string; feature?: string }): Promise<BrainSignal[]> {
      const { signals } = await parseSignalsFile(filter);
      return signals;
    },

    async readSignalsWithStats(filter?: {
      project?: string;
      feature?: string;
    }): Promise<{ signals: BrainSignal[]; skipped: number }> {
      return parseSignalsFile(filter);
    },
  };
}

// ─── FR-2: location / override / creation ─────────────────────────────────────

/**
 * Resolve the brain store directory. Default `~/.ai-conductor/brain/` (beside
 * `~/.ai-conductor/config.yml`); `$AI_CONDUCTOR_BRAIN_DIR` overrides. `home`/
 * `env` are injectable for testability (mirrors `userConfigPath(home)`).
 */
export function resolveBrainDir(
  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const env = opts.env ?? process.env;
  const override = env.AI_CONDUCTOR_BRAIN_DIR;
  if (override && override.trim() !== '') return override;
  const home = opts.home ?? homedir();
  return join(home, '.ai-conductor', 'brain');
}

// ─── FR-3: serialization ──────────────────────────────────────────────────────

/**
 * Serialize a signal to ONE newline-free JSON line. Empty categories stay `[]`;
 * `narrativeRef` is omitted entirely when absent/null.
 */
export function serializeSignal(sig: BrainSignal): string {
  const record: Record<string, unknown> = {
    schemaVersion: sig.schemaVersion,
    ts: sig.ts,
    project: sig.project,
    feature: sig.feature,
    runId: sig.runId,
    outcome: sig.outcome,
    kickbacks: sig.kickbacks ?? [],
    halts: sig.halts ?? [],
    retryHotspots: sig.retryHotspots ?? [],
    tokens: sig.tokens,
    durationByStep: sig.durationByStep ?? {},
  };
  if (sig.narrativeRef != null) record.narrativeRef = sig.narrativeRef;
  // JSON.stringify with no indent → a single line; values here never contain
  // raw newlines (narratives live in separate files, only a path is inline).
  return JSON.stringify(record);
}

// ─── FR-4 / FR-9: assemble from existing sources ──────────────────────────────

export interface AssembleArgs {
  /** Path to the feature's `.pipeline/events.jsonl`. */
  eventsPath: string;
  outcome: FeatureOutcome;
  project: string;
  feature: string;
  runId: string;
}

/**
 * Assemble a `BrainSignal` from the feature's `events.jsonl` (reusing the
 * report-renderer's parse + aggregation — no parallel re-implementation) plus
 * the `FeatureOutcome`. Tolerant: a missing/empty/malformed log yields a record
 * with empty signal arrays and never throws.
 */
export async function assembleSignal(args: AssembleArgs): Promise<BrainSignal> {
  let raw = '';
  try {
    raw = await readFile(args.eventsPath, 'utf-8');
  } catch {
    // Missing/unreadable log → assemble from FeatureOutcome alone.
    raw = '';
  }

  const events = parseEvents(raw);
  return {
    schemaVersion: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    project: args.project,
    feature: args.feature,
    runId: args.runId,
    outcome: args.outcome.status,
    kickbacks: aggregateKickbacks(events),
    halts: aggregateHalts(events),
    retryHotspots: aggregateRetryHotspots(events),
    tokens: aggregateTokens(events),
    durationByStep: aggregateDurations(events),
  };
}

// ─── FR-3 / FR-8 / FR-11: append ──────────────────────────────────────────────

/**
 * Append one signal as a single atomic line to `signals.jsonl`, auto-creating
 * the brain dir. The whole line (incl. trailing newline) is written in ONE
 * `appendFile` call (O_APPEND) so N concurrent appends yield N intact,
 * individually-parseable lines (FR-11).
 */
export async function appendSignal(brainDir: string, sig: BrainSignal): Promise<void> {
  await mkdir(brainDir, { recursive: true });
  const line = serializeSignal(sig) + '\n';
  // appendFile opens with O_APPEND; a single small write is atomic, so parallel
  // appenders never tear or interleave each other's lines.
  await appendFile(join(brainDir, SIGNALS_LOG), line, 'utf-8');
}

// ─── FR-5 / FR-6: narratives ──────────────────────────────────────────────────

export interface ProduceNarrativeArgs {
  outcome: FeatureOutcome;
  project: string;
  feature: string;
  runId: string;
  /** The (still-present, pre-teardown) worktree the feature ran in. */
  worktreePath: string;
  provider: LLMProvider;
  /** True when the complexity tier skipped the in-loop retro step (ST-005). */
  tierSkippedRetro: boolean;
}

/**
 * Produce the narrative for a completed feature.
 *   - `done` (retro not tier-skipped) → full retro via the LLM provider (the
 *     work the in-loop retro would have done), exactly one provider call.
 *   - tier-skipped → no narrative (`undefined`), no provider call.
 *   - `halted` → a short halt narrative assembled from the gate + reason; no
 *     provider call. A halt with no reason records "reason unavailable".
 */
export async function produceNarrative(
  args: ProduceNarrativeArgs,
): Promise<string | undefined> {
  if (args.outcome.status === 'halted') {
    return renderHaltNarrative(args);
  }

  // Tier-skipped features have no retro source — emit a signal without a
  // narrative rather than fabricate one (FR-5 negative).
  if (args.tierSkippedRetro) return undefined;

  // `done` (or any non-halted, non-tier-skipped outcome): full retro.
  const prompt = buildRetroPrompt(args);
  const result = await args.provider.invoke({
    prompt,
    sessionId: `brain-retro-${args.feature}-${args.runId}`,
    resume: false,
    cwd: args.worktreePath,
  });
  // Don't persist provider error text as a narrative — on failure, emit the
  // signal with no narrativeRef rather than a bogus retro (the best-effort
  // caller logs it).
  if (!result.success) return undefined;
  return result.output;
}

function renderHaltNarrative(args: ProduceNarrativeArgs): string {
  const reason =
    args.outcome.reason && args.outcome.reason.trim() !== ''
      ? args.outcome.reason.trim()
      : 'reason unavailable';
  return [
    `# Halt: ${args.feature}`,
    '',
    `- **Project:** ${args.project}`,
    `- **Run:** ${args.runId}`,
    `- **Outcome:** halted`,
    `- **Reason:** ${reason}`,
    '',
    `The gate loop halted before completion. ${
      reason === 'reason unavailable'
        ? 'No halt reason was captured (reason unavailable).'
        : `It halted because: ${reason}.`
    }`,
    '',
  ].join('\n');
}

function buildRetroPrompt(args: ProduceNarrativeArgs): string {
  return [
    `Write a concise retrospective for the completed feature "${args.feature}" in project`,
    `"${args.project}" (run ${args.runId}). The feature finished with outcome "done".`,
    `Base it on the worktree at ${args.worktreePath} (its .pipeline/events.jsonl and the diff).`,
    `Cover: what went well, what was hard, retries/kickbacks if any, and one improvement.`,
    `Output Markdown only.`,
  ].join(' ');
}

/**
 * Write a narrative to `narratives/<project>/<feature>-<runId>.md` under the
 * brain dir and return the RELATIVE `narrativeRef`. Keyed by runId so a re-run
 * never overwrites a prior narrative (FR-8).
 */
export async function writeNarrative(
  brainDir: string,
  project: string,
  feature: string,
  runId: string,
  content: string,
): Promise<string> {
  const relative = join(NARRATIVES_DIR, project, `${feature}-${runId}.md`);
  const absolute = join(brainDir, relative);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf-8');
  return relative;
}

// ─── FR-10: best-effort emission ──────────────────────────────────────────────

export interface EmitBrainSignalArgs {
  brainDir: string;
  eventsPath: string;
  outcome: FeatureOutcome;
  project: string;
  feature: string;
  runId: string;
  worktreePath: string;
  provider: LLMProvider;
  tierSkippedRetro: boolean;
  log?: (msg: string) => void;
}

/**
 * Orchestrate emission: assemble the signal, produce + write the narrative,
 * then append the (now narrativeRef-tagged) signal line. BEST-EFFORT — any
 * error is logged and swallowed so it never aborts feature completion. The
 * signal line is independent of narrative failure: if the narrative throws, the
 * signal is still appended (without a narrativeRef).
 */
export async function emitBrainSignal(args: EmitBrainSignalArgs): Promise<void> {
  const log = args.log ?? (() => {});
  try {
    const signal = await assembleSignal({
      eventsPath: args.eventsPath,
      outcome: args.outcome,
      project: args.project,
      feature: args.feature,
      runId: args.runId,
    });

    // Narrative is its own best-effort sub-step: a failure here must not stop
    // the signal line from being written.
    try {
      const narrative = await produceNarrative({
        outcome: args.outcome,
        project: args.project,
        feature: args.feature,
        runId: args.runId,
        worktreePath: args.worktreePath,
        provider: args.provider,
        tierSkippedRetro: args.tierSkippedRetro,
      });
      if (narrative != null) {
        signal.narrativeRef = await writeNarrative(
          args.brainDir,
          args.project,
          args.feature,
          args.runId,
          narrative,
        );
      }
    } catch (err) {
      log(
        `brain: narrative emission failed for ${args.feature} — ${
          err instanceof Error ? err.message : String(err)
        } (signal still recorded)`,
      );
    }

    await appendSignal(args.brainDir, signal);
  } catch (err) {
    log(
      `brain: signal emission failed for ${args.feature} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
