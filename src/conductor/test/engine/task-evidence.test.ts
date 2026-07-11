import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TaskEvidence,
  createTaskEvidence,
  incrementNoEvidenceAttempts,
  resetNoEvidenceAttempts,
  NO_EVIDENCE_REASON_DESCRIPTIONS,
  writeJudgedStamps,
} from '../../src/engine/task-evidence.js';

describe('task-evidence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-evidence-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('returns empty state when sidecar file is absent', async () => {
      const evidence = await createTaskEvidence(dir);
      expect(evidence.evidenceStamps.size).toBe(0);
      expect(evidence.noEvidenceAttempts).toBe(0);
      expect(evidence.migrationGrandfather.size).toBe(0);
    });

    it('returns empty state + logs when JSON is corrupt', async () => {
      const sidecarPath = join(dir, '.pipeline');
      await mkdir(sidecarPath, { recursive: true });
      await writeFile(join(sidecarPath, 'task-evidence.json'), 'not valid json {');

      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const evidence = await createTaskEvidence(dir);

      expect(evidence.evidenceStamps.size).toBe(0);
      expect(evidence.noEvidenceAttempts).toBe(0);
      expect(evidence.migrationGrandfather.size).toBe(0);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][0]).toMatch(/corrupt|parse|task-evidence/i);

      logSpy.mockRestore();
    });

    it('returns empty state when file contains invalid schema', async () => {
      const sidecarPath = join(dir, '.pipeline');
      await mkdir(sidecarPath, { recursive: true });
      await writeFile(
        join(sidecarPath, 'task-evidence.json'),
        JSON.stringify({ invalid: 'schema' }),
      );

      const evidence = await createTaskEvidence(dir);

      expect(evidence.evidenceStamps.size).toBe(0);
      expect(evidence.noEvidenceAttempts).toBe(0);
      expect(evidence.migrationGrandfather.size).toBe(0);
    });

    it('loads evidence stamps from valid sidecar', async () => {
      const sidecarPath = join(dir, '.pipeline');
      await mkdir(sidecarPath, { recursive: true });
      await writeFile(
        join(sidecarPath, 'task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {
            'task-1': { sha: 'abc123', form: 'commit' },
            'task-2': { sha: 'def456', form: 'pr' },
          },
          noEvidenceAttempts: 5,
          migrationGrandfather: ['old-task-1', 'old-task-2'],
        }),
      );

      const evidence = await createTaskEvidence(dir);

      expect(evidence.evidenceStamps.size).toBe(2);
      expect(evidence.evidenceStamps.get('task-1')).toEqual({ sha: 'abc123', form: 'commit' });
      expect(evidence.evidenceStamps.get('task-2')).toEqual({ sha: 'def456', form: 'pr' });
      expect(evidence.noEvidenceAttempts).toBe(5);
      expect(evidence.migrationGrandfather.size).toBe(2);
      expect(evidence.migrationGrandfather.has('old-task-1')).toBe(true);
    });
  });

  describe('write()', () => {
    it('writes evidence state atomically with temp-file + rename', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('task-1', { sha: 'abc123', form: 'commit' });
      evidence.noEvidenceAttempts = 3;
      evidence.migrationGrandfather.add('old-task');

      await evidence.write();

      const sidecarPath = join(dir, '.pipeline/task-evidence.json');
      const content = await readFile(sidecarPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.evidenceStamps).toEqual({
        'task-1': { sha: 'abc123', form: 'commit' },
      });
      expect(parsed.noEvidenceAttempts).toBe(3);
      expect(parsed.migrationGrandfather).toEqual(['old-task']);
    });

    it('creates .pipeline directory if absent', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('task-1', { sha: 'test', form: 'commit' });

      await evidence.write();

      const sidecarPath = join(dir, '.pipeline/task-evidence.json');
      const stat = await lstat(sidecarPath);
      expect(stat.isFile()).toBe(true);
    });

    it('preserves Map and Set types on round-trip', async () => {
      const evidence1 = await createTaskEvidence(dir);
      evidence1.evidenceStamps.set('t1', { sha: 'a', form: 'commit' });
      evidence1.evidenceStamps.set('t2', { sha: 'b', form: 'pr' });
      evidence1.noEvidenceAttempts = 2;
      evidence1.migrationGrandfather.add('old1');
      evidence1.migrationGrandfather.add('old2');

      await evidence1.write();

      const evidence2 = await createTaskEvidence(dir);

      expect(evidence2.evidenceStamps).toBeInstanceOf(Map);
      expect(evidence2.evidenceStamps.size).toBe(2);
      expect(evidence2.migrationGrandfather).toBeInstanceOf(Set);
      expect(evidence2.migrationGrandfather.size).toBe(2);
      expect(evidence2.noEvidenceAttempts).toBe(2);
    });

    it('is idempotent — multiple writes preserve state', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('t1', { sha: 'v1', form: 'commit' });
      evidence.noEvidenceAttempts = 1;
      evidence.migrationGrandfather.add('old');

      await evidence.write();
      await evidence.write();

      const evidence2 = await createTaskEvidence(dir);
      expect(evidence2.evidenceStamps.get('t1')).toEqual({ sha: 'v1', form: 'commit' });
      expect(evidence2.noEvidenceAttempts).toBe(1);
      expect(evidence2.migrationGrandfather.has('old')).toBe(true);
    });

    it('handles concurrent writes safely (last write wins)', async () => {
      const evidence1 = await createTaskEvidence(dir);
      evidence1.evidenceStamps.set('t1', { sha: 'first', form: 'commit' });

      const evidence2 = await createTaskEvidence(dir);
      evidence2.evidenceStamps.set('t2', { sha: 'second', form: 'pr' });

      // Concurrent writes
      await Promise.all([evidence1.write(), evidence2.write()]);

      const evidence3 = await createTaskEvidence(dir);
      // Last write should be present; which one wins depends on timing
      expect(evidence3.evidenceStamps.size).toBeGreaterThan(0);
    });

    it('converts Map and Set to JSON-serializable format', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('t1', { sha: 'test', form: 'commit' });
      evidence.migrationGrandfather.add('old1');
      evidence.migrationGrandfather.add('old2');

      await evidence.write();

      const sidecarPath = join(dir, '.pipeline/task-evidence.json');
      const raw = await readFile(sidecarPath, 'utf-8');
      // Should be valid JSON, no Map/Set stringification artifacts
      expect(() => JSON.parse(raw)).not.toThrow();
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed.migrationGrandfather)).toBe(true);
      expect(typeof parsed.evidenceStamps).toBe('object');
    });
  });

  describe('evidence stamps structure', () => {
    it('stores taskId → {sha, form} mappings', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('task-123', { sha: 'deadbeef', form: 'commit' });
      evidence.evidenceStamps.set('task-456', { sha: 'cafebabe', form: 'pr' });

      expect(evidence.evidenceStamps.get('task-123')).toEqual({
        sha: 'deadbeef',
        form: 'commit',
      });
      expect(evidence.evidenceStamps.get('task-456')).toEqual({
        sha: 'cafebabe',
        form: 'pr',
      });
    });
  });

  describe('noEvidenceAttempts', () => {
    it('tracks attempt counter as a number', async () => {
      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceAttempts).toBe(0);

      evidence.noEvidenceAttempts = 5;
      expect(evidence.noEvidenceAttempts).toBe(5);

      evidence.noEvidenceAttempts += 1;
      expect(evidence.noEvidenceAttempts).toBe(6);
    });
  });

  // #505 TS-16: zero-work kickback — noEvidenceReasons tags accrue alongside
  // the noEvidenceAttempts counter so the ledger records WHY a miss happened,
  // not just that it did.
  describe('noEvidenceReasons', () => {
    it('defaults to an empty array', async () => {
      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceReasons).toEqual([]);
    });

    it('round-trips through write/read', async () => {
      const evidence1 = await createTaskEvidence(dir);
      evidence1.noEvidenceAttempts = 1;
      evidence1.noEvidenceReasons.push('zero_work_product');
      await evidence1.write();

      const evidence2 = await createTaskEvidence(dir);
      expect(evidence2.noEvidenceReasons).toEqual(['zero_work_product']);
    });

    it('reads old sidecars missing noEvidenceReasons as an empty array', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-evidence.json'),
        JSON.stringify({
          evidenceStamps: {},
          noEvidenceAttempts: 2,
          migrationGrandfather: [],
        }),
      );

      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceAttempts).toBe(2);
      expect(evidence.noEvidenceReasons).toEqual([]);
    });

    it('incrementNoEvidenceAttempts appends the given reason', async () => {
      const count = await incrementNoEvidenceAttempts(dir, 'zero_work_product');
      expect(count).toBe(1);

      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceReasons).toEqual(['zero_work_product']);
    });

    it('incrementNoEvidenceAttempts without a reason leaves reasons untouched', async () => {
      await incrementNoEvidenceAttempts(dir);
      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceReasons).toEqual([]);
    });

    it('resetNoEvidenceAttempts clears both the counter and the reasons', async () => {
      await incrementNoEvidenceAttempts(dir, 'zero_work_product');
      await resetNoEvidenceAttempts(dir);

      const evidence = await createTaskEvidence(dir);
      expect(evidence.noEvidenceAttempts).toBe(0);
      expect(evidence.noEvidenceReasons).toEqual([]);
    });

    it('has a resolvable, descriptive entry for zero_work_product', () => {
      const description = NO_EVIDENCE_REASON_DESCRIPTIONS.zero_work_product;
      expect(description).toBeTruthy();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(10);
    });
  });

  describe('migrationGrandfather', () => {
    it('tracks task IDs as a Set', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.migrationGrandfather.add('old-task-1');
      evidence.migrationGrandfather.add('old-task-2');

      expect(evidence.migrationGrandfather.has('old-task-1')).toBe(true);
      expect(evidence.migrationGrandfather.has('old-task-2')).toBe(true);
      expect(evidence.migrationGrandfather.has('old-task-3')).toBe(false);
      expect(evidence.migrationGrandfather.size).toBe(2);
    });
  });

  describe('writeJudgedStamps', () => {
    it('validated tasks get stamps with form=semantic-verified and required fields', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('old-task', { sha: 'aaa111', form: 'commit' });
      await evidence.write();

      const validated = [
        {
          taskId: '7',
          sha: 'abc123def456',
          citedShas: ['abc123def456'],
          verdictAnchor: 'head999',
          testEvidence: { command: 'npm test', exit: 0 },
        },
        {
          taskId: '9',
          sha: 'def456abc123',
          citedShas: ['def456abc123', 'fedd200'],
          verdictAnchor: 'head999',
          testEvidence: { command: 'npm test', exit: 0 },
        },
      ];

      await writeJudgedStamps(dir, validated, []);

      const written = await createTaskEvidence(dir);
      expect(written.evidenceStamps.size).toBe(3); // old-task + 7 + 9
      expect(written.evidenceStamps.get('7')).toEqual({
        sha: 'abc123def456',
        form: 'semantic-verified',
        citedShas: ['abc123def456'],
        verdictAnchor: 'head999',
        testEvidence: { command: 'npm test', exit: 0 },
      });
      expect(written.evidenceStamps.get('9')).toEqual({
        sha: 'def456abc123',
        form: 'semantic-verified',
        citedShas: ['def456abc123', 'fedd200'],
        verdictAnchor: 'head999',
        testEvidence: { command: 'npm test', exit: 0 },
      });
    });

    it('pre-existing stamp entries remain byte-identical after write', async () => {
      // Create a sidecar with a pre-existing stamp
      const sidecarDir = join(dir, '.pipeline');
      await mkdir(sidecarDir, { recursive: true });
      const originalContent = {
        evidenceStamps: {
          'task-1': { sha: 'existing-sha', form: 'trailer' },
          'task-2': { sha: 'another-sha', form: 'evidence:satisfied-by' },
        },
        noEvidenceAttempts: 2,
        noEvidenceReasons: ['zero_work_product'],
        migrationGrandfather: ['old-task'],
      };
      await writeFile(
        join(sidecarDir, 'task-evidence.json'),
        JSON.stringify(originalContent, null, 2) + '\n',
        'utf-8',
      );

      // Write judged stamps
      const validated = [
        {
          taskId: '10',
          sha: 'newsha111',
          citedShas: ['newsha111'],
          verdictAnchor: 'headabc',
          testEvidence: { command: 'test', exit: 0 },
        },
      ];
      await writeJudgedStamps(dir, validated, []);

      // Read back and verify
      const sidecarPath = join(sidecarDir, 'task-evidence.json');
      const content = await readFile(sidecarPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Pre-existing stamps should be exactly as they were
      expect(parsed.evidenceStamps['task-1']).toEqual({
        sha: 'existing-sha',
        form: 'trailer',
      });
      // task-2 also preserved
      expect(parsed.evidenceStamps['task-2']).toEqual({
        sha: 'another-sha',
        form: 'evidence:satisfied-by',
      });
      // New stamp added
      expect(parsed.evidenceStamps['10']).toEqual({
        sha: 'newsha111',
        form: 'semantic-verified',
        citedShas: ['newsha111'],
        verdictAnchor: 'headabc',
        testEvidence: { command: 'test', exit: 0 },
      });
      // Metadata untouched
      expect(parsed.noEvidenceAttempts).toBe(2);
      expect(parsed.noEvidenceReasons).toEqual(['zero_work_product']);
    });

    it('refused tasks absent from sidecar', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('completed-7', { sha: 'sha777', form: 'commit' });
      await evidence.write();

      const validated = [
        {
          taskId: '8',
          sha: 'valid-sha',
          citedShas: ['valid-sha'],
          verdictAnchor: 'head999',
          testEvidence: { command: 'test', exit: 0 },
        },
      ];
      const refused = ['9', '10']; // these should NOT get stamps

      await writeJudgedStamps(dir, validated, refused);

      const written = await createTaskEvidence(dir);
      expect(written.evidenceStamps.size).toBe(2); // completed-7 + 8
      expect(written.evidenceStamps.has('8')).toBe(true);
      expect(written.evidenceStamps.has('9')).toBe(false);
      expect(written.evidenceStamps.has('10')).toBe(false);
      expect(written.evidenceStamps.has('completed-7')).toBe(true);
    });

    it('optional fields serialize correctly on write and deserialize on read', async () => {
      // Write with all optional fields present
      const validated = [
        {
          taskId: '5',
          sha: 'full-sha-40-chars-long-' + 'x'.repeat(16),
          citedShas: ['ssha1', 'ssha2'],
          verdictAnchor: 'anchor-sha',
          testEvidence: { command: 'vitest run', exit: 0, summary: '12 passed' },
        },
      ];

      await writeJudgedStamps(dir, validated, []);

      // Read the file as JSON and verify structure
      const sidecarPath = join(dir, '.pipeline/task-evidence.json');
      const rawJson = await readFile(sidecarPath, 'utf-8');
      const parsed = JSON.parse(rawJson);

      expect(parsed.evidenceStamps['5']).toMatchObject({
        sha: expect.any(String),
        form: 'semantic-verified',
        citedShas: expect.arrayContaining(['ssha1', 'ssha2']),
        verdictAnchor: 'anchor-sha',
        testEvidence: { command: 'vitest run', exit: 0, summary: '12 passed' },
      });

      // Round-trip: read back via createTaskEvidence
      const evidence = await createTaskEvidence(dir);
      expect(evidence.evidenceStamps.get('5')).toEqual({
        sha: validated[0].sha,
        form: 'semantic-verified',
        citedShas: ['ssha1', 'ssha2'],
        verdictAnchor: 'anchor-sha',
        testEvidence: { command: 'vitest run', exit: 0, summary: '12 passed' },
      });
    });

    it('handles multiple validated tasks and merges with existing stamps', async () => {
      const evidence = await createTaskEvidence(dir);
      evidence.evidenceStamps.set('pre-existing-1', { sha: 'presha1', form: 'commit' });
      evidence.noEvidenceAttempts = 1;
      await evidence.write();

      const validated = [
        {
          taskId: '11',
          sha: 'sha-11-aaaa',
          citedShas: ['sha-11-aaaa'],
          verdictAnchor: 'head-batch-1',
          testEvidence: { command: 'test 11', exit: 0 },
        },
        {
          taskId: '12',
          sha: 'sha-12-bbbb',
          citedShas: ['sha-12-bbbb'],
          verdictAnchor: 'head-batch-1',
          testEvidence: { command: 'test 12', exit: 0 },
        },
      ];

      await writeJudgedStamps(dir, validated, []);

      const written = await createTaskEvidence(dir);
      expect(written.evidenceStamps.size).toBe(3); // pre-existing-1 + 11 + 12
      expect(written.evidenceStamps.get('11')).toBeDefined();
      expect(written.evidenceStamps.get('12')).toBeDefined();
      expect(written.evidenceStamps.get('pre-existing-1')).toBeDefined();
      // Metadata should be preserved
      expect(written.noEvidenceAttempts).toBe(1);
    });

    it('split attribution: multiple tasks citing overlapping SHAs', async () => {
      const validated = [
        {
          taskId: '3',
          sha: 'shared-sha-100',
          citedShas: ['shared-sha-100', 'other-sha-1'],
          verdictAnchor: 'head-split',
          testEvidence: { command: 'test 3', exit: 0 },
        },
        {
          taskId: '4',
          sha: 'shared-sha-100', // same SHA, different task
          citedShas: ['shared-sha-100', 'other-sha-2'],
          verdictAnchor: 'head-split',
          testEvidence: { command: 'test 4', exit: 0 },
        },
      ];

      await writeJudgedStamps(dir, validated, []);

      const written = await createTaskEvidence(dir);
      expect(written.evidenceStamps.get('3')?.citedShas).toContain('shared-sha-100');
      expect(written.evidenceStamps.get('4')?.citedShas).toContain('shared-sha-100');
      // But each task's citedShas list is independent
      expect(written.evidenceStamps.get('3')?.citedShas).toEqual(['shared-sha-100', 'other-sha-1']);
      expect(written.evidenceStamps.get('4')?.citedShas).toEqual(['shared-sha-100', 'other-sha-2']);
    });
  });
});
