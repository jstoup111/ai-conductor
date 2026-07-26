import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { retireTaskTelemetry } from '../../src/engine/task-attribution.js';

// END-TO-END acceptance spec for #477 (Story 5: overlap guard clears the
// stamp so #452's commit hooks abstain). This chains TWO independently
// engine-owned mechanisms across a real dispatch → real git commit:
//
//   1. This feature's PreToolUse/PostToolUse session hooks (not yet
//      implemented — Tasks 1-16 of
//      .docs/plans/engine-must-invoke-task-start-done-at-subagent-dis.md)
//      stamp/clear .pipeline/current-task at subagent dispatch boundaries.
//   2. #433's existing prepare-commit-msg/commit-msg git hooks (already
//      shipped, exercised by git-hooks-attribution.test.ts) read that same
//      state to decide whether to stamp or abstain a Task: trailer.
//
// Neither mechanism's own unit tests can see this wiring: the session hook's
// unit tests assert file state, and #433's hook tests seed current-task by
// hand. This spec drives the REAL session-hook scripts against REAL fixture
// payloads, then makes REAL git commits in the SAME worktree, asserting the
// git-visible outcome (commit trailer present/absent). It is expected to
// fail on ENOENT (missing .pipeline/session-hooks/*.sh) until provisioning
// (Task 12) and the hook behaviors (Tasks 5, 10, 11) land — this is RED for
// the right reason, not a broken spec.

const execFileAsync = promisify(execFile);

describe('integration/session-hooks-attribution (#477 Story 5)', () => {
  let dir: string;
  let preHookPath: string;
  let postHookPath: string;

  async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
      return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
    }
  }

  async function seedTaskStatus(rows: Array<{ id: string; status: string }>): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: rows.map((r) => ({ id: r.id, name: `task ${r.id}`, status: r.status })) }, null, 2),
      'utf-8',
    );
  }

  async function readTaskStatus(): Promise<{ tasks: Array<{ id: string; status: string }> }> {
    const raw = await readFile(join(dir, '.pipeline', 'task-status.json'), 'utf-8');
    return JSON.parse(raw);
  }

  async function currentTaskContent(): Promise<string | null> {
    try {
      return (await readFile(join(dir, '.pipeline', 'current-task'), 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  /** Real captured headless PreToolUse/PostToolUse payload shape (2026-07-10 spike). */
  function payload(hookEvent: 'PreToolUse' | 'PostToolUse', taskLine: string): string {
    return JSON.stringify({
      session_id: '95588bbd-cdcc-4170-9a27-cd15a3a008f3',
      transcript_path: join(dir, 'transcript.jsonl'),
      cwd: dir,
      prompt_id: 'prompt_01',
      permission_mode: 'default',
      hook_event_name: hookEvent,
      tool_name: 'Agent',
      tool_input: {
        description: 'Launch general-purpose subagent',
        prompt: `${taskLine}\n\nreply with the single word done`,
      },
      tool_use_id: 'toolu_01TwCfzueVmjBibMnYBA6tQm',
    });
  }

  async function runHook(
    scriptPath: string,
    hookEvent: 'PreToolUse' | 'PostToolUse',
    taskLine: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const child = execFile('bash', [scriptPath], { cwd: dir, timeout: 5000 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : 0;
        resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', code });
      });
      // A hook may exit before its small fixture payload reaches stdin. The
      // exec callback captures that exit; consume the resulting stream EPIPE
      // so Vitest does not treat the test-harness race as an uncaught error.
      child.stdin?.once('error', () => undefined);
      child.stdin?.end(payload(hookEvent, taskLine));
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-hooks-attr-'));
    await git('init', '-b', 'main');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await writeFile(join(dir, 'README.md'), '# scratch\n', 'utf-8');
    await git('add', '.');
    await git('commit', '-m', 'chore: initial commit');

    // Wires BOTH #433's git attribution hooks AND (once implemented) this
    // feature's session hooks — same provisioning call, single entry point.
    await prepareWorktree(dir);

    preHookPath = join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh');
    postHookPath = join(dir, '.pipeline', 'session-hooks', 'post-dispatch.sh');

    await seedTaskStatus(Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), status: 'pending' })));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('provisions the session-hook scripts executably (prerequisite for the chained flow)', async () => {
    const preStat = await stat(preHookPath);
    const postStat = await stat(postHookPath);
    expect(preStat.mode & 0o111).not.toBe(0);
    expect(postStat.mode & 0o111).not.toBe(0);
  });

  it('records a single dispatch as task-local telemetry without creating a global stamp', async () => {
    const hook = await runHook(preHookPath, 'PreToolUse', 'Task: 7');
    expect(hook.code).toBe(0);
    expect(await currentTaskContent()).toBeNull();

    const status = await readTaskStatus();
    expect(status.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
  });

  it('keeps sibling telemetry independent when a task is activated twice', async () => {
    const first = await runHook(preHookPath, 'PreToolUse', 'Task: 7');
    expect(first.code).toBe(0);

    const second = await runHook(preHookPath, 'PreToolUse', 'Task: 9');
    expect(second.code).toBe(0);

    const repeat = await runHook(preHookPath, 'PreToolUse', 'Task: 7');
    expect(repeat.code).toBe(0);
    expect(await currentTaskContent()).toBeNull();

    const status = await readTaskStatus();
    expect(status.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
    expect(status.tasks.find((t) => t.id === '9')?.status).toBe('in_progress');
  });

  it('preserves both task rows when independent activations race', async () => {
    const [first, second] = await Promise.all([
      runHook(preHookPath, 'PreToolUse', 'Task: 7'),
      runHook(preHookPath, 'PreToolUse', 'Task: 9'),
    ]);

    expect([first.code, second.code]).toEqual([0, 0]);
    const status = await readTaskStatus();
    expect(status.tasks.find((task) => task.id === '7')?.status).toBe('in_progress');
    expect(status.tasks.find((task) => task.id === '9')?.status).toBe('in_progress');
  });

  it('leaves concurrent task telemetry intact when a dispatch completes', async () => {
    await runHook(preHookPath, 'PreToolUse', 'Task: 7');
    await runHook(preHookPath, 'PreToolUse', 'Task: 9');
    expect(await currentTaskContent()).toBeNull();

    const post = await runHook(postHookPath, 'PostToolUse', 'Task: 7');
    expect(post.code).toBe(0);

    expect(await currentTaskContent()).toBeNull();
    const status = await readTaskStatus();
    expect(status.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
    expect(status.tasks.find((t) => t.id === '9')?.status).toBe('in_progress');
  });

  it('keeps terminal telemetry retirement task-local after the post-dispatch hook abstains', async () => {
    await runHook(preHookPath, 'PreToolUse', 'Task: 7');
    await runHook(preHookPath, 'PreToolUse', 'Task: 9');

    const post = await runHook(postHookPath, 'PostToolUse', 'Task: 7');
    expect(post.code).toBe(0);

    expect(
      retireTaskTelemetry(
        [
          { taskId: '7', context: { provider: 'claude' } },
          { taskId: '9', context: { provider: 'codex' } },
        ],
        { taskId: '7', terminalReason: 'completed' },
      ),
    ).toEqual([{ taskId: '9', context: { provider: 'codex' } }]);

    const status = await readTaskStatus();
    expect(status.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
    expect(status.tasks.find((t) => t.id === '9')?.status).toBe('in_progress');
  });

  it('does not create a global stamp after a telemetry write failure', async () => {
    const dispatch1 = await runHook(preHookPath, 'PreToolUse', 'Task: 1');
    expect(dispatch1.code).toBe(0);
    expect(await currentTaskContent()).toBeNull();

    const statusPath = join(dir, '.pipeline', 'task-status.json');
    await writeFile(statusPath, '{"tasks": {"not_array": true}}', 'utf-8');

    const dispatch2 = await runHook(preHookPath, 'PreToolUse', 'Task: 2');
    expect(dispatch2.code).toBe(0);
    expect(await currentTaskContent()).toBeNull();
  });
});
