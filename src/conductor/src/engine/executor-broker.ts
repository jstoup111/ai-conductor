import type { ConductorEvent } from '../types/events.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { EVENT_SINKS } from './event-sinks.js';
import { createForwardingFeatureEventEmitter } from './event-persister.js';
import { parseExecutorMessage } from './executor-protocol.js';
import type { ProviderAvailability } from './provider-availability.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';
import type { LiveBoundaryCoordinator, LiveBoundaryWindow } from './self-host/live-boundary-coordinator.js';
import type { WorktreeLifecycleQueue } from './worktree.js';
import type { ExecutorIpcPort } from './executor-proxies.js';

export interface ExecutorBrokerDeps {
  rateLimitEpisode: RateLimitEpisode;
  providerAvailability: ProviderAvailability;
  liveBoundaryCoordinator?: LiveBoundaryCoordinator;
  worktreeLifecycle: WorktreeLifecycleQueue;
  rootEvents: ConductorEventEmitter;
  featureLogFor: (slug: string) => (line: string) => void;
  /** Attaches supervisor-owned non-persistence feature subscribers. */
  attachFeatureEventRenderer?: (slug: string, events: ConductorEventEmitter) => () => void;
  /** Child proxy-bus visualizer; its engine identity is the WorkOrder pin. */
  attachFeatureOtelVisualizer?: (slug: string, engineVersionId: string, events: ConductorEventEmitter) => () => void;
  log?: (line: string) => void;
  now?: () => number;
}

export interface ExecutorBrokerAttachment {
  events: ConductorEventEmitter;
  close(): void;
}

/**
 * Dispatcher-side ownership bridge. IPC carries only requests and same-schema
 * spine events; feature ledger persistence remains in the executor process.
 */
export function createExecutorBroker(deps: ExecutorBrokerDeps): {
  attach(slug: string, port: ExecutorIpcPort, engineVersionId?: string): ExecutorBrokerAttachment;
  abortAll(): void;
} {
  const now = deps.now ?? (() => Date.now());
  const attachments = new Set<(reason?: string) => void>();
  const providerWindows = new Map<string, number>();
  let rateDeadline: number | undefined;
  let escalationCounter = 0;
  let nextLiveBoundaryWindowId = 0;
  const ports = new Set<ExecutorIpcPort>();
  const broadcast = (name: 'rate-limit' | 'provider', value: unknown) => {
    for (const port of ports) port.send({ kind: 'state', name, value });
  };
  const rateSnapshot = () => deps.rateLimitEpisode.snapshot?.() ?? ({ deadline: rateDeadline, escalationCounter });
  // The supervisor availability service is authoritative. The local map is
  // retained only for implementations predating snapshot(), never as a second
  // source of truth for a newly attached child.
  const providerSnapshot = () => deps.providerAvailability.snapshot?.()
    ?? Object.fromEntries([...providerWindows].filter(([, until]) => until > now()));
  const broadcastState = () => { broadcast('rate-limit', rateSnapshot()); broadcast('provider', providerSnapshot()); };
  // The supervisor can mutate either service directly; child IPC is not the
  // sole writer. Broadcast those authoritative changes to every replica.
  deps.rateLimitEpisode.subscribe?.(() => broadcast('rate-limit', rateSnapshot()));
  deps.providerAvailability.subscribe?.(() => broadcast('provider', providerSnapshot()));

  return {
    attach(slug, port, engineVersionId) {
      ports.add(port);
      const windows = new Map<string, LiveBoundaryWindow>();
      const pendingRateLimitClears = new Map<string, AbortController>();
      const pendingLiveOpens = new Set<string>();
      // A child can have one request holding the queue while another is still
      // queued behind a supervisor sweep. Track them independently: closing a
      // channel must release the holder *and* make a late queued admission a
      // no-op rather than a leaked lock.
      const heldWorktreeLocks = new Map<string, () => void>();
      const pendingWorktreeAcquires = new Map<string, { cancelled: boolean }>();
      let closed = false;
      const featureEvents = createForwardingFeatureEventEmitter(deps.rootEvents, slug);
      // The child owns the feature EventPersister. The supervisor attaches only
      // ephemeral subscribers (currently the slug-aware daemon renderer) to
      // the proxy bus before it forwards to the root spine.
      const detachFeatureEventRenderer = deps.attachFeatureEventRenderer?.(slug, featureEvents);
      const detachFeatureOtelVisualizer = engineVersionId === undefined
        ? undefined
        : deps.attachFeatureOtelVisualizer?.(slug, engineVersionId, featureEvents);
      const respond = (requestId: string, result: unknown) => port.send({ kind: 'response', requestId, result });
      const release = () => {
        for (const window of windows.values()) window.close();
        windows.clear();
        for (const releaseLock of heldWorktreeLocks.values()) releaseLock();
        heldWorktreeLocks.clear();
      };
      const request = async (requestId: string, method: string, params: unknown) => {
        try {
          if (closed) { respond(requestId, { error: 'executor broker closed' }); return; }
          if (method === 'rate-limit.enter') {
            const untilMs = (params as { untilMs?: unknown })?.untilMs;
            if (typeof untilMs === 'number') {
              deps.rateLimitEpisode.enter(untilMs);
              rateDeadline = deps.rateLimitEpisode.active() ? Math.max(rateDeadline ?? 0, untilMs) : undefined;
              broadcast('rate-limit', rateSnapshot());
            }
            respond(requestId, { ok: undefined }); return;
          }
          if (method === 'rate-limit.clear') {
            const abort = new AbortController();
            pendingRateLimitClears.set(requestId, abort);
            try {
              // clear() synchronously resets the authoritative escalation
              // state before beginning its wait. Broadcast only after that
              // reset, never from a speculative local counter.
              const cleared = deps.rateLimitEpisode.clear(abort.signal);
              escalationCounter = 0;
              broadcast('rate-limit', rateSnapshot());
              await cleared;
              if (closed) return;
              if (!deps.rateLimitEpisode.active()) rateDeadline = undefined;
              broadcast('rate-limit', rateSnapshot());
              respond(requestId, { ok: undefined }); return;
            } finally {
              pendingRateLimitClears.delete(requestId);
            }
          }
          if (method === 'rate-limit.next-wait') {
            const baseSeconds = (params as { baseSeconds?: unknown })?.baseSeconds;
            const waitSeconds = deps.rateLimitEpisode.nextWaitSeconds(typeof baseSeconds === 'number' ? baseSeconds : undefined);
            escalationCounter += 1;
            broadcast('rate-limit', rateSnapshot());
            respond(requestId, { ok: waitSeconds }); return;
          }
          if (method === 'provider.suppress') {
            const { provider, untilMs } = (params ?? {}) as { provider?: unknown; untilMs?: unknown };
            if (typeof provider === 'string' && typeof untilMs === 'number') {
              deps.providerAvailability.suppress(provider, untilMs);
              providerWindows.set(provider, Math.max(providerWindows.get(provider) ?? 0, untilMs));
              broadcast('provider', providerSnapshot());
            }
            respond(requestId, { ok: undefined }); return;
          }
          if (method === 'live.open') {
            if (!deps.liveBoundaryCoordinator) { respond(requestId, { ok: undefined }); return; }
            pendingLiveOpens.add(requestId);
            const window = await deps.liveBoundaryCoordinator.openWindow({ contained: false, reason: 'executor proxy' });
            // A disconnect may occur while openWindow waits behind a root
            // mutation. Never retain the late grant: its channel is gone and
            // it would otherwise block every later mutation forever.
            pendingLiveOpens.delete(requestId);
            if (closed) { window.close(); return; }
            const id = `${slug}-${++nextLiveBoundaryWindowId}`;
            windows.set(id, window); respond(requestId, { ok: id }); return;
          }
          if (method === 'live.close') {
            const id = (params as { id?: unknown })?.id;
            if (typeof id === 'string') { windows.get(id)?.close(); windows.delete(id); }
            respond(requestId, { ok: undefined }); return;
          }
          if (method === 'worktree.acquire') {
            const pending = { cancelled: false };
            const token = `${slug}:${requestId}`;
            pendingWorktreeAcquires.set(requestId, pending);
            let resolveRelease!: () => void;
            const hold = new Promise<void>((resolve) => { resolveRelease = resolve; });
            let acquired!: () => void;
            const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve; });
            void deps.worktreeLifecycle.run(async () => {
              if (closed || pending.cancelled) { acquired(); return; }
              heldWorktreeLocks.set(token, resolveRelease);
              acquired();
              await hold;
              heldWorktreeLocks.delete(token);
            });
            await acquiredPromise;
            if (closed || pending.cancelled) return;
            pendingWorktreeAcquires.delete(requestId);
            respond(requestId, { ok: token }); return;
          }
          if (method === 'worktree.release') {
            const token = (params as { token?: unknown })?.token;
            if (typeof token === 'string') {
              const releaseLock = heldWorktreeLocks.get(token);
              releaseLock?.();
              heldWorktreeLocks.delete(token);
            }
            respond(requestId, { ok: undefined }); return;
          }
          respond(requestId, { error: `unknown executor request: ${method}` });
        } catch (error) { respond(requestId, { error: error instanceof Error ? error.message : String(error) }); }
      };
      const onMessage = (raw?: unknown) => {
        const parsed = parseExecutorMessage(raw);
        if (parsed.kind === 'malformed') { deps.log?.(`[executor ${slug}] malformed message: ${parsed.reason}`); return; }
        const message = parsed.message;
        if (closed) {
          if (message.kind === 'request') void request(message.requestId, message.method, message.params);
          return;
        }
        if (message.kind === 'hello') {
          // attach happens before the forked process has registered its proxy
          // listeners. The accepted hello is the admission point at which a
          // snapshot can be observed synchronously by that composition.
          broadcastState();
        } else if (message.kind === 'request') void request(message.requestId, message.method, message.params);
        else if (message.kind === 'event') {
          // Dispatch lifecycle is supervisor-owned once per claim. Never let
          // a child replay or duplicate these root events during a relaunch.
          if (message.payload.type === 'feature_dispatch_started' || message.payload.type === 'feature_dispatch_ended') return;
          if (!(message.payload.type in EVENT_SINKS)) return; // preserve unknowns in child ledger only
          void (message.scope === 'feature' ? featureEvents : deps.rootEvents).emit(message.payload as ConductorEvent);
        } else if (message.kind === 'log') deps.featureLogFor(slug)(`[executor:${message.level}] ${message.message}`);
      };
      const close = (reason = 'executor broker aborted') => {
        if (closed) return;
        closed = true;
        for (const [requestId, abort] of pendingRateLimitClears) {
          // A broker shutdown is observable by the child even when the IPC port
          // itself remains open long enough for its stop protocol.
          respond(requestId, { error: reason });
          abort.abort();
        }
        pendingRateLimitClears.clear();
        for (const requestId of pendingLiveOpens) respond(requestId, { error: reason });
        pendingLiveOpens.clear();
        for (const [requestId, pending] of pendingWorktreeAcquires) {
          pending.cancelled = true;
          respond(requestId, { error: reason });
        }
        pendingWorktreeAcquires.clear();
        release();
        detachFeatureEventRenderer?.();
        detachFeatureOtelVisualizer?.();
        ports.delete(port);
        attachments.delete(close);
      };
      port.on('message', onMessage);
      port.on('disconnect', () => close('executor supervisor channel disconnected'));
      attachments.add(close);
      broadcastState();
      return { events: featureEvents, close };
    },
    abortAll() { for (const close of [...attachments]) close('executor broker aborted'); },
  };
}
