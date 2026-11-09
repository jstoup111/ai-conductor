// Covers: task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { runDaemonMode } from '../../src/daemon-cli.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const roots: string[] = [];
const originalWarn = console.warn;

afterEach(async () => {
  console.warn = originalWarn;
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runDaemonMode console tee line shape', () => {
  it('persists each warning line with a continuation body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-console-tee-'));
    roots.push(root);
    const daemon = await import('../../src/engine/daemon.js');
    vi.spyOn(daemon, 'runDaemon').mockImplementation(async () => {
      console.warn('tee first\ntee second');
      return { processed: [], stoppedReason: 'backlog_drained' };
    });

    await runDaemonMode({
      projectRoot: root, concurrency: 1, baseBranch: 'main', ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner(),
      workSource: { discover: async () => [] }, watch: false,
    });

    const lines = (await readFile(join(root, '.daemon', 'daemon.log'), 'utf8')).split('\n')
      .filter((line) => line.includes('[warn] tee') || line.includes('[warn] │ tee'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[daemon\] \[warn\] tee first$/);
    expect(lines[1]?.split('[warn] ')[1]).toBe('│ tee second');
  });
});
