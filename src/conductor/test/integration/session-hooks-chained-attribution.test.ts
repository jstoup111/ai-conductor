import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { PRE_DISPATCH_HOOK, POST_DISPATCH_HOOK } from '../../src/engine/session-hook-assets.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'session-hook-payloads');

// Task 16 (Story 5): the #477 session hooks CHAIN onto #452's git-hook
// abstain-on-ambiguity machinery, end to end in a REAL scratch repo. The PRE
// dispatch hook stamps `.pipeline/current-task`; the #452 prepare-commit-msg
// hook (wired by the REAL `prepareWorktree`) turns that stamp into a `Task:`
// trailer on the next commit. An overlapping second PRE dispatch clears the
// stamp (two in_progress rows = ambiguity), so the commit hook must abstain —
// and the POST hook for the first id must still exit 0 after the overlap.
describe('Story 5: session hooks chain onto #452 abstain-on-ambiguity', () => {
  let dir: string;

  async function git(...args: string[]): Promise<{ stdout: string; code: number }> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
        { cwd: dir },
      );
      return { stdout, code: 0 };
    } catch (err) {
      const e = err as { stdout?: string; code?: number };
      return { stdout: e.stdout ?? '', code: e.code ?? 1 };
    }
  }

  async function commitFile(
    name: string,
    body: string,
    message: string,
  ): Promise<{ stdout: string; code: number }> {
    await writeFile(join(dir, name), body, 'utf-8');
    await git('add', name);
    return git('commit', '-m', message);
  }

  async function lastCommitMessage(): Promise<string> {
    const { stdout } = await git('log', '-1', '--format=%B');
    return stdout;
  }

  async function seedTaskStatus(rows: Array<{ id: string; status: string }>): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify(
        { tasks: rows.map((r) => ({ id: r.id, name: `task ${r.id}`, status: r.status })) },
        null,
        2,
      ),
      'utf-8',
    );
  }

  /** Load a real captured payload fixture and override the dispatch prompt. */
  function loadPayload(prompt: string, hookEvent: 'PreToolUse' | 'PostToolUse'): string {
    const raw = readFileSync(join(FIXTURES_DIR, 'pre-dispatch-task-id.json'), 'utf-8');
    const payload = JSON.parse(raw) as {
      hook_event_name: string;
      tool_input: { description: string; prompt: string };
    };
    payload.hook_event_name = hookEvent;
    payload.tool_input = { ...payload.tool_input, prompt };
    return JSON.stringify(payload);
  }

  /** Run a session hook script (PRE or POST) against the scratch repo. */
  function runSessionHook(script: string, prompt: string, hookEvent: 'PreToolUse' | 'PostToolUse'): number {
    const hookPath = join(dir, hookEvent === 'PreToolUse' ? 'pre-hook.sh' : 'post-hook.sh');
    execFileSync('bash', ['-c', `cat > ${JSON.stringify(hookPath)}`], { input: script });
    try {
      execFileSync('bash', [hookPath], {
        input: loadPayload(prompt, hookEvent),
        cwd: dir,
        stdio: 'pipe',
      });
      return 0;
    } catch (err) {
      return (err as { status?: number }).status ?? 1;
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-hooks-chain-'));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await git('config', 'user.email', 't@test');
    await git('config', 'user.name', 't');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'README.md'), '# scratch\n', 'utf-8');
    await git('add', '.');
    await git('commit', '-m', 'chore: initial commit');
    // The REAL per-worktree wiring: installs #452's prepare-commit-msg /
    // commit-msg hooks via core.hooksPath — no mocks.
    await prepareWorktree(dir);
    await seedTaskStatus([
      { id: '7', status: 'pending' },
      { id: '9', status: 'pending' },
    ]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('(a) PRE "Task: 7" then commit → the #452 hook stamps the Task: 7 trailer', async () => {
    const exit = runSessionHook(PRE_DISPATCH_HOOK, 'Task: 7\nfirst stream body', 'PreToolUse');
    expect(exit).toBe(0);
    expect(existsSync(join(dir, '.pipeline', 'current-task'))).toBe(true);

    const res = await commitFile('a.txt', 'a', 'feat: untrailered agent commit');
    expect(res.code).toBe(0);
    const msg = await lastCommitMessage();
    expect(msg).toMatch(/^Task: 7$/m);
  });

  it('(b) overlapping PRE dispatches clear the stamp → the commit hook abstains (no trailer)', async () => {
    expect(runSessionHook(PRE_DISPATCH_HOOK, 'Task: 7\nfirst stream body', 'PreToolUse')).toBe(0);
    expect(runSessionHook(PRE_DISPATCH_HOOK, 'Task: 9\nsecond stream body', 'PreToolUse')).toBe(0);

    // Overlap guard: stamp cleared, both rows in_progress (ambiguity).
    expect(existsSync(join(dir, '.pipeline', 'current-task'))).toBe(false);
    const status = JSON.parse(readFileSync(join(dir, '.pipeline', 'task-status.json'), 'utf-8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    const inProgress = status.tasks.filter((t) => t.status === 'in_progress').map((t) => t.id);
    expect(inProgress.sort()).toEqual(['7', '9']);

    const res = await commitFile('b.txt', 'b', 'feat: ambiguous-provenance commit');
    expect(res.code).toBe(0);
    const msg = await lastCommitMessage();
    expect(msg).not.toMatch(/^Task:/m);
  });

  it('(c) POST for the first id after an overlap exits 0 (no error, no restamp)', async () => {
    expect(runSessionHook(PRE_DISPATCH_HOOK, 'Task: 7\nfirst stream body', 'PreToolUse')).toBe(0);
    expect(runSessionHook(PRE_DISPATCH_HOOK, 'Task: 9\nsecond stream body', 'PreToolUse')).toBe(0);

    const exit = runSessionHook(POST_DISPATCH_HOOK, 'Task: 7\nfirst stream body', 'PostToolUse');
    expect(exit).toBe(0);
    // The overlap already cleared the stamp; POST must not resurrect it.
    expect(existsSync(join(dir, '.pipeline', 'current-task'))).toBe(false);
  });
});
