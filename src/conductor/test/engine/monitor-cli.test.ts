// Covers: task:20
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  detectMonitorCommand,
  dispatchMonitorCommand,
} from '../../src/engine/monitor-cli.js';
import { guardDaemonSessionInvocation } from '../../src/execution/daemon-session.js';
import type { ProjectHalt } from '../../src/engine/monitor/halt-inventory.js';

const argv = (...args: string[]) => ['node', 'conduct', ...args];

function halt(): ProjectHalt {
  return {
    project: '/projects/alpha',
    projectName: 'alpha',
    slug: 'blocked-feature',
    reason: 'needs recovery',
    haltClass: 'needs-human',
  };
}

describe('Task 20 — monitor pre-boot command', () => {
  it('recognizes the all-projects selector', () => {
    expect(detectMonitorCommand(['node', 'conduct', 'monitor', 'all'])).toEqual({
      kind: 'run',
    });
  });

  it('recognizes a single registered-project selector', () => {
    expect(detectMonitorCommand(argv('monitor', 'alpha'))).toEqual({
      kind: 'run',
      projectName: 'alpha',
    });
  });

  it('returns guidance for malformed monitor input instead of falling through', () => {
    expect(detectMonitorCommand(argv('monitor', 'all', 'extra'))).toEqual({ kind: 'guide' });
  });

  it('passes the selected project into the queue-driving loop without launching a real session', async () => {
    const deriveQueueMembership = vi.fn(async () => ({ code: 0, halts: [halt()] }));
    const offer = vi.fn();
    const runGuidedMonitorQueue = vi.fn(async (deps: {
      deriveMembership: () => Promise<readonly ProjectHalt[]>;
      offer: (item: ProjectHalt) => void;
    }) => {
      const [item] = await deps.deriveMembership();
      deps.offer(item!);
      return { active: false };
    });

    const code = await dispatchMonitorCommand(
      { kind: 'run', projectName: 'alpha' },
      '/projects/operator',
      {
        resolveProvider: async () => ({ provider: 'codex' }),
        deriveQueueMembership,
        runGuidedMonitorQueue: runGuidedMonitorQueue as never,
        createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
        print: (message) => offer(message),
      },
    );

    expect({
      code,
      selection: deriveQueueMembership.mock.calls,
      rendered: offer.mock.calls,
    }).toEqual({
      code: 0,
      selection: [[{ projectName: 'alpha' }]],
      rendered: [['alpha: blocked-feature — needs recovery (needs-human) [no-issue; priority-band]']],
    });
  });

  it('is refused by the daemon-session guard before a queue enumerator can run', async () => {
    const enumerate = vi.fn();
    const verdict = guardDaemonSessionInvocation(argv('monitor', 'all'), {
      CONDUCT_DAEMON_SESSION: '1',
    });

    if (verdict.allowed) {
      await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
        deriveQueueMembership: enumerate,
      });
    }

    expect({ allowed: verdict.allowed, enumerationCalls: enumerate.mock.calls.length }).toEqual({
      allowed: false,
      enumerationCalls: 0,
    });
  });

  it('ends the real loop on a terminal inventory result instead of polling an empty queue', async () => {
    const output: string[] = [];
    const membership = vi.fn(async () => ({ code: 1, terminal: true, halts: [] }));

    const code = await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
      resolveProvider: async () => ({ provider: 'codex' }),
      deriveQueueMembership: membership as never,
      reconcileHaltIssues: async () => 0,
      createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
      print: (line) => output.push(line),
    });

    expect({ code, passes: membership.mock.calls.length, output }).toEqual({
      code: 1,
      passes: 1,
      output: [],
    });
  });

  it('reports an unknown configured provider before scanning an empty queue', async () => {
    const membership = vi.fn();
    const errors: string[] = [];

    const code = await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
      resolveProvider: async () => ({ provider: 'unknown-provider' }),
      deriveQueueMembership: membership,
      printError: (line) => errors.push(line),
    });

    expect({ code, calls: membership.mock.calls.length, errors }).toEqual({
      code: 1,
      calls: 0,
      errors: ['monitor: unregistered provider unknown-provider.'],
    });
  });

  it('injects the operator event spine into the composed monitor loop', async () => {
    const emit = vi.fn(async () => {});
    const startEventSpine = vi.fn(() => ({ events: { emit }, stop: vi.fn() }));
    const run = vi.fn(async (deps: { events: unknown }) => {
      expect(deps.events).toEqual({ emit });
      return { active: false };
    });

    await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
      resolveProvider: async () => ({ provider: 'codex' }),
      runGuidedMonitorQueue: run as never,
      startEventSpine: startEventSpine as never,
      reconcileHaltIssues: async () => 0,
      createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
    });

    expect(startEventSpine).toHaveBeenCalledWith('/projects/operator');
  });

  it('reads durable deferrals on the composed pass and keeps them behind unseen work', async () => {
    const deferred = { ...halt(), slug: 'deferred' };
    const unseen = { ...halt(), slug: 'unseen' };
    const identity = { present: true, mtimeMs: 10, size: 20 } as const;
    const readDeferrals = vi.fn(async () => [{
      project: deferred.project,
      feature: deferred.slug,
      haltIdentity: identity,
    }]);
    const priorityResolver = { resolve: vi.fn(async () => ({ mode: 'banded' as const, bands: new Map() })) };
    const run = vi.fn(async (deps: { deriveMembership: () => Promise<readonly ProjectHalt[]> }) => {
      await expect(deps.deriveMembership()).resolves.toMatchObject([{ slug: 'unseen' }, { slug: 'deferred' }]);
      return { active: false };
    });

    await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
      resolveProvider: async () => ({ provider: 'codex' }),
      deriveQueueMembership: async () => ({ code: 0, halts: [deferred, unseen] }),
      readDeferrals,
      snapshotHaltMarker: async () => identity,
      priorityResolver,
      runGuidedMonitorQueue: run as never,
      reconcileHaltIssues: async () => 0,
      createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
    });

    expect(readDeferrals).toHaveBeenCalledWith('/projects/alpha', expect.any(Object));
  });

  it('loads the monitor lazily before daemon dispatch', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const index = readFileSync(resolve(root, 'src/conductor/src/index.ts'), 'utf8');

    expect({
      monitorBeforeDaemon: index.indexOf("await import('./engine/monitor-cli.js')") < index.indexOf('detectDaemonCommand(process.argv)'),
      hasVerbGuard: index.includes("if (process.argv[2] === 'monitor')"),
    }).toEqual({ monitorBeforeDaemon: true, hasVerbGuard: true });
  });
});
