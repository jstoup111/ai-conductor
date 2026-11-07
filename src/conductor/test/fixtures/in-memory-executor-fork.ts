import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runExecutorChild, withExecutorBrokerProxies } from '../../src/engine/executor-child.js';
import { createExecutorChildRuntime } from '../../src/engine/executor-child-runtime.js';
import type { ChildFeatureExecutorDeps, ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import type { ExecutorIpcPort } from '../../src/engine/executor-proxies.js';

export const ENGINE_STORE_ENV_VAR = 'AI_CONDUCTOR_ENGINE_STORE';

export const TEMP_ENGINE_VERSION_ID = '20261107T000000Z-0123456789ab';

export interface TempEngineStore {
  engineRoot: {
    conductorRoot: string;
    ownEngineDir: string;
  };
  teardown(): Promise<void>;
}

export interface InMemoryExecutorForkOptions {
  /** Canonical daemon root supplied to the production child-runtime factory. */
  readonly projectRoot: string;
  /** Deliberately omit startup only for the executor handshake failure case. */
  readonly handshake?: 'normal' | 'silent';
  /** Observes the real startup message after it has reached the supervisor. */
  readonly onHello?: (hello: { readonly engineVersionId: string }) => void;
  /** Per-child console lines, keyed by the dispatched feature slug. */
  readonly consoleSinks?: Map<string, string[]>;
}

type Listener = (value?: unknown) => void;

/**
 * A process-shaped endpoint whose two listener sets retain Node IPC's
 * directionality.  The child entrypoint receives `port`; the supervisor and
 * broker receive this instance as their `ForkedExecutor`.
 */
class InMemoryForkedExecutor implements ForkedExecutor {
  private static nextPid = 70_000;

  readonly pid = InMemoryForkedExecutor.nextPid++;
  private readonly supervisorListeners = new Map<'message' | 'disconnect', Listener[]>();
  private readonly childListeners = new Map<'message' | 'disconnect', Listener[]>();
  private exitListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  private exited = false;
  private slug: string | undefined;

  readonly port: ExecutorIpcPort = {
    send: (message, callback) => {
      if (isLog(message) && this.slug !== undefined) {
        const sink = this.consoleSinks?.get(this.slug) ?? [];
        sink.push(message.message);
        this.consoleSinks?.set(this.slug, sink);
      }
      if (isHello(message)) this.onHello?.({ engineVersionId: message.engineVersionId });
      this.deliver(this.supervisorListeners, 'message', message);
      // Node runs this callback after the message is accepted by IPC.  The
      // child waits for it before disconnecting, so an in-memory outcome is
      // never lost to a premature synthetic exit.
      callback?.(null);
      return true;
    },
    on: (event, listener) => {
      this.add(this.childListeners, event, listener);
      return this.port;
    },
    off: (event, listener) => {
      this.remove(this.childListeners, event, listener);
      return this.port;
    },
    disconnect: () => {
      this.deliver(this.supervisorListeners, 'disconnect');
    },
    connected: true,
  };

  constructor(
    private readonly consoleSinks: Map<string, string[]> | undefined,
    private readonly onHello: ((hello: { readonly engineVersionId: string }) => void) | undefined,
  ) {}

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    if (isWorkOrder(message)) this.slug = message.order.slug;
    this.deliver(this.childListeners, 'message', message);
    callback?.(null);
    return true;
  }

  on(event: 'message' | 'disconnect', listener: Listener): this {
    this.add(this.supervisorListeners, event, listener);
    return this;
  }

  once(_event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this {
    this.exitListener = listener;
    return this;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.exit(null, signal);
    return true;
  }

  exit(code = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitListener?.(code, signal);
  }

  private add(listeners: Map<'message' | 'disconnect', Listener[]>, event: 'message' | 'disconnect', listener: Listener): void {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  }

  private remove(listeners: Map<'message' | 'disconnect', Listener[]>, event: 'message' | 'disconnect', listener: Listener): void {
    listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
  }

  private deliver(listeners: Map<'message' | 'disconnect', Listener[]>, event: 'message' | 'disconnect', value?: unknown): void {
    for (const listener of listeners.get(event) ?? []) listener(value);
  }
}

function isHello(value: unknown): value is { kind: 'hello'; engineVersionId: string } {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'hello'
    && typeof (value as { engineVersionId?: unknown }).engineVersionId === 'string';
}

function isLog(value: unknown): value is { kind: 'log'; message: string } {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'log'
    && typeof (value as { message?: unknown }).message === 'string';
}

function isWorkOrder(value: unknown): value is { kind: 'work-order'; order: { slug: string } } {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'work-order'
    && typeof (value as { order?: { slug?: unknown } }).order?.slug === 'string';
}

/**
 * Replaces only `child_process.fork`.  It runs the real child endpoint,
 * broker proxies, and child-runtime composition in this test process.
 */
export function createInMemoryExecutorFork({
  projectRoot,
  handshake = 'normal',
  onHello,
  consoleSinks,
}: InMemoryExecutorForkOptions): NonNullable<ChildFeatureExecutorDeps['fork']> {
  // A real child installs these process-global services at process start. The
  // test host owns them once and children therefore inherit rather than
  // replacing a resolver while concurrent in-memory executions are active.
  const runtime = createExecutorChildRuntime({ projectRoot, processServices: 'inherited' });

  return (modulePath) => {
    const child = new InMemoryForkedExecutor(consoleSinks, onHello);
    if (handshake === 'normal') {
      queueMicrotask(() => {
        void runExecutorChild(child.port, withExecutorBrokerProxies(child.port, {
          moduleDir: dirname(modulePath),
          admitDispatch: runtime.admitDispatch,
          createWorktree: runtime.createWorktree,
          run: runtime.run,
          exit: () => child.exit(),
        }));
      });
    }
    return child;
  };
}

/**
 * Creates a complete minimal published-engine layout for daemon composition
 * tests and restores the process-global store override when released.
 */
export async function useTempEngineStore(
  versionId = TEMP_ENGINE_VERSION_ID,
): Promise<TempEngineStore> {
  const conductorRoot = await mkdtemp(join(tmpdir(), 'in-memory-engine-store-'));
  const storeRoot = join(conductorRoot, 'dist-versions');
  const ownEngineDir = join(storeRoot, versionId);
  const previousStoreRoot = process.env[ENGINE_STORE_ENV_VAR];

  await mkdir(ownEngineDir, { recursive: true });
  await symlink(join('dist-versions', versionId), join(conductorRoot, 'dist'), 'dir');
  process.env[ENGINE_STORE_ENV_VAR] = storeRoot;

  return {
    engineRoot: { conductorRoot, ownEngineDir },
    async teardown(): Promise<void> {
      if (previousStoreRoot === undefined) delete process.env[ENGINE_STORE_ENV_VAR];
      else process.env[ENGINE_STORE_ENV_VAR] = previousStoreRoot;
      await rm(conductorRoot, { recursive: true, force: true });
    },
  };
}
