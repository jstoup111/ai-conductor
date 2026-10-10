// Covers: task:17

import { describe, expect, it } from 'vitest';
import { intakeTick } from '../src/engine/engineer/intake/intake-loop.js';
import type { DependencyDriftResult, DependencyDriftTracker } from '../src/engine/engineer/dependency-reconciler.js';
import type { IntakeLoopDeps } from '../src/engine/engineer/intake/intake-loop.js';

const REPOSITORY = 'acme/app';

function swept(overrides: Partial<Extract<DependencyDriftResult, { kind: 'swept' }>> = {}): DependencyDriftResult {
  return {
    kind: 'swept',
    unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [],
    ...overrides,
  };
}

function fakeBuild(repositories: string[], effects: string[]) {
  return () => ({
    reader: {
      listProjects: async () => repositories.map((name) => ({ name, path: `/tmp/${name}`, status: 'registered', registeredAt: '2026-10-10T00:00:00.000Z' })),
    },
    ledger: { list: async () => undefined },
    queue: { enqueue: async () => effects.push('enqueue') },
    adapter: { poll: async () => { effects.push('poll'); return []; } },
  });
}

function runTicks(times: Date[], deps: Parameters<typeof import('../src/intake-loop-cli.js').dispatchIntakeLoop>[1]) {
  return import('../src/intake-loop-cli.js').then(async ({ dispatchIntakeLoop }) => {
    let tick = 0;
    const code = await dispatchIntakeLoop(
      { kind: 'run', once: false, intervalMs: 1 },
      {
        ...deps,
        now: () => times[Math.min(tick, times.length - 1)]!,
        runIntakeLoop: async (loopDeps: IntakeLoopDeps) => {
          for (; tick < times.length; tick++) await intakeTick(loopDeps);
        },
      },
    );
    expect(code).toBe(0);
  });
}

describe('intake-loop dependency drift sweep', () => {
  it('emits one due summary with every finding list, including a clean summary', async () => {
    const effects: string[] = [];
    const events: unknown[] = [];
    const tracker: DependencyDriftTracker = { listOpenIssues: async () => [], getBlockedBy: async () => [] };
    let sweeps = 0;
    await runTicks([new Date('2026-10-10T00:00:00.000Z'), new Date('2026-10-10T00:00:00.000Z')], {
      buildIntake: fakeBuild([REPOSITORY, 'acme/clean'], effects) as any,
      createNotifier: () => ({ notify: async () => undefined }) as any,
      reconcileClosedIssues: async () => effects.push('reconcile-closed') as any,
      createDependencyDriftTracker: () => tracker,
      sweepDependencyDrift: async ({ repository }) => {
        sweeps++;
        return repository === REPOSITORY ? swept({
          unlinked: [{ source: 'acme/app#20', target: 'acme/app#10', kind: 'blocked-by', blocked_by: true }],
          stale: [{ source: 'acme/app#21', target: 'acme/app#11', kind: 'blocked-by-stale' }],
          cycles: [{ members: ['acme/app#22', 'acme/app#23'] }],
          contradictions: [{ source: 'acme/app#24', target: 'acme/app#12', kind: 'reverse-direction' }],
          indeterminate: ['acme/app#25'],
        }) : swept();
      },
      events: { emit: async (event: unknown) => void events.push(event) } as any,
      engineerDir: '/tmp/intake-loop-drift', log: () => {}, printErr: () => {},
    });

    expect(sweeps).toBe(2);
    expect(events).toEqual([
      { type: 'dependency_drift_swept', repository: REPOSITORY, status: 'swept', unlinked: ['acme/app#20 -> acme/app#10'], stale: ['acme/app#21 -> acme/app#11'], cycles: ['acme/app#22 -> acme/app#23'], contradictions: ['acme/app#24 -> acme/app#12'], indeterminate: ['acme/app#25'] },
      { type: 'dependency_drift_swept', repository: 'acme/clean', status: 'swept', unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [] },
    ]);
  });

  it('skips a repository for 10 minutes and sweeps it again after 61 minutes', async () => {
    const effects: string[] = [];
    const tracker: DependencyDriftTracker = { listOpenIssues: async () => [], getBlockedBy: async () => { throw new Error('not due'); } };
    const events: unknown[] = [];
    let sweeps = 0;
    await runTicks(['00:00', '00:10', '01:01'].map((time) => new Date(`2026-10-10T${time}:00.000Z`)), {
      buildIntake: fakeBuild([REPOSITORY], effects) as any, createNotifier: () => ({ notify: async () => undefined }) as any,
      reconcileClosedIssues: async () => ({ scanned: 0, forgotten: 0, errors: 0 }), createDependencyDriftTracker: () => tracker,
      sweepDependencyDrift: async () => { sweeps++; return swept(); }, events: { emit: async (event: unknown) => void events.push(event) } as any,
      engineerDir: '/tmp/intake-loop-drift', log: () => {}, printErr: () => {},
    });
    expect({ sweeps, events: events.length }).toEqual({ sweeps: 2, events: 2 });
  });

  it('contains a sweep failure after poll, enqueue, and closed-issue reconciliation', async () => {
    const effects: string[] = [];
    const logs: string[] = [];
    await runTicks([new Date('2026-10-10T00:00:00.000Z')], {
      buildIntake: fakeBuild([REPOSITORY], effects) as any, createNotifier: () => ({ notify: async () => undefined }) as any,
      reconcileClosedIssues: async () => effects.push('reconcile-closed') as any,
      createDependencyDriftTracker: () => ({ listOpenIssues: async () => [], getBlockedBy: async () => [] }),
      sweepDependencyDrift: async () => { throw new Error('rate limited'); },
      engineerDir: '/tmp/intake-loop-drift', log: (line) => logs.push(line), printErr: () => {},
    });
    expect(effects).toContain('poll');
    expect(effects).toContain('reconcile-closed');
    expect(logs).toContain('intake loop: dependency drift sweep failed for acme/app: rate limited');
  });

  it('publishes repository-indeterminate with empty categories and never writes', async () => {
    const effects: string[] = [];
    const events: unknown[] = [];
    const reads: string[] = [];
    const tracker: DependencyDriftTracker = {
      async listOpenIssues(repository) {
        reads.push(`list:${repository}`);
        if (repository === REPOSITORY) throw new Error('listing failed');
        return [];
      },
      async getBlockedBy(repository, number) {
        reads.push(`blocked_by:${repository}#${number}`);
        return [];
      },
    };
    await runTicks([new Date('2026-10-10T00:00:00.000Z')], {
      buildIntake: fakeBuild([REPOSITORY, 'acme/clean'], effects) as any, createNotifier: () => ({ notify: async () => undefined }) as any,
      reconcileClosedIssues: async () => ({ scanned: 0, forgotten: 0, errors: 0 }),
      createDependencyDriftTracker: () => tracker,
      events: { emit: async (event: unknown) => void events.push(event) } as any,
      engineerDir: '/tmp/intake-loop-drift', log: () => {}, printErr: () => {},
    });
    expect({ reads, events }).toEqual({ reads: ['list:acme/app', 'list:acme/clean'], events: [
      { type: 'dependency_drift_swept', repository: REPOSITORY, status: 'repository-indeterminate', unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [] },
      { type: 'dependency_drift_swept', repository: 'acme/clean', status: 'swept', unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [] },
    ] });
  });
});
