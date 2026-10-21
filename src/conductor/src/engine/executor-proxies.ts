import type { LiveBoundaryCoordinator, LiveBoundaryWindow, OpenAdmittedWindow } from './self-host/live-boundary-coordinator.js';
import type { ProviderAvailability } from './provider-availability.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';

/** Minimal IPC port shared by the real Node channel and deterministic tests. */
export interface ExecutorIpcPort {
  send(message: unknown): boolean | void;
  on(event: 'message' | 'disconnect', listener: (message?: unknown) => void): unknown;
  off?(event: 'message' | 'disconnect', listener: (message?: unknown) => void): unknown;
  disconnect?(): void;
  connected?: boolean;
}

type State = { kind: 'state'; name: 'rate-limit' | 'provider'; value: unknown };

export interface ExecutorRequestClient {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  close(reason?: string): void;
}

/** Build a request client and retain locally-replicated synchronous state. */
export function createExecutorRequestClient(port: ExecutorIpcPort): ExecutorRequestClient & {
  onState(listener: (state: State) => void): void;
} {
  let sequence = 0;
  let closed: Error | undefined;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  const stateListeners = new Set<(state: State) => void>();
  const latestStates = new Map<State['name'], State>();
  const rejectPending = (reason: Error) => {
    closed = reason;
    for (const entry of pending.values()) entry.reject(reason);
    pending.clear();
  };
  const onMessage = (raw?: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { kind?: unknown; requestId?: unknown; result?: unknown; name?: unknown; value?: unknown };
    if (message.kind === 'response' && typeof message.requestId === 'string') {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      const result = message.result as { ok?: unknown; error?: unknown } | undefined;
      if (result && result.error !== undefined) entry.reject(new Error(String(result.error)));
      else entry.resolve(result && 'ok' in result ? result.ok : message.result);
      return;
    }
    if (message.kind === 'state' && (message.name === 'rate-limit' || message.name === 'provider')) {
      const state = message as State;
      latestStates.set(state.name, state);
      for (const listener of stateListeners) listener(state);
    }
  };
  const onDisconnect = () => rejectPending(new Error('executor supervisor channel disconnected'));
  port.on('message', onMessage);
  port.on('disconnect', onDisconnect);
  return {
    request(method, params, signal) {
      if (closed) return Promise.reject(closed);
      if (signal?.aborted) return Promise.reject(new Error('executor request aborted'));
      const requestId = `executor-${++sequence}`;
      return new Promise((resolve, reject) => {
        const onAbort = () => { pending.delete(requestId); reject(new Error('executor request aborted')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.set(requestId, {
          resolve: (value) => { signal?.removeEventListener('abort', onAbort); resolve(value); },
          reject: (reason) => { signal?.removeEventListener('abort', onAbort); reject(reason); },
        });
        port.send({ kind: 'request', requestId, method, params });
      });
    },
    close(reason = 'executor request client closed') {
      rejectPending(new Error(reason));
      port.off?.('message', onMessage);
      port.off?.('disconnect', onDisconnect);
    },
    onState(listener) {
      stateListeners.add(listener);
      // The broker can announce a snapshot before a proxy is composed. Replay
      // it synchronously so replicas never start from an invented empty state.
      for (const state of latestStates.values()) listener(state);
    },
  };
}

export function createRateLimitEpisodeProxy(client: ReturnType<typeof createExecutorRequestClient>, now = () => Date.now()): RateLimitEpisode {
  let deadline: number | undefined;
  let escalationCounter = 0;
  client.onState((state) => {
    if (state.name !== 'rate-limit' || !state.value || typeof state.value !== 'object') return;
    const value = state.value as { deadline?: unknown; escalationCounter?: unknown };
    deadline = typeof value.deadline === 'number' ? value.deadline : undefined;
    escalationCounter = typeof value.escalationCounter === 'number' ? value.escalationCounter : 0;
  });
  return {
    enter(untilMs) {
      if (!Number.isFinite(untilMs) || untilMs <= now()) deadline = undefined;
      else deadline = Math.max(deadline ?? 0, untilMs);
      void client.request('rate-limit.enter', { untilMs }).catch(() => {});
    },
    active(nowMs = now()) { return deadline !== undefined && nowMs < deadline; },
    clear(signal) { return client.request('rate-limit.clear', {}, signal).then(() => undefined); },
    nextWaitSeconds(baseSeconds = 60) {
      const base = Number.isFinite(baseSeconds) && baseSeconds > 0 ? baseSeconds : 60;
      const waitSeconds = escalationCounter === 0
        ? base
        : Math.min(3600, base * (2 ** escalationCounter));
      escalationCounter += 1;
      // The return stays synchronous from the replica. The request advances the
      // supervisor's authoritative counter and refreshes every replica.
      void client.request('rate-limit.next-wait', { baseSeconds }).catch(() => {});
      return waitSeconds;
    },
  };
}

export function createProviderAvailabilityProxy(client: ReturnType<typeof createExecutorRequestClient>, now = () => Date.now()): ProviderAvailability {
  const windows = new Map<string, number>();
  client.onState((state) => {
    if (state.name !== 'provider' || !state.value || typeof state.value !== 'object') return;
    windows.clear();
    for (const [provider, until] of Object.entries(state.value as Record<string, unknown>)) {
      if (typeof until === 'number') windows.set(provider, until);
    }
  });
  return {
    suppress(provider, untilMs) {
      if (untilMs > now()) windows.set(provider, Math.max(windows.get(provider) ?? 0, untilMs));
      void client.request('provider.suppress', { provider, untilMs }).catch(() => {});
    },
    isAvailable(provider) {
      const until = windows.get(provider);
      if (until === undefined || until <= now()) { windows.delete(provider); return true; }
      return false;
    },
  };
}

export function createLiveBoundaryProxy(
  client: ReturnType<typeof createExecutorRequestClient>,
  enabled = true,
): Pick<LiveBoundaryCoordinator, 'runDispatch' | 'openWindow'> | undefined {
  // Consumer daemons have no self-host live boundary. Preserve the existing
  // inert path without emitting an IPC request for a resource that cannot
  // exist on their supervisor.
  if (!enabled) return undefined;
  const open = async (): Promise<LiveBoundaryWindow> => {
    const id = await client.request('live.open', {});
    if (typeof id !== 'string') throw new Error('executor live-boundary window was not admitted');
    let closed = false;
    return { close: () => { if (!closed) { closed = true; void client.request('live.close', { id }).catch(() => {}); } } };
  };
  return {
    async openWindow() { return open(); },
    async runDispatch<T>(run: (openWindow: OpenAdmittedWindow) => Promise<T>): Promise<T> {
      const reservation = await open();
      // IPC cannot synchronously allocate the candidate window expected by the
      // conductor callback. The dispatch reservation stays open for the whole
      // callback instead, so every candidate and its teardown remain ordered
      // against supervisor root mutations without widening the IPC protocol.
      try { return await run(() => ({ close: () => {} })); }
      finally { reservation.close(); }
    },
  };
}

/** A lifecycle queue with the existing run(callback) signature. */
export function createWorktreeLifecycleProxy(client: ReturnType<typeof createExecutorRequestClient>): { run<T>(operation: () => Promise<T>): Promise<T> } {
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const token = await client.request('worktree.acquire', {});
      try { return await operation(); }
      finally { await client.request('worktree.release', { token }).catch(() => {}); }
    },
  };
}

/** Send child log lines over IPC; the supervisor owns the actual daemon sink. */
export function teeExecutorConsole(port: ExecutorIpcPort): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const forward = (level: string, values: unknown[]) => port.send({ kind: 'log', level, message: values.map(String).join(' ') });
  console.warn = (...values: unknown[]) => forward('warn', values);
  console.error = (...values: unknown[]) => forward('error', values);
  console.log = (...values: unknown[]) => forward('info', values);
  return () => { console.log = originalLog; console.warn = originalWarn; console.error = originalError; };
}
