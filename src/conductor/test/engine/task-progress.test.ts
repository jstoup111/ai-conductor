import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countResolvedTasks,
  haltMarkerExists,
  clearHaltMarker,
  haltMarkerPath,
  readHaltMarkerContent,
  writeStallQuestionEvidence,
  writeStallHalt,
  HALT_MARKER_RELATIVE,
} from '../../src/engine/task-progress.js';

describe('task-progress', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-progress-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('countResolvedTasks', () => {
    it('returns 0 when .pipeline/task-status.json is absent', async () => {
      const count = await countResolvedTasks(dir);
      expect(count).toBe(0);
    });

    it('returns 0 when the file is not valid JSON', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/task-status.json'), 'not json');
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('counts completed + skipped tasks in the array shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 1, status: 'completed' },
            { id: 2, status: 'completed' },
            { id: 3, status: 'skipped' },
            { id: 4, status: 'pending' },
            { id: 5, status: 'in_progress' },
          ],
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('counts completed + skipped tasks in the id-keyed map shape', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: {
            '1': { status: 'completed' },
            '2': { status: 'pending' },
            '3': { status: 'skipped' },
            '4': { status: 'completed' },
          },
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('returns 0 when the tasks field is missing or empty', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: 'foo' }),
      );
      expect(await countResolvedTasks(dir)).toBe(0);
    });
  });

  describe('halt marker', () => {
    it('haltMarkerPath returns the project-relative location', () => {
      expect(haltMarkerPath(dir)).toBe(join(dir, HALT_MARKER_RELATIVE));
    });

    it('haltMarkerExists returns false when missing', async () => {
      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('haltMarkerExists returns true when present', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'blocker');
      expect(await haltMarkerExists(dir)).toBe(true);
    });

    it('clearHaltMarker removes an existing marker', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'x');

      await clearHaltMarker(dir);

      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('clearHaltMarker is safe to call when the marker is absent', async () => {
      await clearHaltMarker(dir);
      expect(await haltMarkerExists(dir)).toBe(false);
    });

    it('readHaltMarkerContent returns null when the file does not exist', async () => {
      const content = await readHaltMarkerContent(dir);
      expect(content).toBeNull();
    });

    it('readHaltMarkerContent returns the raw string when the file exists', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'blocker reason');
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('blocker reason');
    });

    it('readHaltMarkerContent returns exact multi-line content', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const multiLine = 'line 1\nline 2\nline 3';
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), multiLine);
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe(multiLine);
    });

    it('readHaltMarkerContent returns empty string when file is empty', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), '');
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('');
    });

    it('readHaltMarkerContent returns raw string with whitespace preserved', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const whitespaceContent = '  spaces  \n\ttabs\t  ';
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), whitespaceContent);
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe(whitespaceContent);
    });
  });

  describe('writeStallQuestionEvidence', () => {
    it('writes multi-line content verbatim to .pipeline/build-stall-question.md and returns it', async () => {
      const content = 'line 1\nline 2\nline 3';
      const result = await writeStallQuestionEvidence(dir, content);
      expect(result).toBe(content);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(content);
    });

    it('writes placeholder when content is null', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, null);
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('writes placeholder when content is empty string', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, '');
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('writes placeholder when content is whitespace-only', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const result = await writeStallQuestionEvidence(dir, '   \n\t  \n  ');
      expect(result).toBe(placeholder);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(placeholder);
    });

    it('creates .pipeline directory if it does not exist', async () => {
      const content = 'test content';
      await writeStallQuestionEvidence(dir, content);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(content);
    });

    it('overwrites existing file (idempotent semantics)', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/build-stall-question.md'), 'old content');

      const newContent = 'new content';
      const result = await writeStallQuestionEvidence(dir, newContent);

      expect(result).toBe(newContent);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(newContent);
    });

    it('preserves exact whitespace in content (no trimming)', async () => {
      const contentWithWhitespace = '  leading\nmiddle  \ntrailing  ';
      const result = await writeStallQuestionEvidence(dir, contentWithWhitespace);
      expect(result).toBe(contentWithWhitespace);
      const written = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(written).toBe(contentWithWhitespace);
    });
  });

  describe('negative paths (Task 10: stall capture negative paths)', () => {
    it('readHaltMarkerContent gracefully handles ENOENT race (marker unlinked between check and read)', async () => {
      // This test simulates a race condition where:
      // 1. haltMarkerExists returns true (file exists)
      // 2. File is deleted before readHaltMarkerContent runs
      // 3. readHaltMarkerContent should return null (not crash)
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'transient marker');

      // Verify marker exists
      expect(await haltMarkerExists(dir)).toBe(true);

      // Simulate deletion race: read should return null, not throw
      const content = await readHaltMarkerContent(dir);
      expect(content).toBe('transient marker');

      // Now actually delete it and verify graceful null return
      await rm(join(dir, '.pipeline/halt-user-input-required'));
      const contentAfterDelete = await readHaltMarkerContent(dir);
      expect(contentAfterDelete).toBeNull();
    });

    it('writeStallHalt writes empty marker as placeholder on first line', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation budget exhausted';

      await writeStallHalt(dir, '', detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
    });

    it('writeStallHalt writes whitespace-only marker as placeholder on first line', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation budget exhausted';

      await writeStallHalt(dir, '   \n\t  ', detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
    });

    it('writeStallHalt with multi-line marker writes first line verbatim to HALT', async () => {
      const question = 'Should we use Auth0?\nOr Cognito?\nOr Okta?';
      const detail = 'Need product decision';

      await writeStallHalt(dir, question, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const lines = written.split('\n').filter((l) => l.length > 0);
      // First line should be the first line of the question (before newline)
      expect(lines[0]).toBe('Should we use Auth0?');
      expect(written).toContain(detail);
    });

    it('writeStallHalt with null question uses placeholder', async () => {
      const placeholder = '(agent wrote no reason into halt-user-input-required)';
      const detail = 'remediation failed';

      await writeStallHalt(dir, null, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      const firstLine = written.split('\n')[0];
      expect(firstLine).toBe(placeholder);
      expect(written).toContain(detail);
    });

    it('writeStallHalt creates .pipeline directory if missing', async () => {
      const question = 'Test question';
      const detail = 'Test detail';

      // Ensure .pipeline does not exist
      expect(await haltMarkerExists(dir)).toBe(false);

      await writeStallHalt(dir, question, detail);

      const written = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(written).toContain(question);
      expect(written).toContain(detail);
    });

    it('writeStallQuestionEvidence and writeStallHalt work together for capture/clear/evidence ordering', async () => {
      const question = 'First line question\nSecond line context';

      // Simulate stall capture flow (Task 3):
      // 1. Marker is written by build step
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/halt-user-input-required'), question);

      // 2. Read marker content
      const markerContent = await readHaltMarkerContent(dir);
      expect(markerContent).toBe(question);

      // 3. Write evidence from marker
      const evidence = await writeStallQuestionEvidence(dir, markerContent);
      expect(evidence).toBe(question);
      const evidenceFile = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
      expect(evidenceFile).toBe(question);

      // 4. Clear marker
      await clearHaltMarker(dir);
      expect(await haltMarkerExists(dir)).toBe(false);

      // 5. Write HALT for degraded remediation (uses the captured evidence)
      const detail = 'remediation threw an error';
      await writeStallHalt(dir, evidence, detail);

      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      // HALT should have first line of the original question
      expect(halt).toContain('First line question');
      expect(halt).toContain(detail);
    });
  });
});
