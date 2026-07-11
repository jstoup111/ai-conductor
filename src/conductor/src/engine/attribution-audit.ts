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
 * References:
 * - adr-2026-07-11-attribution-verdict-interface § "Spot-audit sampler"
 * - adr-2026-07-11-attribution-verdict-interface § "Fire-and-forget dispatch"
 * - Task 14: Deterministic spot-audit sampler (selectAuditSample)
 * - Task 7: Fresh-session verifier dispatch (dispatchAttributionVerifier)
 */

import * as crypto from 'node:crypto';
import { access } from 'node:fs/promises';
import type { TaskEvidence, EvidenceStamp } from './task-evidence.js';
import type { VerifierDispatchResult } from './attribution-lane.js';

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
  const { evidence, featureSlug, auditSamplePct, projectDir, featureWorktreePath, gateVerdictPath, dispatch } = opts;

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
  // Attach error handler to log failures but don't propagate them.
  dispatch({ residueIds: sampleIds })
    .catch((err) => {
      // Log error for observability but don't block gate or modify outcome
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[attribution-audit] spot-audit dispatch failed (non-blocking): ${errorMsg}`);
    });

  // Return immediately without waiting for dispatch to complete
  return { dispatched: true };
}
