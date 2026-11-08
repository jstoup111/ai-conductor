import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runExecutorChild, withExecutorBrokerProxies } from '../../src/engine/executor-child.js';
import { createExecutorChildRuntime } from '../../src/engine/executor-child-runtime.js';
import type { ChildFeatureExecutorDeps, ForkedExecutor } from '../../src/engine/child-feature-executor.js';
import type { ExecutorChildRunInput } from '../../src/engine/executor-child.js';
import type { FeatureExecutionOutcome } from '../../src/engine/feature-executor.js';
import type { ExecutorIpcPort } from '../../src/engine/executor-proxies.js';
import { EXECUTOR_PROTOCOL_VERSION } from '../../src/engine/executor-protocol.js';

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
  /**
   * An in-memory child shares the test process with its supervisor. Opt in only
   * when a test specifically exercises the child console forwarding boundary.
   */
  readonly captureConsole?: boolean;
  /** Observes supervisor-to-child protocol messages for lifecycle assertions. */
  readonly onSupervisorMessage?: (message: unknown) => void;
  /**
   * Replaces only the child feature runner after production child composition
   * has admitted the work order and created its worktree.
   */
  readonly run?: (input: ExecutorChildRunInput) => Promise<FeatureExecutionOutcome>;
  /**
   * Supplies an already-owned worktree only when the test's subject begins
   * after worktree creation (for example, supervisor-side OTel wiring).
   */
  readonly createWorktree?: (order: import('../../src/engine/work-order.js').WorkOrder) => Promise<{ path: string }>;
  /** Hello protocol versions emitted by successive in-memory children. */
  readonly protocolVersions?: readonly number[];
  /** Observes a supervisor-issued child termination signal. */
  readonly onChildKill?: (signal: NodeJS.Signals) => void;
  /** Runs in the supervisor immediately before each child endpoint starts. */
  readonly onFork?: () => void;
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
  private readonly supervisorConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  readonly port: ExecutorIpcPort = {
    send: (message, callback) => {
      const emitted = isHello(message)
        ? { ...message, protocolVersion: this.protocolVersion }
        : message;
      if (isLog(emitted)) {
        if (this.slug !== undefined && this.consoleSinks !== undefined) {
          const sink = this.consoleSinks?.get(this.slug) ?? [];
          sink.push(emitted.message);
          this.consoleSinks?.set(this.slug, sink);
          // In-memory children share the host's global console. A fixture
          // explicitly collecting child console output substitutes for the
          // process boundary and must not re-enter the daemon logger.
          callback?.(null);
          return true;
        }
      }
      if (isHello(emitted)) this.onHello?.({ engineVersionId: emitted.engineVersionId });
      // Restore the supervisor console while dispatching synchronously. A
      // real child cannot inherit the supervisor's console proxy; without
      // this boundary substitute, broker event rendering recursively re-enters
      // the current in-memory child's proxy as well as direct child logs.
      const childConsole = { log: console.log, warn: console.warn, error: console.error };
      console.log = this.supervisorConsole.log;
      console.warn = this.supervisorConsole.warn;
      console.error = this.supervisorConsole.error;
      try {
        this.deliver(this.supervisorListeners, 'message', emitted);
      } finally {
        console.log = childConsole.log;
        console.warn = childConsole.warn;
        console.error = childConsole.error;
      }
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
    private readonly onSupervisorMessage: ((message: unknown) => void) | undefined,
    private readonly protocolVersion: number,
    private readonly onChildKill: ((signal: NodeJS.Signals) => void) | undefined,
  ) {}

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.onSupervisorMessage?.(message);
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
    this.onChildKill?.(signal);
    this.exit(null, signal);
    return true;
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
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
  captureConsole = false,
  onSupervisorMessage,
  run,
  createWorktree,
  protocolVersions = [EXECUTOR_PROTOCOL_VERSION],
  onChildKill,
  onFork,
}: InMemoryExecutorForkOptions): NonNullable<ChildFeatureExecutorDeps['fork']> {
  // A real child installs these process-global services at process start. The
  // test host owns them once and children therefore inherit rather than
  // replacing a resolver while concurrent in-memory executions are active.
  const runtime = createExecutorChildRuntime({ projectRoot, processServices: 'inherited' });
  let childCount = 0;

  return (modulePath) => {
    onFork?.();
    const protocolVersion = protocolVersions[Math.min(childCount++, protocolVersions.length - 1)] ?? EXECUTOR_PROTOCOL_VERSION;
    const child = new InMemoryForkedExecutor(consoleSinks, onHello, onSupervisorMessage, protocolVersion, onChildKill);
    if (handshake === 'normal') {
      queueMicrotask(() => {
        void runExecutorChild(child.port, withExecutorBrokerProxies(child.port, {
          moduleDir: dirname(modulePath),
          admitDispatch: runtime.admitDispatch,
          createWorktree: createWorktree === undefined
            ? runtime.createWorktree
            : async (order) => createWorktree(order),
          run: run ?? runtime.run,
          log: (message) => child.port.send({ kind: 'log', level: 'info', message }),
          waitForSupervisorVisualizerClose: true,
          forwardConsole: captureConsole,
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
