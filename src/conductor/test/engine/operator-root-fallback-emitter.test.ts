// Covers: task:5
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * AB-2 (operator roots): halt-issues sweep, operator reconcile-parked, and the
 * operator engineer lifetime must hand the canonical emitter to their guarded
 * GitHub boundaries so D9 warned operator fallback can run. Every process
 * boundary below is mocked; no real gh/git is reached.
 */
afterEach(() => {
  vi.doUnmock('../../src/engine/tracker-client.js');
  vi.doUnmock('../../src/engine/halt-issues/sweep.js');
  vi.doUnmock('../../src/engine/shipment-evidence-cli.js');
  vi.resetModules();
});

describe('operator composition roots thread the canonical emitter', () => {
  it('halt-issues sweep builds its mutation-capable tracker with events', async () => {
    vi.resetModules();
    const trackerOptions: Array<Record<string, unknown>> = [];
    const sweep = vi.fn(async () => ({ summary: 'ok', parsed: 0, errors: 0, exitCode: 0 }));
    vi.doMock('../../src/engine/halt-issues/sweep.js', () => ({ sweep }));
    vi.doMock('../../src/engine/tracker-client.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/engine/tracker-client.js')>('../../src/engine/tracker-client.js');
      return {
        ...actual,
        makeProductionGh: () => async () => { throw new Error('unexpected gh'); },
        createGithubTrackerClient: vi.fn((runner: never, options: Record<string, unknown>) => {
          trackerOptions.push(options);
          return actual.createGithubTrackerClient(runner, options as never);
        }),
      };
    });
    const { dispatchHaltIssuesSweep } = await import('../../src/engine/halt-issues/halt-issues-cli.js');
    const events = { emit: vi.fn(async () => {}) };
    const code = await dispatchHaltIssuesSweep(
      { kind: 'sweep', dryRun: true, repoDir: '/fixture', monitorLog: '/fixture/m.log', ledger: '/fixture/l.json', ghRepo: 'acme/widget' },
      '/fixture',
      { events },
    );
    expect(code).toBe(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(trackerOptions).toHaveLength(1);
    expect(trackerOptions[0].events).toBe(events);
  });

  it('operator reconcile-parked hands events to the record-repair requester', async () => {
    vi.resetModules();
    const requesterOptions: Array<Record<string, unknown>> = [];
    vi.doMock('../../src/engine/shipment-evidence-cli.js', async () => ({
      ...await vi.importActual('../../src/engine/shipment-evidence-cli.js'),
      makeRecordRepairRequester: vi.fn((options: Record<string, unknown>) => {
        requesterOptions.push(options);
        return async () => {};
      }),
    }));
    const { dispatchDaemonPark } = await import('../../src/engine/daemon-park-cli.js');
    const root = await mkdtemp(join(tmpdir(), 'reconcile-emitter-'));
    try {
      const events = { emit: vi.fn(async () => {}) };
      await dispatchDaemonPark({ kind: 'reconcile-parked', slug: 'feature' } as never, {
        cwd: root,
        out: () => {},
        runGit: async () => { throw new Error('not a repo'); },
        runGh: async () => { throw new Error('unexpected gh'); },
        events,
        reconcileMergedPark: async ({ requestRecordRepair }) => {
          await requestRecordRepair?.({ slug: 'feature', prUrl: 'https://github.com/acme/widget/pull/1' });
          return {} as never;
        },
      });
      expect(requesterOptions).toHaveLength(1);
      expect(requesterOptions[0].events).toBe(events);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('operator event spine persists a fallback warning to the canonical events.jsonl', async () => {
    const { startOperatorEventSpine } = await import('../../src/engine/event-persister.js');
    const root = await mkdtemp(join(tmpdir(), 'operator-spine-'));
    try {
      const spine = startOperatorEventSpine(root);
      await spine.events.emit({
        type: 'github_write_credential_fallback',
        operation: 'issue.comment.create',
        target: { repository: 'acme/widget', kind: 'issue', number: 3 },
        reason: 'auth-refused',
      });
      spine.stop();
      const persisted = await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8');
      expect(persisted).toContain('"github_write_credential_fallback"');
      expect(persisted).toContain('"auth-refused"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
