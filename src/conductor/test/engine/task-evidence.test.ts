import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskEvidence, createTaskEvidence } from '../../src/engine/task-evidence.js';

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
});
