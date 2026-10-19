// Covers: task:14, task:15, task:16
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConductState } from '../../src/types/index.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { runExecutorChild, withExecutorBrokerProxies } from '../../src/engine/executor-child.js';
import { EXECUTOR_PROTOCOL_VERSION } from '../../src/engine/executor-protocol.js';
import type { WorkOrder } from '../../src/engine/work-order.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';

const VERSION = '20261019T120000Z-aaaaaaaaaaaa' as WorkOrder['engineVersionId'];
const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: VERSION,
  supervisorEngineVersionId: '20261019T120001Z-bbbbbbbbbbbb' as WorkOrder['engineVersionId'],
  manifest: [],
};

const LEGACY_CONCURRENCY_REFUSAL =
  'LEGACY_NO_PROVIDER_EXECUTION_CONCURRENCY_REFUSAL: legacy no-providerExecution dispatch mutates process-global provider environment and cannot run with effective daemon concurrency 2 (requires 1).';

class FakePort {
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
  send(value: unknown): boolean { this.sent.push(value); return true; }
  on(event: 'message' | 'disconnect', listener: (value?: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  dispatch(value: unknown): void { for (const listener of this.listeners.get('message') ?? []) listener(value); }
  disconnect(): void { for (const listener of this.listeners.get('disconnect') ?? []) listener(); }
}

function legacyGuardrails(): SelfHostGuardrails {
  return {
    resolveHarnessRoot: vi.fn(async () => root!),
    resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: root! })),
    relink: vi.fn(async () => {}),
    provisionSandbox: vi.fn(async () => ({
      configDir: '/tmp/executor-child-legacy-provider-env',
      childEnv: () => ({ ...process.env }),
      teardown: vi.fn(async () => {}),
    })),
    versionGate: vi.fn(async () => ({ ok: true as const })),
    releaseGate: vi.fn(async () => ({ ok: true as const })),
  };
}

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('executor child entrypoint', () => {
  it('forwards envelope concurrency to the existing legacy no-providerExecution refusal', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    const runner: StepRunner = {
      selfHostRunId: () => 'executor-child-legacy-guard',
      run: vi.fn(async () => ({ success: true })),
    };
    const done = runExecutorChild(port, {
      engineVersionId: VERSION,
      createWorktree: async () => ({ path: root! }),
      run: async ({ effectiveConcurrency }) => {
        const conductor = new Conductor({
          stateFilePath: join(root!, 'conduct-state.json'),
          stepRunner: runner,
          events: new ConductorEventEmitter(),
          projectRoot: root!,
          daemon: true,
          selfHost: true,
          featureSlug: 'feature',
          selfHostGuardrails: legacyGuardrails(),
          config: {
            daemon_concurrency: 1,
            llm_provider: 'claude',
            harness_self_host: { build_auth: { mode: 'api-key' } },
          },
          effectiveDaemonConcurrency: effectiveConcurrency,
        });
        const result = await (conductor as unknown as {
          runSelfBuildDispatch: (step: 'build', state: ConductState) => Promise<{ success: boolean; output?: string }>;
        }).runSelfBuildDispatch('build', { feature_desc: 'feature' } as ConductState);
        return result.success
          ? { slug: 'feature', status: 'done' as const }
          : { slug: 'feature', status: 'error' as const, reason: result.output };
      },
    });

    // The IPC value is authoritative over the compatibility copy in the
    // WorkOrder, proving the child preserves the supervisor's pool width.
    port.dispatch({
      kind: 'work-order',
      order: { ...order, effectiveConcurrency: 1 },
      effectiveConcurrency: 2,
    });
    await done;

    expect(runner.run).not.toHaveBeenCalled();
    expect(port.sent.filter((message) => (message as { kind?: string }).kind === 'outcome')).toEqual([
      { kind: 'outcome', outcome: { slug: 'feature', status: 'error', reason: LEGACY_CONCURRENCY_REFUSAL } },
    ]);
  });

  it('waits for the order, then persists its own started event and one outcome through broker proxies', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    const calls: string[] = [];
    const done = runExecutorChild(port, withExecutorBrokerProxies(port, {
      engineVersionId: VERSION,
      createWorktree: async (received, lifecycle) => {
        calls.push(`create:${received.slug}`);
        expect(lifecycle).toBeDefined();
        const path = join(root!, '.worktrees', received.slug);
        await import('node:fs/promises').then(({ mkdir }) => mkdir(path, { recursive: true }));
        return { path };
      },
      run: async ({ order: received, rateLimitEpisode, providerAvailability, liveBoundaryCoordinator, worktreeLifecycle }) => {
        calls.push(`run:${received.slug}`);
        expect(rateLimitEpisode).toBeDefined();
        expect(providerAvailability).toBeDefined();
        expect(liveBoundaryCoordinator).toBeDefined();
        expect(worktreeLifecycle).toBeDefined();
        return { slug: received.slug, status: 'done' };
      },
      liveBoundaryEnabled: true,
    }));

    expect(port.sent).toEqual([{ kind: 'hello', protocolVersion: EXECUTOR_PROTOCOL_VERSION, engineVersionId: VERSION }]);
    expect(calls).toEqual([]);
    port.dispatch({ kind: 'work-order', order });
    await done;

    expect(calls).toEqual(['create:feature', 'run:feature']);
    await expect(readFile(join(root, '.worktrees', 'feature', '.pipeline', 'work-order.json'), 'utf8'))
      .resolves.toBe(`${JSON.stringify(order)}\n`);
    const ledger = (await readFile(join(root, '.worktrees', 'feature', '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'executor_started', slug: 'feature', engineVersionId: VERSION,
        protocolVersion: EXECUTOR_PROTOCOL_VERSION,
        supervisorEngineVersionId: order.supervisorEngineVersionId,
      }),
    ]));
    expect(port.sent.filter((message) => (message as { kind?: string }).kind === 'outcome')).toEqual([
      { kind: 'outcome', outcome: { slug: 'feature', status: 'done' } },
    ]);
  });

  it('stops an in-flight child through its abort signal, retains feature state, and reports parked', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let observedAbort = false;
    let exitCode: number | undefined;
    const done = runExecutorChild(port, {
      engineVersionId: VERSION,
      createWorktree: async () => {
        const path = join(root!, '.worktrees', 'feature');
        await import('node:fs/promises').then(({ mkdir }) => mkdir(path, { recursive: true }));
        return { path };
      },
      run: async ({ signal }) => {
        started();
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
          observedAbort = true;
          resolve();
        }, { once: true }));
        await import('node:fs/promises').then(({ writeFile }) => writeFile(
          join(root!, '.worktrees', 'feature', '.pipeline', 'conduct-state.json'),
          '{"preserved":true}\n',
        ));
        return { slug: 'feature', status: 'parked', reason: String(signal.reason) };
      },
      exit: (code) => { exitCode = code; },
    });

    port.dispatch({ kind: 'work-order', order });
    await running;
    port.dispatch({ kind: 'stop', reason: 'supervisor shutdown' });
    await done;

    expect(observedAbort).toBe(true);
    expect(exitCode).toBe(0);
    await expect(readFile(join(root, '.worktrees', 'feature', '.pipeline', 'conduct-state.json'), 'utf8'))
      .resolves.toBe('{"preserved":true}\n');
    expect(port.sent.filter((message) => (message as { kind?: string }).kind === 'outcome')).toEqual([
      { kind: 'outcome', outcome: { slug: 'feature', status: 'parked', reason: 'supervisor shutdown' } },
    ]);
  });

  it('takes the identical parked shutdown path when the supervisor disconnects', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let exitCode: number | undefined;
    const done = runExecutorChild(port, {
      engineVersionId: VERSION,
      createWorktree: async () => {
        const path = join(root!, '.worktrees', 'feature');
        await import('node:fs/promises').then(({ mkdir }) => mkdir(path, { recursive: true }));
        return { path };
      },
      run: async ({ signal }) => {
        started();
        await new Promise<void>((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return { slug: 'feature', status: 'parked', reason: String(signal.reason) };
      },
      exit: (code) => { exitCode = code; },
    });

    port.dispatch({ kind: 'work-order', order });
    await running;
    port.disconnect();
    await done;

    expect(exitCode).toBe(0);
    expect(port.sent.filter((message) => (message as { kind?: string }).kind === 'outcome')).toEqual([
      { kind: 'outcome', outcome: { slug: 'feature', status: 'parked', reason: 'supervisor disconnected' } },
    ]);
  });

  it('exits if stopped before a work order without creating feature state', async () => {
    root = await mkdtemp(join(tmpdir(), 'executor-child-'));
    const port = new FakePort();
    let exitCode: number | undefined;
    const done = runExecutorChild(port, {
      engineVersionId: VERSION,
      createWorktree: async () => { throw new Error('must not create worktree'); },
      run: async () => ({ slug: 'feature', status: 'done' }),
      exit: (code) => { exitCode = code; },
    });

    port.dispatch({ kind: 'stop', reason: 'supervisor shutdown' });
    await done;

    expect(exitCode).toBe(0);
    await expect(import('node:fs/promises').then(({ access }) => access(join(root!, '.worktrees', 'feature'))))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
