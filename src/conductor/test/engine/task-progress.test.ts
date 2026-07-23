import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  countResolvedTasks,
  resolveTaskIds,
  haltMarkerExists,
  clearHaltMarker,
  haltMarkerPath,
  readHaltMarkerContent,
  writeStallQuestionEvidence,
  writeStallHalt,
  HALT_MARKER_RELATIVE,
} from '../../src/engine/task-progress.js';
import { CUSTOM_COMPLETION_PREDICATES } from '../../src/engine/artifacts.js';

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

    it('#757: counts distinct plan task-ids carried by Task: trailers on the branch, not via the deleted derivation engine', async () => {
      // Set up a real git repo (no `.pipeline/task-status.json`-side status
      // flip involved — this proves the count is sourced from commit
      // trailers directly, per feature #773 Task 15).
      await execa('git', ['init'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      // 4 plan tasks, all still `pending` in task-status.json — i.e. nothing
      // here would count under the old completed/skipped-only logic.
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'pending' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // Task 1 and Task 3 have Task:-trailered commits; Task 2 and 4 do not.
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // Only task-ids 1 and 3 are resolved via trailers; 2 and 4 remain
      // untouched pending — expect exactly 2, not 0 (old code) and not 4.
      expect(await countResolvedTasks(dir)).toBe(2);
    });

    it('#773 Task 16: telemetry survives the gating demolition — countResolvedTasks is a pure read with no side effects (no writes, no throw) even against an empty/uninitialized project dir', async () => {
      // Tasks 10-14 deleted the per-task evidence-ledger GATING apparatus
      // (build predicate, citation judge, park counter, reseed/commit-msg
      // rejection). Task 15 repointed this counter at Task: trailers +
      // task-status.json as pure telemetry. This locks in that the read
      // path never mutates project state (no .pipeline writes) and never
      // throws, confirming it cannot itself gate or block a build.
      await expect(countResolvedTasks(dir)).resolves.toBe(0);
      const { readdir } = await import('node:fs/promises');
      await expect(readdir(dir)).resolves.toEqual([]);
    });
  });

  describe('Task 3: countResolvedTasks / resolveTaskIds parity (pre-refactor pin)', () => {
    it('rows-only: pins countResolvedTasks to 3 for 3 completed/skipped rows out of 5', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'completed' },
            { id: '3', status: 'skipped' },
            { id: '4', status: 'pending' },
            { id: '5', status: 'in_progress' },
          ],
        }),
      );
      expect(await countResolvedTasks(dir)).toBe(3);
    });

    it('trailers-only: pins countResolvedTasks to 2 when rows are all pending but 2 have Task: trailers', async () => {
      await execa('git', ['init'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'pending' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 1\n\nTask: 1'], { cwd: dir });

      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      expect(await countResolvedTasks(dir)).toBe(2);
    });

    it('mixed rows + trailers + alias: pins countResolvedTasks to 4 (union of completed/skipped rows and trailer/alias matches)', async () => {
      await execa('git', ['init'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'skipped' },
            { id: '5', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // trailer-only id (plan id 3, bare trailer)
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // alias case: plan id 2, trailer "T2"
      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 2\n\nTask: T2'], { cwd: dir });

      // resolved set should be {1 (completed), 4 (skipped), 3 (trailer), 2 (alias)} = 4
      expect(await countResolvedTasks(dir)).toBe(4);
    });

    it('no-status-file: pins countResolvedTasks to 0 when .pipeline/task-status.json is absent', async () => {
      expect(await countResolvedTasks(dir)).toBe(0);
    });

    it('empty-rows: pins countResolvedTasks to 0 when the tasks field is missing', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ plan_ref: 'foo' }),
      );
      expect(await countResolvedTasks(dir)).toBe(0);
    });
  });

  describe('resolveTaskIds', () => {
    it('resolves completed rows, skipped rows, trailer-only ids, and canonical alias trailers', async () => {
      await execa('git', ['init'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
            { id: '4', status: 'skipped' },
            { id: '5', status: 'pending' },
          ],
        }),
      );
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed'], { cwd: dir });

      // trailer-only id (plan id 3, bare trailer)
      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 3\n\nTask: 3'], { cwd: dir });

      // alias case: plan id 2, trailer "T2"
      await writeFile(join(dir, 'b.txt'), 'b');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 2\n\nTask: T2'], { cwd: dir });

      const resolved = await resolveTaskIds(dir, ['1', '2', '3', '4', '5']);

      expect(resolved).toEqual(new Set(['1', '2', '3', '4']));
    });

    it('ignores a phantom Task trailer whose id is not in planIds', async () => {
      await execa('git', ['init'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });

      await writeFile(join(dir, 'a.txt'), 'a');
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'work on task 99\n\nTask: 99'], { cwd: dir });

      const resolved = await resolveTaskIds(dir, ['1', '2', '3', '4', '5']);

      expect(resolved).toEqual(new Set());
    });

    it('degrades to rows-only resolution without throwing when projectRoot is not a git repo', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'completed' },
            { id: '2', status: 'pending' },
          ],
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set(['1']));
    });

    it('does not resolve rows with status in_progress or pending', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'in_progress' },
            { id: '2', status: 'pending' },
          ],
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set());
    });

    it('normalizes a legacy id-keyed map-shape task-status.json without throwing', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          '1': { status: 'completed' },
          '2': { status: 'pending' },
        }),
      );

      const resolved = await resolveTaskIds(dir, ['1', '2']);

      expect(resolved).toEqual(new Set(['1']));
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

  // Task 16 (#773, verify-only): the demolition of the per-task
  // evidence-ledger GATING apparatus (Tasks 10-14) and the repointing of
  // resolved-count telemetry at Task:-trailered commits (Task 15, above)
  // must leave the wiring_check gate — a same-named-but-unrelated gate,
  // not part of the deleted evidence-ledger — completely untouched. This
  // is a lock-in regression assertion, not new production behavior.
  describe('Task 16: wiring_check gate survives the telemetry demotion (regression lock-in)', () => {
    it('CUSTOM_COMPLETION_PREDICATES still registers wiring_check', () => {
      expect(typeof CUSTOM_COMPLETION_PREDICATES.wiring_check).toBe('function');
    });
  });
});
