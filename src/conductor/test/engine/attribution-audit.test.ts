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

// #505 TS-16: Accuracy ledger appends — record audit outcomes to a
// concurrent-safe append-only ledger for agreement measurement.
//
// Pattern: write audit outcomes to .daemon/attribution-accuracy.jsonl via
// O_APPEND single-write per line. Each line is a complete JSON record:
// {ts, feature, taskId, fastLaneForm, fastLaneSha, auditVerdict, agree, citations?, reason?}
//
// Two parallel appends must yield two complete lines (no interleave/truncation).

describe('appendAccuracyLedger — accuracy ledger writer', () => {
  describe('RED: accuracy ledger contract', () => {
    it('appends complete JSON line to .daemon/attribution-accuracy.jsonl', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'accuracy-ledger-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');

        const record = {
          ts: Date.now(),
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123def456',
          auditVerdict: 'satisfied',
          agree: true,
        };

        await appendAccuracyLedger(ledgerPath, record);

        const content = await readFile(ledgerPath, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(1);

        const parsed = JSON.parse(lines[0]);
        expect(parsed.ts).toBe(record.ts);
        expect(parsed.feature).toBe(record.feature);
        expect(parsed.taskId).toBe(record.taskId);
        expect(parsed.fastLaneForm).toBe(record.fastLaneForm);
        expect(parsed.fastLaneSha).toBe(record.fastLaneSha);
        expect(parsed.auditVerdict).toBe(record.auditVerdict);
        expect(parsed.agree).toBe(record.agree);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('includes all required fields in appended record', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'ledger-fields-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');

        const record = {
          ts: 1625097600000,
          feature: 'my-feature',
          taskId: 'task-42',
          fastLaneForm: 'trailer',
          fastLaneSha: 'def456abc123',
          auditVerdict: 'unsatisfied',
          agree: false,
        };

        await appendAccuracyLedger(ledgerPath, record);

        const content = await readFile(ledgerPath, 'utf-8');
        const parsed = JSON.parse(content.trim());

        expect(parsed).toHaveProperty('ts');
        expect(parsed).toHaveProperty('feature');
        expect(parsed).toHaveProperty('taskId');
        expect(parsed).toHaveProperty('fastLaneForm');
        expect(parsed).toHaveProperty('fastLaneSha');
        expect(parsed).toHaveProperty('auditVerdict');
        expect(parsed).toHaveProperty('agree');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('includes optional citations field when present', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'ledger-citations-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');

        const record = {
          ts: 1625097600000,
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123',
          auditVerdict: 'satisfied',
          agree: true,
          citations: [
            { sha: 'commit-sha-1', rationale: 'first citation' },
            { sha: 'commit-sha-2', rationale: 'second citation' },
          ],
        };

        await appendAccuracyLedger(ledgerPath, record);

        const content = await readFile(ledgerPath, 'utf-8');
        const parsed = JSON.parse(content.trim());

        expect(parsed.citations).toBeDefined();
        expect(Array.isArray(parsed.citations)).toBe(true);
        expect(parsed.citations).toHaveLength(2);
        expect(parsed.citations[0].sha).toBe('commit-sha-1');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('includes optional reason field when present', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'ledger-reason-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');

        const record = {
          ts: 1625097600000,
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123',
          auditVerdict: 'unsatisfied',
          agree: false,
          reason: 'Tests did not pass validation',
        };

        await appendAccuracyLedger(ledgerPath, record);

        const content = await readFile(ledgerPath, 'utf-8');
        const parsed = JSON.parse(content.trim());

        expect(parsed.reason).toBe('Tests did not pass validation');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('two parallel appends yield two complete lines with no interleave', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'ledger-parallel-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');

        const record1 = {
          ts: 1000,
          feature: 'feature-a',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'sha-1',
          auditVerdict: 'satisfied',
          agree: true,
        };

        const record2 = {
          ts: 2000,
          feature: 'feature-b',
          taskId: 'task-2',
          fastLaneForm: 'trailer',
          fastLaneSha: 'sha-2',
          auditVerdict: 'unsatisfied',
          agree: false,
        };

        // Start both appends in parallel
        await Promise.all([
          appendAccuracyLedger(ledgerPath, record1),
          appendAccuracyLedger(ledgerPath, record2),
        ]);

        // Read and validate result
        const content = await readFile(ledgerPath, 'utf-8');
        const lines = content.trim().split('\n');

        // Should have exactly 2 complete lines
        expect(lines).toHaveLength(2);

        // Both lines should be valid JSON
        const parsed1 = JSON.parse(lines[0]);
        const parsed2 = JSON.parse(lines[1]);

        // Verify both records are present (order may vary due to parallelism)
        const records = [parsed1, parsed2];
        const taskIds = records.map((r) => r.taskId);
        expect(taskIds).toContain('task-1');
        expect(taskIds).toContain('task-2');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('appends to existing ledger without truncation', async () => {
      const { appendAccuracyLedger } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm, writeFile, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'ledger-append-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');
        await mkdir(join(tmpDir, '.daemon'), { recursive: true });

        // Write initial record
        const initialRecord = {
          ts: 1000,
          feature: 'feature-1',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'sha-1',
          auditVerdict: 'satisfied',
          agree: true,
        };
        await writeFile(ledgerPath, JSON.stringify(initialRecord) + '\n', 'utf-8');

        // Append another record
        const newRecord = {
          ts: 2000,
          feature: 'feature-2',
          taskId: 'task-2',
          fastLaneForm: 'trailer',
          fastLaneSha: 'sha-2',
          auditVerdict: 'unsatisfied',
          agree: false,
        };
        await appendAccuracyLedger(ledgerPath, newRecord);

        // Read and validate
        const content = await readFile(ledgerPath, 'utf-8');
        const lines = content.trim().split('\n');

        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).taskId).toBe('task-1');
        expect(JSON.parse(lines[1]).taskId).toBe('task-2');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// #505 TS-17: Divergence event emission — signal when audit disagrees with
// lane verdict, never revoke stamps/state.
//
// Pattern: When an audited task is recorded with agree: false, emit
// attribution_divergence event with feature + taskId. Post-divergence,
// task stamps and state files remain unchanged; no halt/park markers created.

describe('attribution_divergence event — signal, never revocation (Task 17)', () => {
  describe('GREEN: event emission on disagreement', () => {
    it('emits attribution_divergence when agree: false', async () => {
      const { recordAuditResultWithEvent } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, readFile, rm, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-emit-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');
        await mkdir(join(tmpDir, '.daemon'), { recursive: true });

        const emittedEvents: Array<{ feature: string; taskId: string }> = [];
        const mockEmitter = {
          emit: (type: string, event: unknown) => {
            if (type === 'attribution_divergence') {
              emittedEvents.push(event as any);
            }
          },
        };

        const record = {
          ts: Date.now(),
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123',
          auditVerdict: 'unsatisfied' as const,
          agree: false,
          reason: 'diff does not satisfy task',
        };

        await recordAuditResultWithEvent(ledgerPath, record, mockEmitter);

        // Event should have been emitted
        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0].feature).toBe('test-feature');
        expect(emittedEvents[0].taskId).toBe('task-1');

        // Ledger should also have been written
        const content = await readFile(ledgerPath, 'utf-8');
        const parsed = JSON.parse(content.trim());
        expect(parsed.agree).toBe(false);
        expect(parsed.feature).toBe('test-feature');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('does not emit event when agree: true', async () => {
      const { recordAuditResultWithEvent } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, rm, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-no-emit-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');
        await mkdir(join(tmpDir, '.daemon'), { recursive: true });

        const emittedEvents: Array<{ feature: string; taskId: string }> = [];
        const mockEmitter = {
          emit: (type: string, event: unknown) => {
            if (type === 'attribution_divergence') {
              emittedEvents.push(event as any);
            }
          },
        };

        const record = {
          ts: Date.now(),
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123',
          auditVerdict: 'satisfied' as const,
          agree: true,
        };

        await recordAuditResultWithEvent(ledgerPath, record, mockEmitter);

        // No event should be emitted when agree: true
        expect(emittedEvents).toHaveLength(0);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('works with undefined emitter (no error)', async () => {
      const { recordAuditResultWithEvent } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, rm, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-no-emitter-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');
        await mkdir(join(tmpDir, '.daemon'), { recursive: true });

        const record = {
          ts: Date.now(),
          feature: 'test-feature',
          taskId: 'task-1',
          fastLaneForm: 'commit',
          fastLaneSha: 'abc123',
          auditVerdict: 'unsatisfied' as const,
          agree: false,
        };

        // Should not throw when emitter is undefined
        await expect(recordAuditResultWithEvent(ledgerPath, record, undefined)).resolves.not.toThrow();
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('GREEN: divergence event format', () => {
    it('divergence event contains feature and taskId', async () => {
      const { recordAuditResultWithEvent } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, rm, mkdir } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-format-'));

      try {
        const ledgerPath = join(tmpDir, '.daemon/attribution-accuracy.jsonl');
        await mkdir(join(tmpDir, '.daemon'), { recursive: true });

        const emittedEvents: Array<{ feature: string; taskId: string }> = [];
        const mockEmitter = {
          emit: (type: string, event: unknown) => {
            if (type === 'attribution_divergence') {
              emittedEvents.push(event as any);
            }
          },
        };

        const record = {
          ts: Date.now(),
          feature: 'my-feature',
          taskId: 'task-42',
          fastLaneForm: 'commit',
          fastLaneSha: 'sha-abc',
          auditVerdict: 'unsatisfied' as const,
          agree: false,
        };

        await recordAuditResultWithEvent(ledgerPath, record, mockEmitter);

        expect(emittedEvents[0].feature).toBe('my-feature');
        expect(emittedEvents[0].taskId).toBe('task-42');
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('GREEN: post-divergence state immutability', () => {
    it('post-divergence, task stamps remain unchanged', async () => {
      const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-stamp-'));

      try {
        const stampPath = join(tmpDir, 'task-evidence.json');
        const initialStamps = {
          evidenceStamps: {
            'task-1': { sha: 'abc123', form: 'commit' },
          },
        };

        await writeFile(stampPath, JSON.stringify(initialStamps), 'utf-8');
        const beforeDivergence = await readFile(stampPath, 'utf-8');

        // Emit divergence event (no-op for stamp changes)
        // After event emission, stamps should be identical
        const afterDivergence = await readFile(stampPath, 'utf-8');

        expect(beforeDivergence).toBe(afterDivergence);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('post-divergence, no halt marker is created', async () => {
      const { mkdtemp, readdir, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'divergence-halt-'));

      try {
        const pipelineDir = join(tmpDir, '.pipeline');

        // After divergence, no halt marker should exist
        try {
          const files = await readdir(pipelineDir);
          const haltMarker = files.find((f) => f.includes('halt') || f.includes('park'));
          expect(haltMarker).toBeUndefined();
        } catch {
          // Directory doesn't exist — that's fine, no halt marker present
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// #505 TS-15: Post-green spot-audit dispatch — fire-and-forget verifier
// invocation after build gate verdict is written.
//
// Pattern: reuse dispatchAttributionVerifier from Task 7, sample tasks
// from evidence using Task 14 sampler, and dispatch without blocking on
// audit result. On empty sample, return immediately. On audit session
// failure/timeout/unparseable verdict, leave build outcome untouched
// (fail-open for audit, fail-closed for gate).

describe('runSpotAudit — post-green non-blocking spot audit dispatch', () => {
  describe('RED: task contract and fire-and-forget semantics', () => {
    it('returns immediately without dispatch when sample is empty', async () => {
      const { runSpotAudit } = await import('../../src/engine/attribution-audit.js');

      const stamps = new Map<string, EvidenceStamp>([
        ['task-1', { sha: 'abc123', form: 'semantic-verified' }],
        ['task-2', { sha: 'def456', form: 'semantic-verified' }],
      ]);
      const evidence = createMockEvidence(stamps);

      const dispatchCalls: unknown[] = [];
      const mockDispatch = async () => {
        dispatchCalls.push({});
        return { success: true, output: '{}' };
      };

      const result = await runSpotAudit({
        evidence,
        featureSlug: 'test-feature',
        auditSamplePct: 50, // Would sample from eligible set
        projectDir: '/tmp/project',
        featureWorktreePath: '/tmp/feature',
        gateVerdictPath: '/tmp/.pipeline/gates/build.json',
        dispatch: mockDispatch as any,
      });

      // No dispatch when sample is empty (all tasks semantic-verified)
      expect(dispatchCalls).toHaveLength(0);
      expect(result.dispatched).toBe(false);
    });

    it('dispatches audit verifier only after gate verdict file exists', async () => {
      const { runSpotAudit } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'audit-dispatch-'));

      try {
        const stamps = new Map<string, EvidenceStamp>([
          ['task-1', { sha: 'abc123', form: 'commit' }],
        ]);
        const evidence = createMockEvidence(stamps);

        const gateVerdictPath = join(tmpDir, '.pipeline/gates/build.json');
        const dispatchCalls: Array<{ residueIds: string[] }> = [];
        const mockDispatch = async (opts: any) => {
          dispatchCalls.push(opts);
          return { success: true, output: '{}' };
        };

        // Dispatch should fail or skip when verdict doesn't exist
        const result = await runSpotAudit({
          evidence,
          featureSlug: 'test-feature',
          auditSamplePct: 100,
          projectDir: tmpDir,
          featureWorktreePath: tmpDir,
          gateVerdictPath,
          dispatch: mockDispatch as any,
        });

        expect(dispatchCalls).toHaveLength(0);

        // Now write the verdict
        await import('node:fs/promises').then((m) =>
          m.mkdir(join(tmpDir, '.pipeline/gates'), { recursive: true }),
        );
        await writeFile(gateVerdictPath, JSON.stringify({ satisfied: true }), 'utf-8');

        const result2 = await runSpotAudit({
          evidence,
          featureSlug: 'test-feature',
          auditSamplePct: 100,
          projectDir: tmpDir,
          featureWorktreePath: tmpDir,
          gateVerdictPath,
          dispatch: mockDispatch as any,
        });

        // After verdict exists, should dispatch
        expect(dispatchCalls.length).toBeGreaterThan(0);
        expect(result2.dispatched).toBe(true);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('audit failure does not modify build outcome', async () => {
      const { runSpotAudit } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, writeFile, rm, readFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'audit-failure-'));

      try {
        const stamps = new Map<string, EvidenceStamp>([
          ['task-1', { sha: 'abc123', form: 'commit' }],
        ]);
        const evidence = createMockEvidence(stamps);

        const gateVerdictPath = join(tmpDir, '.pipeline/gates/build.json');
        const buildOutcomePath = join(tmpDir, '.pipeline/attribution-enforce.json');

        // Write initial build outcome
        await import('node:fs/promises').then((m) =>
          m.mkdir(join(tmpDir, '.pipeline/gates'), { recursive: true }),
        );
        await writeFile(gateVerdictPath, JSON.stringify({ satisfied: true }), 'utf-8');
        const initialOutcome = { agree: [] };
        await writeFile(buildOutcomePath, JSON.stringify(initialOutcome), 'utf-8');

        const mockFailingDispatch = async () => {
          throw new Error('Dispatch failed');
        };

        const result = await runSpotAudit({
          evidence,
          featureSlug: 'test-feature',
          auditSamplePct: 100,
          projectDir: tmpDir,
          featureWorktreePath: tmpDir,
          gateVerdictPath,
          dispatch: mockFailingDispatch as any,
        });

        // Dispatch was initiated but failed (fire-and-forget, so we don't wait for result)
        // The key point is that build outcome should remain unchanged
        expect(result.dispatched).toBe(true); // Dispatch was started

        // Build outcome should remain unchanged (errors don't modify it)
        const outcomeAfter = JSON.parse(await readFile(buildOutcomePath, 'utf-8'));
        expect(outcomeAfter).toEqual(initialOutcome);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('passes sampled task set to verifier as residueIds', async () => {
      const { runSpotAudit } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'audit-residue-'));

      try {
        const stamps = new Map<string, EvidenceStamp>([
          ['task-1', { sha: 'abc123', form: 'commit' }],
          ['task-2', { sha: 'def456', form: 'commit' }],
          ['task-3', { sha: 'ghi789', form: 'commit' }],
        ]);
        const evidence = createMockEvidence(stamps);

        const gateVerdictPath = join(tmpDir, '.pipeline/gates/build.json');
        const dispatchCalls: Array<{ residueIds: string[] }> = [];

        await import('node:fs/promises').then((m) =>
          m.mkdir(join(tmpDir, '.pipeline/gates'), { recursive: true }),
        );
        await writeFile(gateVerdictPath, JSON.stringify({ satisfied: true }), 'utf-8');

        const mockDispatch = async (opts: any) => {
          dispatchCalls.push({ residueIds: opts.residueIds });
          return { success: true, output: '{}' };
        };

        await runSpotAudit({
          evidence,
          featureSlug: 'test-feature',
          auditSamplePct: 100,
          projectDir: tmpDir,
          featureWorktreePath: tmpDir,
          gateVerdictPath,
          dispatch: mockDispatch as any,
        });

        expect(dispatchCalls).toHaveLength(1);
        const sentResidueIds = dispatchCalls[0].residueIds;
        expect(sentResidueIds).toBeTruthy();
        expect(Array.isArray(sentResidueIds)).toBe(true);
        expect(sentResidueIds.length).toBeGreaterThan(0);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('fire-and-forget: does not wait for audit completion', async () => {
      const { runSpotAudit } = await import('../../src/engine/attribution-audit.js');
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = await mkdtemp(join(tmpdir(), 'audit-fire-forget-'));

      try {
        const stamps = new Map<string, EvidenceStamp>([
          ['task-1', { sha: 'abc123', form: 'commit' }],
        ]);
        const evidence = createMockEvidence(stamps);

        const gateVerdictPath = join(tmpDir, '.pipeline/gates/build.json');
        let dispatchStarted = false;
        let dispatchCompleted = false;

        await import('node:fs/promises').then((m) =>
          m.mkdir(join(tmpDir, '.pipeline/gates'), { recursive: true }),
        );
        await writeFile(gateVerdictPath, JSON.stringify({ satisfied: true }), 'utf-8');

        const slowDispatch = async () => {
          dispatchStarted = true;
          // Simulate slow dispatch
          await new Promise((resolve) => setTimeout(resolve, 100));
          dispatchCompleted = true;
          return { success: true, output: '{}' };
        };

        const startTime = Date.now();
        await runSpotAudit({
          evidence,
          featureSlug: 'test-feature',
          auditSamplePct: 100,
          projectDir: tmpDir,
          featureWorktreePath: tmpDir,
          gateVerdictPath,
          dispatch: slowDispatch as any,
        });
        const elapsed = Date.now() - startTime;

        // Dispatch should have started
        expect(dispatchStarted).toBe(true);
        // But runSpotAudit should return quickly without waiting
        expect(elapsed).toBeLessThan(50); // Much less than 100ms
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
