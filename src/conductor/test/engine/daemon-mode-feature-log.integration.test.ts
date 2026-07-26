import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = vi.hoisted(() => ({ worktreePath: '' }));

// Keep the daemon entry point real while replacing only the external feature
// executor. Its controlled output exercises beginFeatureRun's actual scoped
// logger, event renderer, console tee, and durable daemon-log sink.
vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: {
    beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<{
      log?: (message: string) => void;
      events: { emit: (event: { type: 'step_started'; step: 'build' }) => Promise<void> };
      stop: () => void;
    }>;
  }) => async (item: { slug: string }) => {
    const scope = await deps.beginFeatureRun(
      { path: fixture.worktreePath, branch: `feat/${item.slug}` },
      item,
    );
    scope.log?.('setup complete');
    await scope.events.emit({ type: 'step_started', step: 'build' });
    scope.log?.('WARNING: provider unavailable');
    scope.log?.('retrying build (2/3)');
    scope.log?.('subprocess diagnostic: exit 1');
    scope.stop();
    return { slug: item.slug, status: 'done' };
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
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
    try {
      await runDaemonMode({
        projectRoot: repo,
        concurrency: 1,
        maxItems: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        watch: false,
        workSource: { discover: async () => [{ slug: 'feature-a' }] },
      });
    } finally {
      console.log = originalConsoleLog;
    }

    const expected = [
      'setup complete',
      '· ▶ build',
      'WARNING: provider unavailable',
      'retrying build (2/3)',
      'subprocess diagnostic: exit 1',
    ];
    const live = consoleLines.join('\n');
    const persisted = await readFile(daemonLogPath(repo), 'utf8');
    for (const message of expected) {
      expect(live).toContain(`[daemon][feature-a] ${message}`);
      expect(persisted).toContain(`[daemon][feature-a] ${message}`);
    }
    expect(persisted).not.toMatch(/\[daemon\]\[feature-a\]\[feature-a\]/);
  });
});
