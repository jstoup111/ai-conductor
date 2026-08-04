import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { Conductor } from '../../src/engine/conductor.js';
import { runDaemon } from '../../src/engine/daemon.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { dumpPipelineDiagnostics } from './daemon-e2e-fixture.test.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { assertTokenCap, TokenMeter } from '../fixtures/token-meter.js';

// TokenMeter accumulates every real Claude InvokeResult.tokenUsage value.

const fixturePlanPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/plan.md', import.meta.url),
);
const fixtureStoriesPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/stories.md', import.meta.url),
);
const fixtureTouchedPath = fileURLToPath(
  new URL('../fixtures/daemon-e2e/touched.txt', import.meta.url),
);

/**
 * The documented default keeps this manually-dispatched smoke bounded while
 * allowing operators to lower it with DAEMON_E2E_LIVE_TOKEN_CAP.
 */
const tokenCap = Number(process.env.DAEMON_E2E_LIVE_TOKEN_CAP ?? '100000');

function claudeBinaryAvailable(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function hasSuccessfulTerminalState(worktreeDir: string, slug: string): Promise<boolean> {
  return existsSync(join(worktreeDir, '.pipeline/DONE')) &&
    !existsSync(join(worktreeDir, '.pipeline/HALT')) &&
    !existsSync(join(worktreeDir, `.daemon/parked/${slug}`));
}

const hostToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const killSwitch = process.env.DAEMON_E2E_LIVE_SMOKE === '0';
const shouldRun = claudeBinaryAvailable() && !killSwitch && !!hostToken;

describe('daemon E2E live terminal guard', () => {
  it('does not dispatch a pre-halted fixture', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-halted-'));
    const slug = 'daemon-e2e-live';
    let dispatches = 0;

    try {
      await mkdir(join(worktreeDir, '.pipeline'), { recursive: true });
      await writeFile(join(worktreeDir, '.pipeline/HALT'), 'prewritten halt\n');

      expect(await hasSuccessfulTerminalState(worktreeDir, slug)).toBe(false);
      await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            dispatches += 1;
            return { slug: item.slug, status: 'done' };
          },
          isHalted: async (candidate) =>
            candidate === slug && existsSync(join(worktreeDir, '.pipeline/HALT')),
        },
        { concurrency: 1, once: true },
      );

      expect(dispatches).toBe(0);
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!shouldRun)('daemon E2E with real Claude provider', () => {
  it('finishes a seeded daemon fixture with a trailered task commit', async () => {
    const worktreeDir = await mkdtemp(join(tmpdir(), 'daemon-e2e-live-'));
    const slug = 'daemon-e2e-live';
    const pipelineDir = join(worktreeDir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    const planPath = join(worktreeDir, `.docs/plans/${slug}.md`);
    const meter = new TokenMeter(new ClaudeProvider());

    try {
      // test/setup.ts enables this guard for the ordinary suite. This opt-in
      // smoke is the explicit exception immediately before real dispatch.
      delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
      expect(process.env.AI_CONDUCTOR_NO_REAL_EXEC).toBeUndefined();

      await initTestRepo(worktreeDir);
      await mkdir(join(worktreeDir, '.docs/plans'), { recursive: true });
      await mkdir(join(worktreeDir, '.docs/stories'), { recursive: true });
      await mkdir(join(worktreeDir, 'test/fixtures/daemon-e2e'), { recursive: true });
      await copyFile(fixturePlanPath, planPath);
      await copyFile(fixtureStoriesPath, join(worktreeDir, `.docs/stories/${slug}.md`));
      await copyFile(fixtureTouchedPath, join(worktreeDir, 'test/fixtures/daemon-e2e/touched.txt'));
      await execa('git', ['add', '-A'], { cwd: worktreeDir });
      await execa('git', ['commit', '-m', 'test: seed live daemon E2E fixture', '-m', 'Task: T0'], {
        cwd: worktreeDir,
      });
      const { stdout: baselineSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      await execa('git', ['checkout', '-b', `feature/${slug}`], { cwd: worktreeDir });

      await mkdir(pipelineDir, { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
          complexity_tier: 'S', track: 'technical', stories: 'done', conflict_check: 'done',
          plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
          architecture_review: 'done', acceptance_specs: 'done',
        }),
      );

      const runner = new DefaultStepRunner(meter, 'daemon-e2e-live-session', worktreeDir, {
        featureDesc: slug,
        pipelineDir,
        planPath,
        providerKey: 'claude',
        mode: 'auto',
      });
      await runDaemon(
        {
          discoverBacklog: async () => [{ slug, tier: 'S', track: 'technical' }],
          runFeature: async (item) => {
            const conductor = new Conductor({
              stateFilePath: statePath,
              stepRunner: runner,
              events: new ConductorEventEmitter(),
              projectRoot: worktreeDir,
              fromStep: 'build',
              mode: 'auto',
              daemon: true,
              verifyArtifacts: false,
              fullSuiteVerifier: {
                ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
                inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
              },
              escalateBuildFailure: async () => ({}),
            });
            await conductor.run();
            return { slug: item.slug, status: 'done' };
          },
        },
        { concurrency: 1, once: true },
      );

      const { stdout: commitSha } = await execa('git', ['rev-parse', 'HEAD'], {
        cwd: worktreeDir,
      });
      const { stdout: commitBody } = await execa('git', ['log', '-1', '--format=%B'], {
        cwd: worktreeDir,
      });
      const { stdout: changedFiles } = await execa(
        'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: worktreeDir },
      );

      expect({
        terminal: await hasSuccessfulTerminalState(worktreeDir, slug),
        madeCommit: commitSha.trim() !== baselineSha.trim(),
        touchedFixture: changedFiles.split('\n').includes('test/fixtures/daemon-e2e/touched.txt'),
        taskTrailer: /(?:^|\n)Task:\s*1\s*$/m.test(commitBody),
      }).toEqual({ terminal: true, madeCommit: true, touchedFixture: true, taskTrailer: true });
    } catch (error) {
      await dumpPipelineDiagnostics(worktreeDir);
      throw error;
    } finally {
      console.info(`daemon E2E live smoke total tokens: ${meter.totalTokens}; cap: ${tokenCap}`);
      assertTokenCap(meter.totalTokens, tokenCap);
      await rm(worktreeDir, { recursive: true, force: true });
    }
  }, 20 * 60_000);
});
