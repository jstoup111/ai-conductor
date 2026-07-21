/**
 * Post-green spot-audit dispatch orchestration for semantic attribution verification.
 *
 * DOMAIN: Audit Dispatch Pattern (Task 15)
 * =========================================
 *
 * After the build gate verdict is written (gate is satisfied), the conductor
 * optionally dispatches a spot-audit verifier to sample and verify a subset of
 * residue tasks. The audit runs AFTER the gate verdict is final, so:
 *
 * - Audit failure does NOT reopen the gate (build outcome unchanged)
 * - Audit success does NOT fabricate new agreement rows (audit is read-only)
 * - Dispatch is fire-and-forget: starts but doesn't block gate verdict
 * - Empty sample skips dispatch entirely
 *
 * CONTROL FLOW:
 *   Gate verdict written (compute_gate_verdict phase)
 *   ↓ (if build gate satisfied)
 *   Gate verdict file exists at .pipeline/gates/build.json
 *   ↓
 *   runSpotAudit({ evidence, ...opts })
 *   ├─ Check gate verdict exists
 *   ├─ Sample tasks using deterministic hash (Task 14: selectAuditSample)
 *   ├─ If sample empty → return (no dispatch)
 *   └─ Dispatch audit verifier (Task 7: dispatchAttributionVerifier) fire-and-forget
 *      ├─ verifier samples tasks + candidates
 *      ├─ writes .pipeline/attribution-verdict.json
 *      └─ runs in isolated session (fresh UUID, no conductor state)
 *
 * FAILURE ISOLATION:
 *   - Audit dispatch error → logged, doesn't block gate
 *   - Audit verdict parse error → ignored by engine, no rows added
 *   - Audit timeout → session expires, no verdict written, no rows added
 *   - All errors are fail-open (audit never stops build; only enhances it)
 *
 * FIRE-AND-FORGET SEMANTICS:
 *   runSpotAudit returns immediately after starting dispatch, without waiting
 *   for the verifier session to complete. This ensures:
 *   - Gate verdict is never blocked by audit runtime
 *   - Audit can run indefinitely without affecting build outcome
 *   - Errors during dispatch don't prevent build progression
 *
 * DOMAIN: Accuracy Ledger Pattern (Task 16)
 * ==========================================
 *
 * Record audit outcomes to a concurrent-safe append-only ledger for agreement
 * measurement. Each audited task appends a record to .daemon/attribution-accuracy.jsonl:
 *
 * {
 *   ts: number,                              // timestamp
 *   feature: string,                          // feature slug
 *   taskId: string,                           // task ID being audited
 *   fastLaneForm: string,                     // evidence form (commit, trailer, etc)
 *   fastLaneSha: string,                      // evidence SHA
 *   auditVerdict: 'satisfied'|'unsatisfied',  // verifier's verdict
 *   agree: boolean,                           // whether verdict matches fastLane
 *   citations?: Array<{sha, rationale}>,     // optional citations
 *   reason?: string                           // optional explanation
 * }
 *
 * CONCURRENCY:
 *   - O_APPEND flag guarantees line-atomic writes at OS level
 *   - Two parallel appends yield two complete, uninterleaved lines
 *   - No truncation possible; each write is atomic-append-only
 *
 * References:
 * - adr-2026-07-11-attribution-verdict-interface § "Spot-audit sampler"
 * - adr-2026-07-11-attribution-verdict-interface § "Fire-and-forget dispatch"
 * - Task 14: Deterministic spot-audit sampler (selectAuditSample)
 * - Task 7: Fresh-session verifier dispatch (dispatchAttributionVerifier)
 * - Task 16: Accuracy ledger appends (appendAccuracyLedger)
 */

import * as crypto from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TaskEvidence, EvidenceStamp } from './task-evidence.js';
import type { VerifierDispatchResult } from './attribution-lane.js';
import { parseAttributionVerdict } from './attribution-verdict.js';

/**
 * Accuracy ledger record for audit outcomes.
 * Each record captures one audited task's verdict and agreement status.
 */
export interface AccuracyLedgerRecord {
  /** Unix timestamp (milliseconds) when record was created */
  ts: number;
  /** Feature slug for correlation */
  feature: string;
  /** Task ID being audited */
  taskId: string;
  /** Evidence form (commit, trailer, semantic-verified, etc) */
  fastLaneForm: string;
  /** Evidence SHA or identifier */
  fastLaneSha: string;
  /** Audit verdict from verifier: satisfied or unsatisfied */
  auditVerdict: 'satisfied' | 'unsatisfied' | 'no-verdict';
  /** Whether audit verdict agrees with fast lane (agreement flag) */
  agree: boolean;
  /** Optional citations from verifier */
  citations?: Array<{ sha: string; rationale: string }>;
  /** Optional explanation for verdict or disagreement */
  reason?: string;
}

/**
 * DOMAIN: Accuracy Ledger Writer (Task 16)
 * ==========================================
 *
 * The accuracy ledger records spot-audit outcomes in `.daemon/attribution-accuracy.jsonl`.
 * Each record captures:
 * - ts: timestamp when audit was recorded
 * - feature: feature slug (for grouping/filtering audits by feature)
 * - taskId: task being audited
 * - fastLaneForm & fastLaneSha: the fast-path evidence (what was already recorded)
 * - auditVerdict: verdict from the spot verifier (satisfied/unsatisfied/no-verdict)
 * - agree: boolean flag indicating whether audit verdict matches fast-lane verdict
 * - citations, reason: optional contextual data
 *
 * CONCURRENCY GUARANTEES:
 * The implementation uses O_APPEND file flag, which guarantees that each write is
 * atomic at the OS kernel level:
 * 1. Two parallel writeSync calls with O_APPEND flag
 * 2. Each write is atomic — the kernel advances the file pointer AFTER the write
 * 3. Result: two complete, non-interleaved lines in the file
 * 4. No partial content, no truncation, no race conditions
 *
 * This is superior to mutex/locking because:
 * - No runtime locks required
 * - No await needed during write
 * - Works even if process crashes (data not lost)
 * - OS-level atomicity guarantees
 *
 * LINE FORMAT:
 * Each record is serialized as JSON + newline, making the file line-delimited
 * (jsonl format). Readers can safely split on \n and parse each line independently.
 *
 * CONSUMPTION PATTERN:
 * Accuracy metrics can be computed by:
 * 1. Reading .daemon/attribution-accuracy.jsonl line by line
 * 2. Parsing each line as JSON
 * 3. Computing agreement rate: count(agree: true) / total
 * 4. Filtering by feature, timestamp range, verdict type, etc
 *
 * # Task 16: Accuracy ledger appends
 * References: adr-2026-07-11-attribution-verdict-interface § "Accuracy ledger"
 */
export async function appendAccuracyLedger(ledgerPath: string, record: AccuracyLedgerRecord): Promise<void> {
  // Ensure directory exists
  const dir = dirname(ledgerPath);
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    // Directory may already exist; continue
  }

  // Prepare JSON line (with trailing newline)
  const line = JSON.stringify(record) + '\n';

  // Open file with O_APPEND flag for atomic append writes
  // O_APPEND guarantees that each write will append atomically,
  // preventing interleaving even with concurrent writes.
  const fd = openSync(ledgerPath, 'a');

  try {
    // Write the complete line in a single operation
    // This is atomic at the OS level due to O_APPEND
    writeSync(fd, line, 'utf-8');
  } finally {
    // Close the file descriptor
    import('node:fs/promises').then((m) => m.close(fd)).catch(() => {
      // Ignore close errors
    });
  }
}

/**
 * Deterministic spot-audit sampler for semantic attribution verification.
 *
 * Selects a reproducible subset of tasks for accuracy auditing based on
 * feature slug and sample percentage. Uses the formula:
 *   sha1(slug + ':' + taskId) mod 100 < pct
 *
 * This guarantees:
 * - Determinism: same (slug, taskIds) always produces the same subset
 * - Reproducibility: results are stable across runs
 * - Exclusion: tasks with semantic-verified stamps are excluded from the universe
 *   (only eligible/judge tasks are sampled)
 *
 * @param evidence - TaskEvidence containing evidenceStamps Map<taskId, EvidenceStamp>
 * @param slug - Feature slug used in the hash computation
 * @param pct - Percentage [0, 100] of eligible tasks to include in sample
 * @returns Array of task IDs selected for audit (order may vary, deduplicated)
 *
 * # Task 14: Deterministic spot-audit sampler
 * References: adr-2026-07-11-attribution-verdict-interface § "Spot-audit sampler"
 */
export function selectAuditSample(evidence: TaskEvidence, slug: string, pct: number): string[] {
  // Clamp pct to valid range [0, 100]
  const clampedPct = Math.max(0, Math.min(100, pct));

  // Boundary optimization: if pct is 0, no tasks are sampled
  if (clampedPct === 0) {
    return [];
  }

  const sample: string[] = [];

  // Iterate over all evidence stamps and collect eligible ones
  for (const [taskId, stamp] of evidence.evidenceStamps) {
    // Exclude tasks with semantic-verified stamp — they've already been
    // judged and don't need re-verification in the audit
    if (stamp.form === 'semantic-verified') {
      continue;
    }

    // Compute the deterministic hash-based selection predicate
    const input = `${slug}:${taskId}`;
    const hash = crypto.createHash('sha1').update(input).digest('hex');

    // Parse the first 8 hex characters (32 bits) as an integer, then mod 100
    // This gives us a value in [0, 99] that's deterministic per input
    const hashNum = parseInt(hash.substring(0, 8), 16);
    const mod = hashNum % 100;

    // Include this task if its hash value is below the threshold
    if (mod < clampedPct) {
      sample.push(taskId);
    }
  }

  return sample;
}

/**
 * Alternative interface accepting evidence sidecar directly (for testing
 * and internal use). Same semantics as selectAuditSample, but takes the
 * raw stamp map for cases where you may not have a full TaskEvidence instance.
 *
 * @internal Primarily for testing; production code should use selectAuditSample
 */
export function selectAuditSampleFromStamps(
  stamps: Map<string, EvidenceStamp>,
  slug: string,
  pct: number,
): string[] {
  // Create a minimal TaskEvidence-like object to reuse the main function
  return selectAuditSample(
    {
      evidenceStamps: stamps,
      noEvidenceAttempts: 0,
      noEvidenceReasons: [],
      migrationGrandfather: new Set(),
      lastResolvedCount: 0,
      async write() {
        // No-op for this internal helper
      },
    },
    slug,
    pct,
  );
}

/**
 * Dispatch options for post-green spot audit.
 */
export interface SpotAuditDispatchOptions {
  /** TaskEvidence containing evidenceStamps Map<taskId, EvidenceStamp> */
  evidence: TaskEvidence;
  /** Feature slug for deterministic sampling */
  featureSlug: string;
  /** Audit sample percentage [0, 100] */
  auditSamplePct: number;
  /** Project directory (conductor context) */
  projectDir: string;
  /** Feature worktree directory (session CWD) */
  featureWorktreePath: string;
  /** Path to gate verdict file (.pipeline/gates/build.json) */
  gateVerdictPath: string;
  /** Dispatch function (from Task 7, dispatchAttributionVerifier) */
  dispatch: (opts: { residueIds: string[] }) => Promise<VerifierDispatchResult>;
  /** Path to accuracy ledger file; defaults to <projectDir>/.daemon/attribution-accuracy.jsonl */
  ledgerPath?: string;
  /** Optional event emitter for attribution_divergence events */
  emitter?: AttributionEventEmitter;
}

/**
 * Spot audit dispatch result.
 */
export interface SpotAuditDispatchResult {
  /** Whether audit was dispatched */
  dispatched: boolean;
  /** Error if dispatch failed */
  error?: string;
}

/**
 * Post-green non-blocking spot-audit dispatch.
 *
 * After build gate verdict is written, sample tasks from evidence using the
 * deterministic sampler and dispatch the attribution verifier (fire-and-forget).
 * On empty sample, returns immediately without dispatch. On audit session
 * failure/timeout/unparseable verdict, leaves build outcome untouched (audit
 * failure is non-blocking). Dispatch happens in background without blocking
 * build outcome or gate verdict.
 *
 * Fire-and-forget semantics: dispatch call starts but we don't wait for it
 * to complete. Errors during dispatch are logged but not propagated.
 *
 * Pattern: reuses dispatchAttributionVerifier from Task 7, samples using
 * Task 14 sampler.
 *
 * @param opts - Dispatch configuration
 * @returns Result indicating whether audit was dispatched
 *
 * # Task 15: Post-green spot-audit dispatch
 * References: adr-2026-07-11-attribution-verdict-interface § "Spot-audit sampler"
 */
export async function runSpotAudit(opts: SpotAuditDispatchOptions): Promise<SpotAuditDispatchResult> {
  const { evidence, featureSlug, auditSamplePct, projectDir, featureWorktreePath, gateVerdictPath, dispatch, emitter } = opts;
  // Ledger is repo-local (ADR item 3); derive from projectDir unless overridden.
  const ledgerPath = opts.ledgerPath ?? join(projectDir, '.daemon', 'attribution-accuracy.jsonl');

  // Check if gate verdict file exists — only dispatch if verdict is present
  try {
    await access(gateVerdictPath);
  } catch {
    // Verdict file doesn't exist yet, nothing to do
    return { dispatched: false };
  }

  // Sample tasks from evidence using deterministic sampler
  const sampleIds = selectAuditSample(evidence, featureSlug, auditSamplePct);

  // Empty sample → no dispatch
  if (sampleIds.length === 0) {
    return { dispatched: false };
  }

  // Fire-and-forget: start dispatch without waiting for completion.
  // Chain success handler to record audit results, with error handler for non-blocking failures.
  dispatch({ residueIds: sampleIds })
    .then(async (result) => {
      // Only process verdict when dispatch succeeds
      if (!result.success) {
        return;
      }

      // Read and parse the verifier-written verdict file
      const verdictPath = join(featureWorktreePath, '.pipeline', 'attribution-verdict.json');
      let rawVerdict: unknown;
      try {
        const content = await readFile(verdictPath, 'utf-8');
        rawVerdict = JSON.parse(content);
      } catch (err) {
        // Verdict file missing or unparseable; abort record writing
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[attribution-audit] failed to read verdict file at ${verdictPath}: ${errorMsg}`);
        return;
      }

      // Parse verdict using the fail-closed parser
      const verdictMap = parseAttributionVerdict(rawVerdict, sampleIds);

      // For each sampled taskId, build and record an AccuracyLedgerRecord
      for (const taskId of sampleIds) {
        // Get fast-lane evidence for this task
        const stamp = evidence.evidenceStamps.get(taskId);
        if (!stamp) {
          // Task not in evidence; skip (should not happen for sampled tasks)
          continue;
        }

        // Get audit verdict for this task
        const auditVerdict = verdictMap.get(taskId) ?? 'no-verdict';

        // An abstention is a lost sample (ADR: "a verifier failure or timeout
        // loses one sample, never a build") — fabricate no agree row, emit no
        // divergence for a verdict the judge never rendered.
        if (auditVerdict === 'no-verdict') {
          continue;
        }

        // Build the accuracy ledger record
        const record: AccuracyLedgerRecord = {
          ts: Date.now(),
          feature: featureSlug,
          taskId,
          fastLaneForm: stamp.form,
          fastLaneSha: stamp.sha,
          auditVerdict,
          agree: auditVerdict === 'satisfied',
        };

        // Attempt to record the result (fire-and-forget; errors are logged)
        try {
          await recordAuditResultWithEvent(ledgerPath, record, emitter);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[attribution-audit] failed to record audit result for task ${taskId}: ${errorMsg}`);
        }
      }
    })
    .catch((err) => {
      // Log dispatch or processing error for observability but don't block gate
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[attribution-audit] spot-audit processing failed (non-blocking): ${errorMsg}`);
    });

  // Return immediately without waiting for dispatch or record-writing to complete
  return { dispatched: true };
}

/**
 * Event emitter interface for attribution_divergence event emission.
 */
export interface AttributionEventEmitter {
  emit(type: 'attribution_divergence', event: { feature: string; taskId: string }): void;
}

/**
 * Record an audit result and emit divergence event if audit disagrees with fast-lane.
 *
 * Appends the accuracy ledger record and, when agree: false, emits an
 * `attribution_divergence` event with feature and taskId. No stamps are
 * revoked, no halt markers are written — audit results are observational.
 *
 * DOMAIN: Divergence signaling (Task 17)
 * ======================================
 *
 * When the spot-audit disagrees with the fast-lane verdict (agree: false),
 * the engine emits `attribution_divergence` through the event stream so
 * false positives become visible in logs/dashboards without destabilizing
 * shipped builds. Stamps and state files are never touched — divergence is
 * purely informational.
 *
 * References:
 * - adr-2026-07-11-attribution-spot-audit-measurement § "Divergence signal"
 * - Task 17: Divergence event emission
 *
 * @param ledgerPath - Path to .daemon/attribution-accuracy.jsonl
 * @param record - Accuracy ledger record (includes agree boolean)
 * @param emitter - Event emitter for attribution_divergence
 */
export async function recordAuditResultWithEvent(
  ledgerPath: string,
  record: AccuracyLedgerRecord,
  emitter?: AttributionEventEmitter,
): Promise<void> {
  // Append record to accuracy ledger
  await appendAccuracyLedger(ledgerPath, record);

  // Emit divergence event if audit disagrees with fast-lane
  if (!record.agree && emitter) {
    emitter.emit('attribution_divergence', {
      feature: record.feature,
      taskId: record.taskId,
    });
  }
}

/**
 * Rolling agreement summary computed from the accuracy ledger.
 */
export interface AccuracyLedgerSummary {
  /** Number of ledger records considered. */
  sampleCount: number;
  /** count(agree: true) / sampleCount, in [0, 1]. */
  agreementRate: number;
}

/**
 * DOMAIN: Ledger Summarizer (Task 18)
 * ====================================
 *
 * Reads `.daemon/attribution-accuracy.jsonl` and computes a rolling agreement
 * rate: count(agree: true) / total records. Returns `null` when the ledger is
 * absent, empty, or contains zero parseable records — callers MUST omit the
 * status line in that case rather than render a fabricated 100% (Story 9:
 * "absent/empty ledger ⇒ line omitted, no fake 100%").
 *
 * Malformed individual lines are skipped (fail-open per line), not fatal to
 * the summary — a single corrupt line must never hide the rest of the ledger.
 *
 * @param ledgerPath - Path to .daemon/attribution-accuracy.jsonl
 * @returns summary, or null when there is nothing to summarize
 *
 * # Task 18: Daemon status agreement rate
 * References: adr-2026-07-11-attribution-verdict-interface § "Accuracy ledger"
 */
export async function summarizeAccuracyLedger(ledgerPath: string): Promise<AccuracyLedgerSummary | null> {
  const { readFile } = await import('node:fs/promises');

  let content: string;
  try {
    content = await readFile(ledgerPath, 'utf-8');
  } catch {
    // Missing/unreadable ledger — nothing to summarize.
    return null;
  }

  let total = 0;
  let agreeCount = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { agree?: unknown };
      if (typeof parsed.agree !== 'boolean') continue;
      total += 1;
      if (parsed.agree) agreeCount += 1;
    } catch {
      // Skip malformed line; never let it abort the whole summary.
      continue;
    }
  }

  if (total === 0) return null;

  return { sampleCount: total, agreementRate: agreeCount / total };
}
