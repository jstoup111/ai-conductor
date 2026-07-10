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

    it('does not overwrite an already-present Task: trailer', async () => {
      await writeCurrentTask('7');
      const res = await commitFile('b.txt', 'b', 'feat: add thing\n\nTask: 9');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 9$/m);
      expect(msg).not.toMatch(/^Task: 7$/m);
    });

    it('falls back to the sole in_progress row when current-task is absent', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'in_progress' },
        { id: '3', status: 'pending' },
      ]);
      const res = await commitFile('c.txt', 'c', 'feat: fallback stamp');
      expect(res.code).toBe(0);
      const msg = await lastCommitMessage();
      expect(msg).toMatch(/^Task: 2$/m);
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
  });

  // --- Story 5: commit-msg rejects bad attribution at commit time ---

  describe('Story 5: commit-msg validation', () => {
    it('lands a commit with a valid Task: <id> trailer and a non-empty diff', async () => {
      const res = await commitFile('h.txt', 'h', 'feat: valid trailer\n\nTask: 7');
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
});
