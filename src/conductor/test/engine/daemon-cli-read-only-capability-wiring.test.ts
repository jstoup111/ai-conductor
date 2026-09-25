import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runDaemonMode } from '../../src/daemon-cli.js';
import type { ReadOnlyReviewCapability } from '../../src/engine/build-review-read-only-capability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import * as daemonCore from '../../src/engine/daemon.js';
import * as daemonLock from '../../src/engine/daemon-lock.js';

const roots: string[] = [];
const testTmpdir = (): string => process.env.TMPDIR ?? '/tmp';
const conductorSource = new URL('../../src/engine/conductor.ts', import.meta.url);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function startWithCustomRubric(
  provider: 'codex' | 'claude',
  capability: ReadOnlyReviewCapability,
) {
  const projectRoot = await mkdtemp(join(testTmpdir(), 'daemon-read-only-capability-'));
  roots.push(projectRoot);
  await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), [
    'auto_restart_on_stale_engine: false', 'build_review:', '  custom_rubrics:', '    read_only:',
    '      enabled: true', '      skill: security-review', '      question: Review the change', `      llm_provider: ${provider}`,
  ].join('\n'));

  const order: string[] = [];
  const events: unknown[] = [];
  vi.spyOn(daemonLock, 'holdLock').mockResolvedValue({
    pid: process.pid, uuid: 'read-only-capability', owned: true, release: async () => {}, releaseSync: () => {},
  });
  vi.spyOn(ConductorEventEmitter.prototype, 'emit').mockImplementation(async (event) => { events.push(event); });
  vi.spyOn(daemonCore, 'runDaemon').mockImplementation(async () => {
    order.push('dispatch');
    return { processed: [], stoppedReason: 'backlog_drained' };
  });
  const probe = vi.fn(async () => {
    order.push('probe');
    return capability;
  });

  await runDaemonMode({
    projectRoot, concurrency: 1, baseBranch: 'main', ensureFresh: async () => {},
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    probeReadOnlyReviewCapability: probe,
    runHaltClassMigration: async () => join(projectRoot, '.worktrees'), watch: false,
  });
  return { events, order, probe };
}

describe('Task 10 — daemon read-only review capability wiring', () => {
  it.each(['codex', 'claude'] as const)('emits enabled %s capability before dispatch', async (provider) => {
    const { events, order, probe } = await startWithCustomRubric(provider, {
      provider, platform: process.platform, status: 'available',
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({
      type: 'build_review_read_only_capability', provider, platform: process.platform, status: 'available',
    });
    expect(order).toEqual(['probe', 'dispatch']);
  });

  it('records unavailable Codex with its platform and reason, then still dispatches', async () => {
    const { events, order } = await startWithCustomRubric('codex', {
      provider: 'codex', platform: process.platform, status: 'unavailable', reason: 'sandbox helper could not start',
    });

    expect(events).toContainEqual({
      type: 'build_review_read_only_capability',
      provider: 'codex', platform: process.platform, status: 'unavailable', reason: 'sandbox helper could not start',
    });
    expect(order).toEqual(['probe', 'dispatch']);
  });

  it('does not spawn a probe or emit a capability event without an enabled custom rubric', async () => {
    const projectRoot = await mkdtemp(join(testTmpdir(), 'daemon-no-read-only-capability-'));
    roots.push(projectRoot);
    const events: unknown[] = [];
    vi.spyOn(daemonLock, 'holdLock').mockResolvedValue({
      pid: process.pid, uuid: 'no-read-only-capability', owned: true, release: async () => {}, releaseSync: () => {},
    });
    vi.spyOn(ConductorEventEmitter.prototype, 'emit').mockImplementation(async (event) => { events.push(event); });
    vi.spyOn(daemonCore, 'runDaemon').mockResolvedValue({ processed: [], stoppedReason: 'backlog_drained' });
    const probe = vi.fn();

    await runDaemonMode({
      projectRoot, concurrency: 1, baseBranch: 'main', ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      probeReadOnlyReviewCapability: probe,
      runHaltClassMigration: async () => join(projectRoot, '.worktrees'), watch: false,
    });

    expect(probe).not.toHaveBeenCalled();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'build_review_read_only_capability' }));
  });

  it('threads the daemon-start snapshot into build_review runner options', async () => {
    const source = await readFile(conductorSource, 'utf8');
    expect(source).toMatch(/readOnlyReviewCapabilities:\s*this\.readOnlyReviewCapabilities/);
    expect(source).toMatch(/name === 'build_review'[\s\S]{0,240}readOnlyReviewCapabilities/);
  });
});
