import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

// END-TO-END acceptance specs for the #519/#501 abstain-or-loud hardening
// (.docs/decisions/adr-2026-07-11-attribution-abstain-or-loud.md, APPROVED).
//
// Stories 1, 3, 4, and 6 are single-hook-invocation scenarios (unit-covered —
// see .docs/plans/engine-invoked-task-attribution-494-freezes-curren.md
// Tasks 1-8, 11, which write their own request-level tests alongside the
// template edits). Only Story 2 (a three-dispatch cascade sequence) and
// Story 5 (reject -> self-stamp retry -> accept, composed with the #509
// build-step gate) cross 2+ operations and belong at this acceptance layer.
//
// Both specs drive the REAL generated hook scripts against a REAL git repo
// wired by the REAL prepareWorktree — no mocking of git, node, or the hooks.
// They are expected to FAIL against the pre-fix templates (stale stamp
// inherited in Story 2; no build-step marker composition test existed
// before) and PASS once Tasks 1-8 land.

const execFileAsync = promisify(execFile);

describe('acceptance/engine-invoked-task-attribution-494-freezes-curren', () => {
  let dir: string;
  let preDispatchPath: string;
  let postDispatchPath: string;

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

  async function writeWrongShapedStatus(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    // Valid JSON, but `tasks` is an object rather than an array — one of the
    // four uncertainty shapes Story 1 hardens (Task 2).
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: { '1': {} } }), 'utf-8');
  }

  async function currentTaskContent(): Promise<string | null> {
    try {
      return (await readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  function payload(taskLine: string): string {
    return JSON.stringify({
      session_id: 'acceptance-519',
      transcript_path: join(dir, 'transcript.jsonl'),
      cwd: dir,
      prompt_id: 'prompt_01',
      permission_mode: 'default',
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_input: {
        description: 'Launch general-purpose subagent',
        prompt: `${taskLine}\n\nreply with the single word done`,
      },
      tool_use_id: 'toolu_acceptance_519',
    });
  }

  async function runHook(scriptPath: string, taskLine: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const child = execFile('bash', [scriptPath], { cwd: dir, timeout: 5000 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : 0;
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', code });
      });
      child.stdin?.end(payload(taskLine));
    });
  }

  async function dispatch(taskLine: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runHook(preDispatchPath, taskLine);
  }

  async function completeDispatch(taskLine: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return runHook(postDispatchPath, taskLine);
  }

  async function commitFile(name: string, body: string, message: string): Promise<{ stdout: string; stderr: string; code: number }> {
    await writeFile(join(dir, name), body, 'utf-8');
    await git('add', name);
    return git('commit', '-m', message);
  }

  async function writeBuildStepMarker(): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'build-step-active'), `${new Date().toISOString()}\n`, 'utf-8');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'attribution-abstain-acceptance-'));
    await git('init', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await writeFile(join(dir, 'README.md'), '# scratch\n', 'utf-8');
    await git('add', '.');
    await git('commit', '-m', 'chore: initial commit');
    await prepareWorktree(dir);
    preDispatchPath = join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh');
    postDispatchPath = join(dir, '.pipeline', 'session-hooks', 'post-dispatch.sh');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Covers: Story 2 — the #519 cascade shape can never recur
  describe('Story 2: a bookkeeping failure mid-sequence never cascades a stale id', () => {
    it('dispatch 1 heals, dispatch 2 corrupts and abstains, dispatch 3 recovers — each commit carries its own id or none', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'pending' },
      ]);

      // (a) healthy dispatch for Task 1.
      const first = await dispatch('Task: 1');
      expect(first.code).toBe(0);
      expect(await currentTaskContent()).toBe('1');
      const commit1 = await commitFile('a.txt', 'a', 'feat: task one work');
      expect(commit1.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 1$/m);
      await completeDispatch('Task: 1');

      // (b) status file corrupted (wrong-shaped) before task 2's dispatch
      // bookkeeping runs — the hook must abstain loudly rather than leave
      // task 1's stale stamp in place.
      await writeWrongShapedStatus();
      const second = await dispatch('Task: 2');
      expect(second.code).toBe(0);
      expect(second.stderr).toMatch(/pre-dispatch-hook: abstain/);
      expect(await currentTaskContent()).toBeNull();

      const commit2 = await commitFile('b.txt', 'b', 'feat: task two work, attribution unavailable');
      expect(commit2.code).toBe(0);
      const msg2 = await lastCommitMessage();
      expect(msg2).not.toMatch(/^Task: /m);
      expect(msg2).not.toMatch(/^Task: 1$/m);
      await completeDispatch('Task: 2');

      // (c) status file restored — a single failed dispatch does not poison
      // later healthy dispatches.
      await seedTaskStatus([
        { id: '1', status: 'in_progress' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'pending' },
      ]);
      const third = await dispatch('Task: 3');
      expect(third.code).toBe(0);
      expect(await currentTaskContent()).toBe('3');

      const commit3 = await commitFile('c.txt', 'c', 'feat: task three work');
      expect(commit3.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 3$/m);
    });

    it('the same sequence with a healthy status file throughout stamps every commit correctly (proves the fixture fails for the right reason)', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
        { id: '3', status: 'pending' },
      ]);

      await dispatch('Task: 1');
      const commit1 = await commitFile('a.txt', 'a', 'feat: task one work');
      expect(commit1.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 1$/m);
      await completeDispatch('Task: 1');

      await dispatch('Task: 2');
      expect(await currentTaskContent()).toBe('2');
      const commit2 = await commitFile('b.txt', 'b', 'feat: task two work');
      expect(commit2.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 2$/m);
      await completeDispatch('Task: 2');

      await dispatch('Task: 3');
      const commit3 = await commitFile('c.txt', 'c', 'feat: task three work');
      expect(commit3.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 3$/m);
    });
  });

  // Covers: Story 5 — abstention composes with the #509 gate into a loud,
  // fixable rejection
  describe('Story 5: abstain -> reject -> self-stamp -> accept composes end to end', () => {
    it('rejects an unattributed commit under an active build step, then accepts the same change once retried with a valid Task: trailer', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
      ]);
      await writeBuildStepMarker();

      await writeFile(join(dir, 'work.txt'), 'work', 'utf-8');
      await git('add', 'work.txt');
      const rejected = await git('commit', '-m', 'feat: unattributed build-step work');
      expect(rejected.code).not.toBe(0);
      expect(rejected.stderr).toMatch(/Task:/);

      const retried = await git('commit', '-m', 'feat: unattributed build-step work\n\nTask: 2');
      expect(retried.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 2$/m);
    });

    it('rejects the retry again when the self-stamped id is not a real seeded id', async () => {
      await seedTaskStatus([
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
      ]);
      await writeBuildStepMarker();

      await writeFile(join(dir, 'work.txt'), 'work', 'utf-8');
      await git('add', 'work.txt');
      const rejected = await git('commit', '-m', 'feat: unattributed build-step work');
      expect(rejected.code).not.toBe(0);

      const badRetry = await git('commit', '-m', 'feat: unattributed build-step work\n\nTask: 99');
      expect(badRetry.code).not.toBe(0);
      expect(badRetry.stderr).toMatch(/not found in task-status\.json/);
    });

    it('auto-stamps and accepts when a stamp is already present (the loud path only engages when attribution is genuinely unavailable)', async () => {
      await seedTaskStatus([{ id: '2', status: 'pending' }]);
      await writeBuildStepMarker();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline', 'current-task'), '2', 'utf-8');

      const res = await commitFile('stamped.txt', 'stamped', 'feat: work inside a dispatched task');
      expect(res.code).toBe(0);
      expect(await lastCommitMessage()).toMatch(/^Task: 2$/m);
    });

    it('accepts an unattributed commit when no build step is active (enforcement scope unchanged)', async () => {
      await seedTaskStatus([{ id: '1', status: 'pending' }]);
      const res = await commitFile('outside.txt', 'outside', 'feat: work outside any build step');
      expect(res.code).toBe(0);
    });
  });
});
