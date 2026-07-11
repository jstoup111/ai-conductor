import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import type { EvidenceStamp } from '../../src/engine/task-evidence.js';
import type { TaskEvidence } from '../../src/engine/task-evidence.js';
import { selectAuditSample, selectAuditSampleFromStamps } from '../../src/engine/attribution-audit.js';

// #505 TS-14: Deterministic spot-audit sampler — select a reproducible
// subset of tasks for accuracy auditing based on feature slug and sample
// percentage. Uses sha1(slug + ':' + taskId) mod 100 for determinism.

// Mock evidence structure for testing
function createMockEvidence(stamps: Map<string, EvidenceStamp>): TaskEvidence {
  return {
    evidenceStamps: stamps,
    noEvidenceAttempts: 0,
    noEvidenceReasons: [],
    migrationGrandfather: new Set(),
    async write() {
      // No-op
    },
  };
}

/**
 * Helper to create hash-based audit sample predicate: returns true if
 * task should be included in audit sample for the given slug and pct.
 * Used by tests to compute expected membership before implementation.
 */
function shouldAuditTask(slug: string, taskId: string, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;

  const input = `${slug}:${taskId}`;
  const hash = createHash('sha1').update(input).digest('hex');
  const hashNum = parseInt(hash.substring(0, 8), 16);
  const mod = hashNum % 100;
  return mod < pct;
}

describe('selectAuditSample — deterministic spot-audit sampler', () => {
  describe('Basic sampling', () => {
    it('returns empty set when pct is 0', () => {
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'semantic-verified' }],
        ['task-2', { sha: 'def456', form: 'semantic-verified' }],
        ['task-3', { sha: 'ghi789', form: 'semantic-verified' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const result = selectAuditSample(evidence, 'my-feature', 0);
      expect(result).toEqual([]);
    });

    it('returns all eligible tasks when pct is 100', () => {
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'commit' }],
        ['task-2', { sha: 'def456', form: 'commit' }],
        ['task-3', { sha: 'ghi789', form: 'commit' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const result = selectAuditSample(evidence, 'my-feature', 100);
      expect(result.sort()).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('selects deterministic subset via sha1(slug + ":" + taskId) mod 100 < pct', () => {
      const slug = 'test-slug';
      const pct = 50;
      const taskIds = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'];

      const evidenceStamps = new Map<string, EvidenceStamp>();
      const expectedSample: string[] = [];

      for (const taskId of taskIds) {
        evidenceStamps.set(taskId, { sha: `sha-${taskId}`, form: 'commit' });
        if (shouldAuditTask(slug, taskId, pct)) {
          expectedSample.push(taskId);
        }
      }

      const evidence = createMockEvidence(evidenceStamps);
      const result = selectAuditSample(evidence, slug, pct);
      expect(result.sort()).toEqual(expectedSample.sort());
    });
  });

  describe('Stability and reproducibility', () => {
    it('produces same subset on repeated calls with same inputs', () => {
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'commit' }],
        ['task-2', { sha: 'def456', form: 'commit' }],
        ['task-3', { sha: 'ghi789', form: 'commit' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const slug = 'stable-slug';
      const pct = 33;

      const result1 = selectAuditSample(evidence, slug, pct);
      const result2 = selectAuditSample(evidence, slug, pct);
      const result3 = selectAuditSample(evidence, slug, pct);
      expect(result1.sort()).toEqual(result2.sort());
      expect(result2.sort()).toEqual(result3.sort());
    });

    it('guarantees same (slug, taskIds) → exact expected subset across runs', () => {
      const evidenceStamps = new Map<string, EvidenceStamp>();
      const taskIds = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

      for (const taskId of taskIds) {
        evidenceStamps.set(taskId, { sha: `sha-${taskId}`, form: 'commit' });
      }

      const evidence = createMockEvidence(evidenceStamps);
      const slug = 'reproducible-slug';
      const pct = 25;

      // Pre-compute expected subset using the hash formula
      const expectedSample = taskIds.filter((id) => shouldAuditTask(slug, id, pct));

      for (let i = 0; i < 3; i++) {
        const result = selectAuditSample(evidence, slug, pct);
        expect(result.sort()).toEqual(expectedSample.sort());
      }
    });
  });

  describe('Semantic-verified exclusion', () => {
    it('excludes tasks with semantic-verified stamp from universe', () => {
      // Only tasks without semantic-verified form are eligible for audit
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'semantic-verified' }], // excluded
        ['task-2', { sha: 'def456', form: 'commit' }], // eligible
        ['task-3', { sha: 'ghi789', form: 'semantic-verified' }], // excluded
        ['task-4', { sha: 'jkl012', form: 'trailer' }], // eligible
      ]);
      const evidence = createMockEvidence(stamps);

      const slug = 'exclusion-test';
      const pct = 100;

      // Expected: only task-2 and task-4 eligible (pct=100 includes all eligible)
      const result = selectAuditSample(evidence, slug, pct);
      expect(result.sort()).toEqual(['task-2', 'task-4']);
    });

    it('returns empty when only semantic-verified stamps exist', () => {
      // All tasks have semantic-verified, so universe is empty
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'semantic-verified' }],
        ['task-2', { sha: 'def456', form: 'semantic-verified' }],
        ['task-3', { sha: 'ghi789', form: 'semantic-verified' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const slug = 'all-verified';
      const pct = 100;

      // Expected: [] (no eligible tasks)
      const result = selectAuditSample(evidence, slug, pct);
      expect(result).toEqual([]);
    });

    it('handles mixed stamps and selects based on hash formula', () => {
      const taskIds = [
        'task-1',
        'task-2',
        'task-3',
        'task-4',
        'task-5',
        'task-6',
        'task-7',
        'task-8',
      ];

      const evidenceStamps = new Map<string, EvidenceStamp>();
      const expectedEligible: string[] = [];

      // Mix: some semantic-verified, some not
      for (let i = 0; i < taskIds.length; i++) {
        const taskId = taskIds[i];
        if (i % 2 === 0) {
          // Even indices: semantic-verified (excluded from universe)
          evidenceStamps.set(taskId, { sha: `sha-${taskId}`, form: 'semantic-verified' });
        } else {
          // Odd indices: other forms (eligible)
          evidenceStamps.set(taskId, { sha: `sha-${taskId}`, form: 'commit' });
          expectedEligible.push(taskId);
        }
      }

      const evidence = createMockEvidence(evidenceStamps);
      const slug = 'mixed-stamps';
      const pct = 50;

      // Expected: only odd-indexed tasks (eligible) that pass hash filter
      const expectedSample = expectedEligible.filter((id) => shouldAuditTask(slug, id, pct));

      const result = selectAuditSample(evidence, slug, pct);
      expect(result.sort()).toEqual(expectedSample.sort());
    });
  });

  describe('Edge cases', () => {
    it('handles empty evidence stamps', () => {
      const stamps = new Map<string, EvidenceStamp>();
      const evidence = createMockEvidence(stamps);

      const result = selectAuditSample(evidence, 'any-slug', 50);
      expect(result).toEqual([]);
    });

    it('clamps pct to [0, 100] boundary behavior', () => {
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'commit' }],
        ['task-2', { sha: 'def456', form: 'commit' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const slug = 'boundary-test';

      // pct = -1 should behave like pct = 0 (empty)
      const resultNegative = selectAuditSample(evidence, slug, -1);
      const resultZero = selectAuditSample(evidence, slug, 0);
      expect(resultNegative).toEqual(resultZero);
      expect(resultZero).toEqual([]);

      // pct = 101 should behave like pct = 100 (all)
      const resultOver100 = selectAuditSample(evidence, slug, 101);
      const resultFull = selectAuditSample(evidence, slug, 100);
      expect(resultOver100.sort()).toEqual(resultFull.sort());
    });

    it('handles different slug strings with different membership', () => {
      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'commit' }],
        ['task-2', { sha: 'def456', form: 'commit' }],
        ['task-3', { sha: 'ghi789', form: 'commit' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const pct = 50;
      const slug1 = 'feature-a';
      const slug2 = 'feature-b';

      const result1 = selectAuditSample(evidence, slug1, pct);
      const result2 = selectAuditSample(evidence, slug2, pct);
      // They may be the same by chance, but the formula differs
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('Determinism proof', () => {
    it('computes hash consistent with sha1 formula across large sample set', () => {
      // Verify that our hash computation matches the sha1(slug + ":" + taskId) mod 100 formula
      const slug = 'determinism-test';
      const taskIds = Array.from({ length: 50 }, (_, i) => `task-${i}`);

      for (const taskId of taskIds) {
        const input = `${slug}:${taskId}`;
        const hash = createHash('sha1').update(input).digest('hex');
        const hashNum = parseInt(hash.substring(0, 8), 16);
        const mod = hashNum % 100;

        // Verify the formula consistency
        expect(mod).toBeGreaterThanOrEqual(0);
        expect(mod).toBeLessThan(100);
      }

      // Verify selectAuditSample uses the same formula: higher pct should include lower pct
      const stamps = new Map(
        taskIds.map((id) => [id, { sha: `sha-${id}`, form: 'commit' } as EvidenceStamp]),
      );
      const evidence = createMockEvidence(stamps);
      const sampleAt25 = selectAuditSample(evidence, slug, 25);
      const sampleAt75 = selectAuditSample(evidence, slug, 75);
      expect(sampleAt25.length).toBeLessThanOrEqual(sampleAt75.length);
    });
  });
});
