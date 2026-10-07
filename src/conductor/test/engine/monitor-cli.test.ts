// Covers: task:3, task:6, task:9, task:11, task:12, task:13, task:14, task:15, task:16, task:17, task:20
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  detectMonitorCommand,
  dispatchMonitorCommand,
} from '../../src/engine/monitor-cli.js';
import { resolveGuidedSessionSelection } from '../../src/engine/monitor/selection.js';
import { guardDaemonSessionInvocation } from '../../src/execution/daemon-session.js';
import { BUILT_IN_PROVIDERS, type BuiltInProviderDescriptor } from '../../src/execution/provider-catalog.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ProjectHalt } from '../../src/engine/monitor/halt-inventory.js';
import type { HaltIssueReconciliationOutcome } from '../../src/engine/monitor/loop.js';

const argv = (...args: string[]) => ['node', 'conduct', ...args];

const cleanReconciliation = (): HaltIssueReconciliationOutcome => ({
  exitCode: 0,
  recordedErrorCount: 0,
  capturedLines: [],
});

const catalogProvider: BuiltInProviderDescriptor = {
  ...BUILT_IN_PROVIDERS[0],
  id: 'catalog-provider',
  modelCatalog: BUILT_IN_PROVIDERS[2].modelCatalog,
};

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

  it.each([
    ['a configured empty model', { kind: 'run' } as const, { monitor: { model: '' } } as HarnessConfig, 'monitor: model "" is not a valid model id for provider claude.'],
    ['a per-run empty model', detectMonitorCommand(argv('monitor', 'all', '--model', ''))!, {} as HarnessConfig, 'monitor: model "" is not a valid model id for provider claude.'],
    ['a per-run flag-shaped model', detectMonitorCommand(argv('monitor', 'all', '--model', '--dangerously-skip-permissions'))!, {} as HarnessConfig, 'monitor: model "--dangerously-skip-permissions" is not a valid model id for provider claude.'],
    ['a configured whitespace model', { kind: 'run' } as const, { monitor: { model: 'opus high' } } as HarnessConfig, 'monitor: model "opus high" is not a valid model id for provider claude.'],
    ['a configured control-character model', { kind: 'run' } as const, { monitor: { model: 'op\u0007us' } } as HarnessConfig, 'monitor: model "op\u0007us" is not a valid model id for provider claude.'],
  ])('refuses %s before queue processing or session launch', async (_description, command, config, expectedError) => {
    const errors: string[] = [];
    const deriveQueueMembership = vi.fn();
    const openGuidedSession = vi.fn();

    const code = await dispatchMonitorCommand(command, '/projects/operator', {
      loadConfig: async () => ({ ok: true, config, warnings: [] }),
      deriveQueueMembership,
      openGuidedSession,
      printError: (line) => errors.push(line),
    });

    expect(code).toBe(1);
    expect(errors).toEqual([expectedError]);
    expect(deriveQueueMembership).not.toHaveBeenCalled();
    expect(openGuidedSession).not.toHaveBeenCalled();
  });

  it('refuses an absent catalog model before queue processing or session launch', async () => {
    const errors: string[] = [];
    const deriveQueueMembership = vi.fn();
    const openGuidedSession = vi.fn();

    const code = await dispatchMonitorCommand(
      detectMonitorCommand(argv('monitor', 'all', '--provider', catalogProvider.id, '--model', 'x/y'))!,
      '/projects/operator',
      {
        loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
        resolveSelection: (input) => resolveGuidedSessionSelection(input, {
          findDescriptor: () => catalogProvider,
          listCatalogModels: () => ['a/b'],
        }),
        deriveQueueMembership,
        openGuidedSession,
        printError: (line) => errors.push(line),
      },
    );

    expect({ code, errors, queueCalls: deriveQueueMembership.mock.calls.length, launchCalls: openGuidedSession.mock.calls.length }).toEqual({
      code: 1,
      errors: ['monitor: model "x/y" is not in provider catalog-provider\'s model catalog.'],
      queueCalls: 0,
      launchCalls: 0,
    });
  });

  it('forwards a well-formed per-run model unchanged to the guided-session seam', async () => {
    const openGuidedSession = vi.fn();
    const runGuidedMonitorQueue = vi.fn(async (deps: { launch: (item: ProjectHalt) => void }) => {
      deps.launch(halt());
      return { active: false };
    });

    const code = await dispatchMonitorCommand(
      detectMonitorCommand(argv('monitor', 'all', '--model', 'claude-fable-5-1'))!,
      '/projects/operator',
      {
        loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
        openGuidedSession,
        runGuidedMonitorQueue: runGuidedMonitorQueue as never,
        reconcileHaltIssues: async () => cleanReconciliation(),
        createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
        startEventSpine: (() => ({ events: { emit: async () => {} }, stop: vi.fn() })) as never,
      },
    );

    expect(code).toBe(0);
    expect(openGuidedSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude',
      model: 'claude-fable-5-1',
    }));
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
      rendered: [
        ['monitor: guided sessions use provider=codex (override), model=gpt-5.6-sol (default), effort=high (default)'],
        ['alpha: blocked-feature — needs recovery (needs-human) [no-issue; priority-band]'],
      ],
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
      reconcileHaltIssues: async () => cleanReconciliation(),
      createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
      print: (line) => output.push(line),
    });

    expect({ code, passes: membership.mock.calls.length, output }).toEqual({
      code: 1,
      passes: 1,
      output: ['monitor: guided sessions use provider=codex (override), model=gpt-5.6-sol (default), effort=high (default)'],
    });
  });

  it.each([
    ['an absent registry', 'absent', undefined, 0],
    ['an unknown project', 'unknown', 'missing', 1],
    ['a malformed registry', 'malformed', undefined, 1],
  ] as const)('ends the real loop after deriveQueueMembership sees %s', async (
    _description,
    condition,
    projectName,
    expectedCode,
  ) => {
    const registryRoot = await mkdtemp(join(tmpdir(), 'monitor-cli-registry-'));
    const registryPath = join(registryRoot, 'registry.json');
    const previousRegistry = process.env.AI_CONDUCTOR_REGISTRY;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.AI_CONDUCTOR_REGISTRY = registryPath;

    try {
      if (condition === 'unknown') {
        await writeFile(registryPath, JSON.stringify([{
          schemaVersion: 1,
          name: 'registered',
          path: registryRoot,
          status: 'registered',
          registeredAt: '2026-10-03T00:00:00.000Z',
        }]));
      } else if (condition === 'malformed') {
        await writeFile(registryPath, '{ malformed');
      }

      const code = await dispatchMonitorCommand(
        projectName === undefined ? { kind: 'run' } : { kind: 'run', projectName },
        '/projects/operator',
        {
          resolveProvider: async () => ({ provider: 'codex' }),
          reconcileHaltIssues: async () => cleanReconciliation(),
          createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
          startEventSpine: (() => ({ events: { emit: async () => {} }, stop: vi.fn() })) as never,
        },
      );

      expect(code).toBe(expectedCode);
    } finally {
      consoleLog.mockRestore();
      if (previousRegistry === undefined) delete process.env.AI_CONDUCTOR_REGISTRY;
      else process.env.AI_CONDUCTOR_REGISTRY = previousRegistry;
      await rm(registryRoot, { recursive: true, force: true });
    }
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
      reconcileHaltIssues: async () => cleanReconciliation(),
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
      reconcileHaltIssues: async () => cleanReconciliation(),
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

  it('captures halt-issue sweep output as a structured reconciliation outcome', async () => {
    let outcome!: HaltIssueReconciliationOutcome;
    const run = vi.fn(async (deps: { reconcileHaltIssues: () => Promise<HaltIssueReconciliationOutcome> }) => {
      outcome = await deps.reconcileHaltIssues();
      return { active: false };
    });
    const dispatchHaltIssuesSweep = vi.fn(async (
      _command: unknown,
      _cwd: string,
      options: { output?: { log(line: string): void; error(line: string): void } },
    ) => {
      options.output?.log('Processed 1 halt issue.');
      options.output?.error('  #123: network unavailable');
      return 0;
    });

    await dispatchMonitorCommand({ kind: 'run' }, '/projects/operator', {
      resolveProvider: async () => ({ provider: 'codex' }),
      runGuidedMonitorQueue: run as never,
      haltIssuesRepository: async () => 'owner/repo',
      dispatchHaltIssuesSweep: dispatchHaltIssuesSweep as never,
      createInterrupt: () => ({ untilStop: new Promise<void>(() => {}), dispose: vi.fn() }),
      startEventSpine: (() => ({ events: { emit: async () => {} }, stop: vi.fn() })) as never,
    });

    expect({ outcome, sweepCalls: dispatchHaltIssuesSweep.mock.calls.length }).toEqual({
      outcome: {
        exitCode: 0,
        recordedErrorCount: 1,
        capturedLines: ['Processed 1 halt issue.', '  #123: network unavailable'],
      },
      sweepCalls: 1,
    });
  });
});
