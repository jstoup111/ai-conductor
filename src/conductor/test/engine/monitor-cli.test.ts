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
      rendered: [['alpha: blocked-feature — needs recovery (needs-human)']],
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

  it('loads the monitor lazily before daemon dispatch', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const index = readFileSync(resolve(root, 'src/conductor/src/index.ts'), 'utf8');

    expect({
      monitorBeforeDaemon: index.indexOf("await import('./engine/monitor-cli.js')") < index.indexOf('detectDaemonCommand(process.argv)'),
      hasVerbGuard: index.includes("if (process.argv[2] === 'monitor')"),
    }).toEqual({ monitorBeforeDaemon: true, hasVerbGuard: true });
  });
});
