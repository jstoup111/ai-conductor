import * as crypto from 'node:crypto';
import type { TaskEvidence, EvidenceStamp } from './task-evidence.js';

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
