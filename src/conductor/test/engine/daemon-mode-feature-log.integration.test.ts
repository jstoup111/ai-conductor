import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = vi.hoisted(() => ({ worktreePath: '' }));
const daemonLogSpy = vi.hoisted(() => ({
  formatDaemonActivityLine: vi.fn((message: string, featureOwned = false) =>
    featureOwned ? `[daemon]${message}` : `[daemon] ${message}`,
  ),
}));
const buildAuthSpy = vi.hoisted(() => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));

vi.mock('../../src/engine/daemon-log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-log.js')>();
  return { ...actual, formatDaemonActivityLine: daemonLogSpy.formatDaemonActivityLine };
});

vi.mock('../../src/engine/daemon-deps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/daemon-deps.js')>();
  return { ...actual, resolveDaemonBaseSha: vi.fn(async () => 'a'.repeat(40)) };
});
vi.mock('../../src/engine/work-order.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/work-order.js')>();
  return {
    ...actual,
    buildWorkOrder: vi.fn((input) => ({
      ...input,
      engineVersionId: input.enginePin.engineVersionId,
      schemaVersion: 1,
      manifest: [],
    })),
  };
});

// The daemon loop checks its build credential before dispatch. This test owns
// feature-log wiring, so it supplies a deterministic credential boundary
// rather than depending on a developer or CI host token.
vi.mock('../../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: buildAuthSpy.readDaemonBuildToken,
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';
import { createInMemoryExecutorFork, useTempEngineStore } from '../fixtures/in-memory-executor-fork.js';

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
  daemonLogSpy.formatDaemonActivityLine.mockClear();
  buildAuthSpy.readDaemonBuildToken.mockClear();
});

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('daemon-mode feature log integration', () => {
  it('writes feature lifecycle output with one contextual tag to the live and durable daemon paths', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'daemon-feature-log-integration-'));
    dirs.push(repo);
    fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
    await mkdir(fixture.worktreePath, { recursive: true });

    const consoleLines: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (line: unknown) => consoleLines.push(String(line));
    const store = await useTempEngineStore();
    try {
      await runDaemonMode({
        projectRoot: repo,
        engineRoot: store.engineRoot,
        concurrency: 1,
        maxItems: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
        watch: false,
        workSource: { discover: async () => [{ slug: 'feature-a' }] },
        executorFork: createInMemoryExecutorFork({
          projectRoot: repo,
          createWorktree: async () => ({ path: fixture.worktreePath }),
          // The child runtime is real; this fixture owns only the feature's
          // controlled output needed to exercise supervisor log forwarding.
          run: async ({ order, events, log }) => {
            log?.('setup complete');
            await events.emit({ type: 'step_started', step: 'build' });
            await events.emit({
              type: 'preemption_boundary',
              featureSlug: order.slug,
              boundary: { kind: 'attempt', step: 'build', attempt: 2 },
            });
            await events.emit({ type: 'gate_verdict', step: 'build', satisfied: false, reason: 'blocked' });
            await events.emit({ type: 'kickback', from: 'build', to: 'plan', count: 1 });
            await events.emit({ type: 'navigation_back', from: 'manual_test', to: 'build' });
            await events.emit({ type: 'loop_halt', reason: 'cap' });
            await events.emit({ type: 'loop_converged' });
            await events.emit({ type: 'ci_failed', prUrl: 'https://example.test/pr/1', slug: order.slug, checks: ['test'], attempts: 1, phase: 'detected' });
            await events.emit({ type: 'build_review_base', mergeBase: 'abc1234567890', trackingRefSha: 'abc1234567890', remoteHeadSha: 'abc1234567890', fresh: true });
            await events.emit({ type: 'build_review_stale_mirage_regrade', mergeBase: 'abc1234567890', regradeCount: 1 });
            await events.emit({ type: 'auto_park_contradiction', slug: order.slug, verdict: 'empty/missing plan', evidence: { summaryTasksCompleted: 1, evidenceStamps: 1, resolvedTasks: 0 } });
            log?.('WARNING: provider unavailable');
            log?.('retrying build (2/3)');
            log?.('subprocess diagnostic: exit 1');
            return { slug: order.slug, status: 'done' };
          },
        }),
      });
    } finally {
      await store.teardown();
      console.log = originalConsoleLog;
    }

    const expected = [
      '▶ start feature-a',
      '[executor:info] setup complete',
      '· ▶ build',
      '· ■ preempted[feature-a]: after attempt 2 for step build',
      '· gate build: unsatisfied — blocked',
      '↩ KICKBACK: build re-opened plan (×1)',
      '↰ BACK: manual_test → build (operator)',
      '· ✋ loop halted: cap',
      '· ✓ gate loop converged',
      '· ✋ ci_failed[feature-a]: phase=detected attempts=1 checks=[test]',
      '· build_review base',
      '· build_review stale-mirage regrade',
      '· ✋ auto_park_contradiction[feature-a]',
      '[executor:info] WARNING: provider unavailable',
      '[executor:info] retrying build (2/3)',
      '[executor:info] subprocess diagnostic: exit 1',
      '■ done feature-a: done',
    ];
    const live = consoleLines.join('\n');
    const persisted = await readFile(daemonLogPath(repo), 'utf8');
    for (const message of expected) {
      expect(live).toContain(`[daemon][feature-a] ${message}`);
      expect(persisted).toContain(`[daemon][feature-a] ${message}`);
    }
    expect(daemonLogSpy.formatDaemonActivityLine).toHaveBeenCalledWith(
      '[feature-a] ▶ start feature-a',
      true,
    );
    // The mock keeps credential reads deterministic; their scheduler count is
    // not part of the feature-log contract under test.
    expect(buildAuthSpy.readDaemonBuildToken).toHaveBeenCalled();
    expect(persisted).not.toMatch(/\[daemon\]\[feature-a\]\[feature-a\]/);

    // step_started is one of the 19 TerminalSubscriber-rendered event types.
    // It must render exactly once (tagged) — not a second time untagged via
    // the daemon-wide bus the feature-scoped bus forwards onto.
    const buildLineOccurrences = live
      .split('\n')
      .filter((line) => line.includes('▶ build')).length;
    expect(buildLineOccurrences).toBe(1);
    expect(live).not.toContain('[daemon] · ▶ build');
    expect(live).not.toContain('operator park[feature-a]');
  });
});
