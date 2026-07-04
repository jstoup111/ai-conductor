import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { snapshotPipeline, diffPipeline } from '../../test/pipeline-leak-guard.js';

describe('pipeline-leak-guard: snapshotPipeline & diffPipeline', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tmpDir = join(tmpdir(), `pipeline-leak-guard-test-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup: remove tmpDir
    const { rmSync } = await import('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Test 1: flags a file added under .pipeline/', () => {
    it('detects when a new file is added under .pipeline/', async () => {
      // Snapshot BEFORE: .pipeline does not exist
      const before = await snapshotPipeline(tmpDir);
      expect(before.exists).toBe(false);
      expect(before.entries.size).toBe(0);

      // Add a .pipeline directory with a file
      await mkdir(join(tmpDir, '.pipeline'), { recursive: true });
      await writeFile(join(tmpDir, '.pipeline', 'HALT'), 'test content');

      // Snapshot AFTER: .pipeline now has a file
      const after = await snapshotPipeline(tmpDir);
      expect(after.exists).toBe(true);
      expect(after.entries.size).toBeGreaterThan(0);

      // Diff should flag the file as added
      const diff = diffPipeline(before, after);
      expect(diff.added).toContain('.pipeline/HALT');
      expect(diff.modified.length).toBe(0);
    });
  });

  describe('Test 2: flags a modified (mtime/size changed) pre-existing file', () => {
    it('detects when a pre-existing file is modified', async () => {
      // Setup: create .pipeline with an initial file
      await mkdir(join(tmpDir, '.pipeline'), { recursive: true });
      await writeFile(join(tmpDir, '.pipeline', 'config.txt'), 'v1');

      // Snapshot BEFORE
      const before = await snapshotPipeline(tmpDir);
      expect(before.exists).toBe(true);
      expect(before.entries.has('.pipeline/config.txt')).toBe(true);

      // Modify the file (small delay to ensure mtime changes)
      await new Promise(resolve => setTimeout(resolve, 100));
      await writeFile(join(tmpDir, '.pipeline', 'config.txt'), 'v2 modified');

      // Snapshot AFTER
      const after = await snapshotPipeline(tmpDir);
      expect(after.entries.has('.pipeline/config.txt')).toBe(true);

      // Verify the metadata actually changed
      const beforeMeta = before.entries.get('.pipeline/config.txt');
      const afterMeta = after.entries.get('.pipeline/config.txt');
      expect(beforeMeta).toBeDefined();
      expect(afterMeta).toBeDefined();
      expect(beforeMeta!.size).toBe(2); // "v1"
      expect(afterMeta!.size).toBe(11); // "v2 modified"

      // Diff should flag the file as modified
      const diff = diffPipeline(before, after);
      expect(diff.modified).toContain('.pipeline/config.txt');
      expect(diff.added.length).toBe(0);
    });
  });

  describe('Test 3: returns empty for an untouched pre-existing .pipeline/ (no false positive)', () => {
    it('detects no changes when .pipeline/ is untouched', async () => {
      // Setup: create .pipeline with a file
      await mkdir(join(tmpDir, '.pipeline'), { recursive: true });
      await writeFile(join(tmpDir, '.pipeline', 'config.txt'), 'stable content');

      // Snapshot BEFORE
      const before = await snapshotPipeline(tmpDir);
      expect(before.exists).toBe(true);

      // Wait a bit, then take another snapshot without modifying anything
      await new Promise(resolve => setTimeout(resolve, 100));

      // Snapshot AFTER (no changes made)
      const after = await snapshotPipeline(tmpDir);

      // Diff should be empty
      const diff = diffPipeline(before, after);
      expect(diff.added.length).toBe(0);
      expect(diff.modified.length).toBe(0);
    });
  });

  describe('Test 4: returns empty when .pipeline never existed', () => {
    it('returns empty diff when .pipeline directory never existed', async () => {
      // Snapshot BEFORE: .pipeline does not exist
      const before = await snapshotPipeline(tmpDir);
      expect(before.exists).toBe(false);

      // Wait a bit, then take another snapshot without creating anything
      await new Promise(resolve => setTimeout(resolve, 100));

      // Snapshot AFTER: still no .pipeline
      const after = await snapshotPipeline(tmpDir);
      expect(after.exists).toBe(false);

      // Diff should be empty
      const diff = diffPipeline(before, after);
      expect(diff.added.length).toBe(0);
      expect(diff.modified.length).toBe(0);
    });
  });
});
