import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

// END-TO-END acceptance specs for #433's git-hook attribution machinery
// (Stories 4, 5, and Story 6's chaining clause). These drive REAL git commits
// in a REAL scratch repo wired by the REAL `prepareWorktree` — no mocking of
// git, the hooks, or task-status.json. None of `git-hook-assets.ts` /
// `task-cli.ts` exist yet, so every test here is expected to fail on import
// or on its behavioral assertion (RED) until Tasks 1, 3, 9, 10, 12-17 of the
// plan land. See .docs/plans/deterministic-evidence-attribution.md.

const execFileAsync = promisify(execFile);

describe('integration/git-hooks-attribution', () => {
  let dir: string;

  async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
      return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
    }
  }

  async function lastCommitMessage(): Promise<string> {
    const { stdout } = await git('log', '-1', '--format=%B');
    return stdout;
  }

  async function seedTaskStatus(rows: Array<{ id: string; status: string }>): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: rows.map((r) => ({ id: r.id, name: `task ${r.id}`, status: r.status })) }, null, 2),
      'utf-8',
    );
  }

  async function writeCurrentTask(id: string): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'current-task'), id, 'utf-8');
  }

  async function createBuildStepActive(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'build-step-active'), '', 'utf-8');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-hooks-attr-'));
    await git('init', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await writeFile(join(dir, 'README.md'), '# scratch\n', 'utf-8');
    await git('add', '.');
    await git('commit', '-m', 'chore: initial commit');
    // Wires the two attribution hooks per-worktree (Story 6 happy path 1-2).
    await prepareWorktree(dir);
    await seedTaskStatus(Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), status: 'pending' })));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function commitFile(name: string, body: string, message: string): Promise<{ stdout: string; code: number }> {
    await writeFile(join(dir, name), body, 'utf-8');
    await git('add', name);
    return git('commit', '-m', message);
  }

  // --- Story 4: prepare-commit-msg auto-stamps the Task: trailer ---

  describe('Story 4: auto-stamp trailer', () => {
    it('stamps Task: <id> from current-task on an untrailered commit', async () => {
      await writeCurrentTask('7');
      const res = await commitFile('a.txt', 'a', 'feat: add waker retry');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 7$/m);
    });

    it('reconciles a self-stamped Task: trailer to the engine current-task id (engine wins)', async () => {
      await writeCurrentTask('7');
      const res = await commitFile('b.txt', 'b', 'feat: add thing\n\nTask: 9');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 7$/m);
      expect(msg).not.toMatch(/^Task: 9$/m);
    });

    it('is a no-op when the self-stamped Task: trailer already agrees with current-task (no duplicate trailer)', async () => {
      await writeCurrentTask('10');
      const res = await commitFile('b3.txt', 'b3', 'feat: add thing\n\nTask: 10');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      const matches = msg.match(/^Task: 10$/gm) ?? [];
      expect(matches).toHaveLength(1);
    });

    it('reconciles to current-task even when the old id also appears in the commit body (not confused by body text)', async () => {
      await writeCurrentTask('7');
      const res = await commitFile(
        'b2.txt',
        'b2',
        'feat: add thing\n\nSee also task 9 in the backlog for related work.\n\nTask: 9',
      );
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 7$/m);
      expect(msg).not.toMatch(/^Task: 9$/m);
      expect(msg).toContain('See also task 9 in the backlog for related work.');
    });

    it('abstains when current-task is absent, even with a sole in_progress row', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'in_progress' },
        { id: '3', status: 'pending' },
      ]);
      const res = await commitFile('c.txt', 'c', 'feat: no stamp, only one in_progress');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('abstains when zero rows are in_progress and current-task is absent', async () => {
      const res = await commitFile('d.txt', 'd', 'feat: no in-flight task');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('abstains when two or more rows are in_progress and current-task is absent', async () => {
      await seedTaskStatus([
        { id: '1', status: 'in_progress' },
        { id: '2', status: 'in_progress' },
      ]);
      const res = await commitFile('e.txt', 'e', 'feat: ambiguous in-flight');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('abstains during git commit --amend (never restamps an old commit)', async () => {
      await writeCurrentTask('7');
      await commitFile('f.txt', 'f', 'feat: original message');
      await writeCurrentTask('11');
      const res = await git('commit', '--amend', '-m', 'feat: amended message');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: 11$/m);
    });

    it('abstains while a rebase is in progress (replayed commits are never restamped)', async () => {
      await writeCurrentTask('3');
      await commitFile('base.txt', 'base', 'feat: base commit\n\nTask: 3');
      await git('checkout', '-b', 'feature');
      await commitFile('feat.txt', 'feat', 'feat: feature commit\n\nTask: 3');
      await git('checkout', 'main');
      await commitFile('other.txt', 'other', 'feat: unrelated main commit\n\nTask: 3');
      await writeCurrentTask('9');
      await git('checkout', 'feature');
      const rebase = await git('rebase', 'main');
      expect(rebase.code).toBe(0);
      const msg = await lastCommitMessage();
      // The replayed commit keeps its original trailer — never restamped to 9.
      expect(msg).toMatch(/^Task: 3$/m);
      expect(msg).not.toMatch(/^Task: 9$/m);
    });

    it('abstains cleanly when task-status.json is corrupt (fallback path)', async () => {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'task-status.json'), '{ not valid json', 'utf-8');
      const res = await commitFile('g.txt', 'g', 'feat: corrupt sidecar');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('abstains when there are no staged changes (message-only commit)', async () => {
      await writeCurrentTask('7');
      const res = await git('commit', '--allow-empty', '-m', 'feat: no staged changes');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('preserves an existing Task: 9 trailer unchanged when current-task is absent', async () => {
      const res = await commitFile('task3a.txt', 'a', 'feat: existing trailer, no engine task\n\nTask: 9');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 9$/m);
    });

    it('adds no trailer when current-task is absent and the message has none', async () => {
      const res = await commitFile('task3b.txt', 'b', 'feat: no trailer, no engine task');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });

    it('stamps Task: 3 from current-task on an untrailered commit (regression, unconditional branch)', async () => {
      await writeCurrentTask('3');
      const res = await commitFile('task3c.txt', 'c', 'feat: deterministic stamp still works');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 3$/m);
    });
  });

  // --- Story 5: commit-msg rejects bad attribution at commit time ---

  describe('Story 5: commit-msg validation', () => {
    it('lands a commit with a valid Task: <id> trailer and a non-empty diff', async () => {
      const res = await commitFile('h.txt', 'h', 'feat: valid trailer\n\nTask: 7');
      expect(res.code).toBe(0);
    });

    it('accepts Task: 16 when ids 1..16 are seeded (not rejected by array index bug)', async () => {
      await seedTaskStatus(Array.from({ length: 16 }, (_, i) => ({ id: String(i + 1), status: 'pending' })));
      const res = await commitFile('h_extended.txt', 'content', 'feat: last id in 16-task set\n\nTask: 16');
      expect(res.code).toBe(0);
    });

    it('accepts Task: 7 in a mid-range position', async () => {
      const res = await commitFile('h_midrange.txt', 'content', 'feat: mid-range id\n\nTask: 7');
      expect(res.code).toBe(0);
    });

    it('accepts Task: 3 with numeric-id fixture (numeric id, not string index)', async () => {
      // Fixture with numeric IDs (not stringified), e.g. from seed tooling
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 1, name: 'task 1', status: 'pending' },
            { id: 2, name: 'task 2', status: 'pending' },
            { id: 3, name: 'task 3', status: 'pending' },
          ],
        }, null, 2),
        'utf-8',
      );
      const res = await commitFile('h_numeric.txt', 'content', 'feat: numeric id fixture\n\nTask: 3');
      expect(res.code).toBe(0);
    });

    it('rejects an unknown Task: id', async () => {
      const res = await commitFile('i.txt', 'i', 'feat: bad id\n\nTask: 99');
      expect(res.code).not.toBe(0);
    });

    it('rejects a task-N style id (grammar drift)', async () => {
      const res = await commitFile('j.txt', 'j', 'feat: bad grammar\n\nTask: task-7');
      expect(res.code).not.toBe(0);
    });

    it('rejects an empty commit with a bare Task: trailer (no Evidence: satisfied-by)', async () => {
      await writeFile(join(dir, 'k.txt'), 'k', 'utf-8');
      await git('add', 'k.txt');
      await git('commit', '-m', 'feat: seed file');
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: empty commit\n\nTask: 7',
      );
      expect(res.code).not.toBe(0);
    });

    it('lands an empty commit with Task: <id> and a resolvable Evidence: satisfied-by <sha>', async () => {
      const first = await commitFile('l.txt', 'l', 'feat: seed for satisfied-by');
      expect(first.code).toBe(0);
      const sha = (await git('rev-parse', 'HEAD')).stdout;
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        `feat: evidence-only commit\n\nTask: 7\nEvidence: satisfied-by ${sha}`,
      );
      expect(res.code).toBe(0);
    });

    it('rejects Evidence: satisfied-by pointing at a nonexistent sha', async () => {
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: dangling evidence\n\nTask: 7\nEvidence: satisfied-by deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      );
      expect(res.code).not.toBe(0);
    });

    it('warns (does not block) when the staged diff spans files mapped to two plan tasks', async () => {
      // Two rows each carrying a `files` mapping so the bundling check has
      // something to compare against.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify(
          {
            tasks: [
              { id: '1', status: 'pending', files: ['one.txt'] },
              { id: '2', status: 'pending', files: ['two.txt'] },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );
      await writeFile(join(dir, 'one.txt'), '1', 'utf-8');
      await writeFile(join(dir, 'two.txt'), '2', 'utf-8');
      await git('add', 'one.txt', 'two.txt');
      const res = await git('commit', '-m', 'feat: bundled change\n\nTask: 1');
      expect(res.code).toBe(0);
      expect(res.stderr).toContain('commit-msg: WARNING — staged diff spans files of multiple plan tasks');
    });

    it('warns (does not block) on a subject-vs-trailer task mismatch', async () => {
      const res = await commitFile('m.txt', 'm', 'fix Task 5 edge case\n\nTask: 7');
      expect(res.code).toBe(0);
      expect(res.stderr).toContain('commit-msg: WARNING — subject references Task 5 but trailer is Task: 7');
    });

    it('does not reject a commit with no Task: trailer at all', async () => {
      const res = await commitFile('n.txt', 'n', 'feat: legacy untrailered commit');
      expect(res.code).toBe(0);
    });

    // --- Task 8 negative path tests: out-of-set rejection, index-shaped rejection ---

    it('rejects Task: 17 when ids 1..16 are seeded (out-of-set id)', async () => {
      await seedTaskStatus(Array.from({ length: 16 }, (_, i) => ({ id: String(i + 1), status: 'pending' })));
      const res = await commitFile('task8_out_of_set.txt', 'content', 'feat: out-of-set id\n\nTask: 17');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('not found in task-status.json');
    });

    it('rejects Task: 0 when ids are non-numeric (array index rejection)', async () => {
      // Fixture with non-numeric ids (A.1, A.2) to ensure Task: 0 is rejected as an array index
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 'A.1', name: 'task A.1', status: 'pending' },
            { id: 'A.2', name: 'task A.2', status: 'pending' },
          ],
        }, null, 2),
        'utf-8',
      );
      const res = await commitFile('task8_array_index.txt', 'content', 'feat: array index id\n\nTask: 0');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('not found in task-status.json');
    });

    it('still rejects task-3 grammar-drift format', async () => {
      const res = await commitFile('task8_grammar_drift.txt', 'content', 'feat: grammar drift\n\nTask: task-3');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('task-N format');
    });

    it('accepts any Task: trailer when task-status.json is missing (tolerance unchanged)', async () => {
      // Remove the status file to test fallback tolerance
      await rm(join(dir, '.pipeline', 'task-status.json'), { force: true });
      const res = await commitFile('task8_missing_status.txt', 'content', 'feat: missing status file\n\nTask: 999');
      expect(res.code).toBe(0);
    });

    it('exempts merge commits from validation (no Task: required for merge)', async () => {
      // Set up a merge scenario: create a branch with a commit, then attempt merge on main
      // This properly sets MERGE_HEAD and allows testing the merge exemption
      await writeCurrentTask('7');
      await commitFile('base.txt', 'base', 'feat: base commit on main\n\nTask: 7');

      // Create a feature branch with a commit
      await git('checkout', '-b', 'merge-feature');
      await commitFile('feature.txt', 'feature', 'feat: feature commit\n\nTask: 7');

      // Go back to main and create an unrelated commit
      await git('checkout', 'main');
      await commitFile('other.txt', 'other', 'feat: other commit on main\n\nTask: 7');

      // Start a merge (this will put us in a merge state with MERGE_HEAD present)
      const mergeResult = await git('merge', 'merge-feature');

      // If merge conflicts, resolve them; if auto-merged, commit it
      if (mergeResult.code !== 0) {
        // There's a conflict - resolve it and commit
        await writeFile(join(dir, 'feature.txt'), 'feature-resolved', 'utf-8');
        await git('add', 'feature.txt');
        // At this point, MERGE_HEAD exists and a commit without Task: should be allowed
        const commitRes = await git('commit', '--no-edit');
        expect(commitRes.code).toBe(0);
      } else {
        // Auto-merge succeeded and was auto-committed (fast-forward or merge commit)
        // Verify the merge commit exists
        const msg = await lastCommitMessage();
        expect(msg).toContain('Merge branch');
      }
    });

    it('exempts CONDUCT_ENGINE_COMMIT=1 commits from validation', async () => {
      // Run git commit with CONDUCT_ENGINE_COMMIT=1 environment variable
      await writeFile(join(dir, 'task8_engine.txt'), 'engine-content', 'utf-8');
      await git('add', 'task8_engine.txt');
      try {
        const result = await execFileAsync('bash', [
          '-c',
          `cd "${dir}" && CONDUCT_ENGINE_COMMIT=1 git commit -m 'chore: engine bookkeeping'`,
        ]);
        expect(result.stdout + result.stderr).not.toContain('rejected');
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        fail(`Expected engine commit to succeed, got error: ${e.stderr}`);
      }
    });
  });

  // --- Story 6 happy path 3: chaining to the repo's own hooks ---

  describe("Story 6: chains to the repository's own hooks", () => {
    async function writeCommonHook(name: string, body: string): Promise<void> {
      const commonHooksDir = (await git('rev-parse', '--git-common-dir')).stdout;
      const absCommonHooks = commonHooksDir.startsWith('/') ? commonHooksDir : join(dir, commonHooksDir);
      const hooksDir = join(absCommonHooks, 'hooks');
      await mkdir(hooksDir, { recursive: true });
      const path = join(hooksDir, name);
      await writeFile(path, body, 'utf-8');
      await chmod(path, 0o755);
    }

    describe('commit-msg hook chaining', () => {
      it('runs the chained commit-msg hook with the same arguments', async () => {
        await writeCommonHook(
          'commit-msg',
          '#!/bin/bash\ncp "$1" "$(git rev-parse --show-toplevel)/chained-saw.txt"\nexit 0\n',
        );
        const res = await commitFile('o.txt', 'o', 'feat: chained\n\nTask: 7');
        expect(res.code).toBe(0);
        const saw = await readFile(join(dir, 'chained-saw.txt'), 'utf-8');
        expect(saw).toContain('Task: 7');
      });

      it('fails the commit when the chained hook exits non-zero', async () => {
        await writeCommonHook('commit-msg', '#!/bin/bash\necho "chained veto" >&2\nexit 1\n');
        const res = await commitFile('p.txt', 'p', 'feat: chained veto\n\nTask: 7');
        expect(res.code).not.toBe(0);
      });

      it('does not error when the common hook is absent or non-executable', async () => {
        const res = await commitFile('q.txt', 'q', 'feat: no common hook\n\nTask: 7');
        expect(res.code).toBe(0);
      });
    });

    describe('prepare-commit-msg hook chaining', () => {
      it('runs the chained prepare-commit-msg hook with the same arguments', async () => {
        // Set current task so the hook will stamp a Task: trailer (and proceed to chaining)
        await writeCurrentTask('7');

        await writeCommonHook(
          'prepare-commit-msg',
          '#!/bin/bash\ntouch "$(git rev-parse --show-toplevel)/prepare-chained-was-called"\nexit 0\n',
        );
        const res = await commitFile('r.txt', 'r', 'feat: prepare chained');
        expect(res.code).toBe(0);

        // Verify the chained hook was called by checking if it created the marker file
        const markerPath = join(dir, 'prepare-chained-was-called');
        try {
          await readFile(markerPath, 'utf-8');
          // File exists, so the hook was called
        } catch {
          throw new Error('Chained prepare-commit-msg hook was not called');
        }
      });

      it('fails the commit when the chained prepare-commit-msg hook exits non-zero', async () => {
        // Set current task so the hook will stamp a Task: trailer (triggering chaining)
        await writeCurrentTask('7');

        await writeCommonHook('prepare-commit-msg', '#!/bin/bash\necho "prepare chained veto" >&2\nexit 1\n');
        const res = await commitFile('s.txt', 's', 'feat: prepare chained veto');
        expect(res.code).not.toBe(0);
      });

      it('does not error when the prepare-commit-msg common hook is absent or non-executable', async () => {
        // Set current task so the hook will try to do chaining
        await writeCurrentTask('7');

        const res = await commitFile('t.txt', 't', 'feat: no prepare common hook');
        expect(res.code).toBe(0);
      });
    });
  });

  // --- Story 5: Loud-path composition — abstain, reject, self-stamp, accept ---

  describe('Story 5: Loud-path composition with #509 build-step-active gate', () => {
    it('rejects an untrailered commit when build-step-active is present and no stamp exists', async () => {
      await createBuildStepActive();
      const res = await commitFile('u.txt', 'u', 'feat: no stamp during build step');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('add a Task: <id> trailer');
    });

    it('accepts an explicit valid Task: 2 trailer on retry after rejection', async () => {
      await createBuildStepActive();
      // First attempt without trailer should be rejected
      const firstAttempt = await commitFile('v.txt', 'v', 'feat: first attempt');
      expect(firstAttempt.code).not.toBe(0);

      // Retry with explicit Task: 2 should be accepted
      const retryRes = await commitFile('w.txt', 'w', 'feat: retry with task trailer\n\nTask: 2');
      expect(retryRes.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 2$/m);
    });

    it('rejects an invalid Task: 99 by real-id validation, even with explicit trailer during build step', async () => {
      await createBuildStepActive();
      const res = await commitFile('x.txt', 'x', 'feat: invalid task id\n\nTask: 99');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('not found in task-status.json');
    });

    it('auto-stamps and accepts an untrailered commit when build-step-active is present but a stamp exists (control)', async () => {
      await createBuildStepActive();
      await writeCurrentTask('2');
      const res = await commitFile('y.txt', 'y', 'feat: stamp present during build step');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 2$/m);
    });

    it('accepts an untrailered commit when build-step-active is absent (control)', async () => {
      // Do NOT create build-step-active — outside a build step
      const res = await commitFile('z.txt', 'z', 'feat: no build step active');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).not.toMatch(/^Task: /m);
    });
  });
});
