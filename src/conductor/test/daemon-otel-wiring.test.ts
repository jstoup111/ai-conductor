// Covers: task:6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type WireOtelVisualizer = typeof import('../src/engine/otel/wire.js').wireOtelVisualizer;

const fixture = vi.hoisted(() => ({ worktreePath: '', scopes: [] as Array<Record<string, unknown>> }));
const wireOtelVisualizer = vi.hoisted(() => vi.fn<WireOtelVisualizer>(() => null));

vi.mock('../src/engine/otel/wire.js', () => ({ wireOtelVisualizer }));
vi.mock('../src/engine/self-host/daemon-build-token.js', () => ({
  readDaemonBuildToken: vi.fn(async () => ({ state: 'ok' as const, token: 'test-daemon-token' })),
}));
vi.mock('../src/engine/ci-fix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/ci-fix.js')>();
  return {
    ...actual,
    defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: 'claude 1.0.0', stderr: '' })),
  };
});
vi.mock('../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: { beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<Record<string, unknown>> }) =>
    async (item: { slug: string }) => {
      const scope = await deps.beginFeatureRun({ path: fixture.worktreePath, branch: `feat/${item.slug}` }, item);
      fixture.scopes.push(scope);
      (scope.stop as () => void)();
      return { slug: item.slug, status: 'done' };
    },
}));

import { runDaemonMode } from '../src/daemon-cli.js';

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
  fixture.scopes = [];
  wireOtelVisualizer.mockClear();
});

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dispatchWithSessionId(sessionId?: string | 'unreadable'): Promise<{ repo: string; pipelineDir: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'daemon-otel-wiring-'));
  dirs.push(repo);
  fixture.worktreePath = join(repo, '.worktrees', 'feature-a');
  const pipelineDir = join(fixture.worktreePath, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(
    join(repo, '.ai-conductor', 'config.yml'),
    'otel:\n  exporter: file\n',
  );
  if (sessionId === 'unreadable') {
    await mkdir(join(pipelineDir, 'conduct-session-id'));
  } else if (sessionId) {
    await writeFile(join(pipelineDir, 'conduct-session-id'), sessionId);
  }

  await runDaemonMode({
    projectRoot: repo,
    concurrency: 1,
    maxItems: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    watch: false,
    workSource: { discover: async () => [{ slug: 'feature-a' }] },
  });
  return { repo, pipelineDir };
}

describe('daemon OTel visualizer wiring', () => {
  it('attaches the visualizer to the feature bus using the persisted read-only session ID', async () => {
    const { repo, pipelineDir } = await dispatchWithSessionId('persisted-dispatch-id');

    expect(wireOtelVisualizer).toHaveBeenCalledWith(
      expect.objectContaining({ otel: expect.objectContaining({ exporter: 'file' }) }),
      expect.objectContaining({
        pipelineDir,
        feature: 'feature-a',
        project: repo,
        runId: 'persisted-dispatch-id',
      }),
      fixture.scopes[0]?.events,
    );
  });

  it('uses the scope session ID without creating conduct-session-id when it is absent', async () => {
    const { pipelineDir } = await dispatchWithSessionId();
    const context = wireOtelVisualizer.mock.calls[0]?.[1];

    expect({
      runId: context?.runId,
      scopeSessionId: fixture.scopes[0]?.sessionId,
      wroteSessionId: existsSync(join(pipelineDir, 'conduct-session-id')),
    }).toEqual({
      runId: fixture.scopes[0]?.sessionId,
      scopeSessionId: fixture.scopes[0]?.sessionId,
      wroteSessionId: false,
    });
  });

  it('falls back to the scope session ID when the persisted ID cannot be read', async () => {
    await dispatchWithSessionId('unreadable');
    const context = wireOtelVisualizer.mock.calls[0]?.[1];

    expect(context?.runId).toBe(fixture.scopes[0]?.sessionId);
  });
});
