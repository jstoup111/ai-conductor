// Covers: task:10
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type BacklogItem } from '../../src/engine/daemon.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';
import { buildRetryableHaltDeps } from '../../src/daemon-cli.js';
import { runDaemonRekickStackPreflight } from '../../src/engine/daemon-feature-lifecycle.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const slug = 'retryable-preflight';

describe('retryable HALT dispatch reaches the pending prerequisite', () => {
  it('clears the #3601 marker before preflight and runs test_suite in that dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'retryable-preflight-'));
    const repo = join(root, slug);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const haltBody = "Step 'manual_test' is blocked by unsatisfied prerequisite: test_suite (pending). The daemon will re-dispatch the feature from an earlier reachable prerequisite.\n";
    const operatorDecision = 'Over-scope decision block: operator owns this separate decision.\n';
    try {
      await mkdir(repo);
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.invalid']);
      await git(['config', 'user.name', 'Retryable preflight']);
      await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
      await git(['add', '.gitignore']); await git(['commit', '-qm', 'init']);
      await mkdir(join(repo, '.pipeline'), { recursive: true });
      await writeFile(join(repo, '.pipeline', 'HALT'), haltBody);
      await writeFile(join(repo, '.pipeline', 'HALT.class'), 'mechanical\n');
      await writeFile(join(repo, '.pipeline', 'HALT.cleared'), operatorDecision);
      await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: slug, test_suite: 'pending' }));
      const claims = new InMemoryWorkClaims(); claims.park(slug);
      const executed: string[] = [];
      let executorEntered = false;
      const loopHalts: string[] = [];
      const events = new ConductorEventEmitter();
      events.on('loop_halt', (event) => { if (event.type === 'loop_halt') loopHalts.push(event.reason); });
      const retryable = buildRetryableHaltDeps(root, undefined);

      let haltChecks = 0;
      await runDaemon({
        claims, discoverBacklog: async () => [{ slug, baseSha: 'new-base' } satisfies BacklogItem],
        isHalted: async () => {
          // Selection has already been admitted by the prompt event. The
          // dispatch-time read is the live marker that must be cleared.
          if (++haltChecks === 1) return false;
          try { await readFile(join(repo, '.pipeline', 'HALT')); return true; } catch { return false; }
        }, readHaltClass: async () => 'mechanical', ...retryable,
        runFeature: async () => {
          executorEntered = true;
          expect(await readFile(join(repo, '.pipeline', 'HALT.rekicked'), 'utf8')).toBe(haltBody);
          await expect(readFile(join(repo, '.pipeline', 'HALT'))).rejects.toThrow();
          await expect(readFile(join(repo, '.pipeline', 'HALT.class'))).rejects.toThrow();
          expect(await readFile(join(repo, '.pipeline', 'HALT.cleared'), 'utf8')).toBe(operatorDecision);
          const preflight = await runDaemonRekickStackPreflight({ worktree: repo, slug, git: makeGitRunner(repo) }, () => {});
          expect(preflight.kind).not.toBe('halted');
          const runner: StepRunner = { run: vi.fn(async (step) => { executed.push(step); return { success: true }; }) };
          const conductor = new Conductor({
            projectRoot: repo, stateFilePath: join(repo, '.pipeline', 'conduct-state.json'), stepRunner: runner, events,
            daemon: true, fromStep: 'test_suite', verifyArtifacts: false,
            config: { test_suite: { commands: [{ command: 'true', working_directory: '.' }] } } as any,
            fullSuiteVerifier: {
              inspect: async () => ({ status: 'STALE' as const, reason: 'missing' as const }),
              ensure: async () => { executed.push('test_suite'); return { status: 'REUSED' as const, evidence: {} as never }; },
            },
          });
          // This is the daemon-mode Conductor's native test-suite boundary.
          // Invoke the boundary directly so the fixture ends at the required
          // observation instead of traversing unrelated SHIP steps.
          await (conductor as any).runTestSuiteStep();
          return { slug, status: 'done' as const };
        },
        sleep: async () => {},
      }, { concurrency: 1, once: true });
      expect(loopHalts).not.toContain(expect.stringContaining('live HALT without resume authorization'));
      expect(executorEntered).toBe(true);
      expect(executed[0]).toBe('test_suite');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
