import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execa } from 'execa';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { rmSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

// ─────────────────────────────────────────────────────────────────────────────
// Story "Real-session probe proves the mutation gate end-to-end" (TS-5, Task
// 17). Per /writing-system-tests §3b (replacement tasks drive the REAL entry
// point) and the #477 probe recipe (verified 2026-07-10, see
// reference_headless_session_hooks_verified memory): a payload->exit-code
// unit test on the mutation-gate script proves the script's own logic, but it
// cannot prove Claude Code actually invokes that script for a real Write
// attempt in a headless session, nor that the block message is what the
// model actually sees. This drives the REAL `claude -p` binary against a
// worktree provisioned by the REAL `prepareWorktree` wiring (no hand-rolled
// settings.local.json) — the same command path the daemon's build-step spawn
// uses in production.
//
// This spec is written pre-implementation (RED phase): today `prepareWorktree`
// wires only PRE/POST dispatch hooks, not the Edit|Write|NotebookEdit/Bash
// mutation gate from Task 9/11/14. Both assertions below are expected to FAIL
// until Tasks 9-14 land: the marker + absent stamp will not block the Write,
// so the file WILL be created (block assertion fails), and there is currently
// no stamp-present pass-through path to differentiate (pass-through assertion
// is vacuously true today, which is why the block assertion is the RED
// anchor).
// ─────────────────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function claudeAuthAvailable(): boolean {
  try {
    const result = execFileSync('claude', ['-p', 'ping', '--print'], {
      stdio: 'pipe',
      timeout: 30_000,
    }).toString();
    return !/not logged in|please run \/login|invalid api key/i.test(result);
  } catch {
    return false;
  }
}

const binaryAvailable = claudeBinaryAvailable();
const probeKillSwitch = process.env.MUTATION_GATE_PROBE === '0';
// Auth check is itself a real-binary call; only pay for it if the binary
// exists and the operator hasn't already opted out.
const authAvailable = binaryAvailable && !probeKillSwitch ? claudeAuthAvailable() : false;
const shouldRun = binaryAvailable && authAvailable && !probeKillSwitch;

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args]);
}

describe.skipIf(!shouldRun)(
  'acceptance (real-binary): mutation gate blocks unstamped Write, passes stamped Write (#505 TS-5)',
  () => {
    let repoRoot: string;
    let markedFile: string;

    beforeAll(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), 'mutation-gate-probe-'));
      await git(repoRoot, 'init', '-b', 'main');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');

      // Production wiring — not a hand-rolled settings.local.json.
      await prepareWorktree(repoRoot);

      // Simulate an active build-step: the marker the engine would write
      // around the build session (Task 3). No `.pipeline/current-task`
      // stamp is written, so this session is "unstamped."
      await mkdir(join(repoRoot, '.pipeline'), { recursive: true });
      await writeFile(
        join(repoRoot, '.pipeline', 'build-step-active'),
        new Date().toISOString(),
        'utf-8',
      );

      markedFile = join(repoRoot, 'probe-output.txt');
    });

    afterAll(async () => {
      await rm(repoRoot, { recursive: true, force: true });
    });

    afterEach(() => {
      // The Claude CLI may write memory-tracking state to .pipeline/ in the
      // real process cwd (not repoRoot) during the probe; strip it so the
      // global-setup leak guard doesn't flag it (same guard as
      // claude-provider.smoke.test.ts).
      //
      // SCOPE GUARD (D2): Only delete .pipeline if it's inside the mkdtemp root
      // created by this test. Do not delete a shared/repo .pipeline that exists
      // outside the test's isolation boundary.
      const targetPath = join(process.cwd(), '.pipeline');

      // Check 1: Is the target path inside the mkdtemp root?
      // Require the trailing slash to prevent /tmp/test from matching /tmp/test-2
      const isSafeInMkdtemp = targetPath.startsWith(repoRoot + '/');

      // Check 2: Reject if the resolved path equals repo root or parent directories
      // (shared-root guard). This prevents deletion when the path resolves to /
      // or any parent of the repo.
      const isRepoRootOrParent = targetPath === repoRoot || repoRoot.startsWith(targetPath);

      if (isSafeInMkdtemp && !isRepoRootOrParent) {
        rmSync(targetPath, { recursive: true, force: true });
      }
      // Otherwise, no-op: refuse to delete an unsafe path
    });

    it(
      'an unstamped session attempting to Write is blocked, the block message is observed, and the file is never created',
      async () => {
        // stream-json flushes events incrementally, so the deny is observable
        // even though the blocked model retries until the timeout kills the
        // session (-p buffers plain output until completion, which never comes).
        const result = await execa(
          'claude',
          [
            '-p',
            `Immediately call the Write tool to create the file ${markedFile} with the content "probe". Do not ask for confirmation.`,
            '--output-format',
            'stream-json',
            '--verbose',
            '--allowedTools',
            'Write',
          ],
          { cwd: repoRoot, reject: false, timeout: 60_000, stdin: 'ignore' },
        );

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

        if (existsSync(markedFile)) {
          console.error(
            `unexpected: markedFile exists. First 2000 chars of output:
${output.slice(0, 2000)}`,
          );
        }

        expect(existsSync(markedFile)).toBe(false);
        expect(output).toMatch(/Task:\s*<id>|dispatch|Task: none/i);
      },
      { timeout: 70_000, retry: 1 },
    );

    it(
      'a stamped session (dispatched implementer) attempting to Write passes through and the file is created',
      async () => {
        const stampedFile = join(repoRoot, 'probe-stamped-output.txt');
        await writeFile(join(repoRoot, '.pipeline', 'current-task'), 'task-1', 'utf-8');

        const result = await execa(
          'claude',
          [
            '-p',
            `Immediately call the Write tool to create the file ${stampedFile} with the content "probe". Do not ask for confirmation.`,
            '--print',
            '--allowedTools',
            'Write',
          ],
          { cwd: repoRoot, reject: false, timeout: 60_000 },
        );

        expect(existsSync(stampedFile)).toBe(true);

        await rm(join(repoRoot, '.pipeline', 'current-task'), { force: true });
      },
      { timeout: 70_000, retry: 1 },
    );
  },
);

// Always executes (never itself skipped) so the reason for skipping the
// gated suite above — when it can't run — is visible in every run's output
// rather than silently reported as passing/green.
describe('acceptance (real-binary): mutation gate probe availability (#505 TS-5)', () => {
  it('reports whether the real-binary probe ran, and why not if it did not', () => {
    if (shouldRun) {
      console.log('mutation-gate-probe: ran against the real claude binary');
    } else {
      const reason = !binaryAvailable
        ? 'claude binary not found on PATH'
        : probeKillSwitch
          ? 'MUTATION_GATE_PROBE=0 kill-switch set'
          : 'claude binary present but not authenticated';
      console.log(`mutation-gate-probe: skipped — ${reason}`);
    }
    expect(shouldRun || !binaryAvailable || probeKillSwitch || !authAvailable).toBe(true);
  });
});
