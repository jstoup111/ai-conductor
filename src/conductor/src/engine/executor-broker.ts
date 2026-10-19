import type { ConductorEvent } from '../types/events.js';
import { ConductorEventEmitter } from '../ui/events.js';
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
  attach(slug: string, port: ExecutorIpcPort): ExecutorBrokerAttachment;
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
  const providerSnapshot = () => Object.fromEntries([...providerWindows].filter(([, until]) => until > now()));
  const broadcastState = () => { broadcast('rate-limit', rateSnapshot()); broadcast('provider', providerSnapshot()); };

  return {
    attach(slug, port) {
      ports.add(port);
      const windows = new Map<string, LiveBoundaryWindow>();
      const pendingRateLimitClears = new Map<string, AbortController>();
      let releasedLock: (() => void) | undefined;
      let lockHeld: Promise<void> | undefined;
      let closed = false;
      const featureEvents = createForwardingFeatureEventEmitter(deps.rootEvents, slug);
      const respond = (requestId: string, result: unknown) => port.send({ kind: 'response', requestId, result });
      const release = () => {
        for (const window of windows.values()) window.close();
        windows.clear();
        releasedLock?.(); releasedLock = undefined;
      };
      const request = async (requestId: string, method: string, params: unknown) => {
        try {
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
            // clear() resets the authoritative escalation state before it starts
            // waiting. Replicate that immediately while preserving its deadline.
            escalationCounter = 0;
            broadcast('rate-limit', rateSnapshot());
            try {
              await deps.rateLimitEpisode.clear(abort.signal);
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
            const window = await deps.liveBoundaryCoordinator.openWindow({ contained: false, reason: 'executor proxy' });
            // A disconnect may occur while openWindow waits behind a root
            // mutation. Never retain the late grant: its channel is gone and
            // it would otherwise block every later mutation forever.
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
            let resolveRelease!: () => void;
            const hold = new Promise<void>((resolve) => { resolveRelease = resolve; });
            let acquired!: () => void;
            const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve; });
            lockHeld = deps.worktreeLifecycle.run(async () => {
              releasedLock = resolveRelease;
              acquired();
              await hold;
            });
            await acquiredPromise;
            respond(requestId, { ok: slug }); return;
          }
          if (method === 'worktree.release') { releasedLock?.(); releasedLock = undefined; await lockHeld; respond(requestId, { ok: undefined }); return; }
          respond(requestId, { error: `unknown executor request: ${method}` });
        } catch (error) { respond(requestId, { error: error instanceof Error ? error.message : String(error) }); }
      };
      const onMessage = (raw?: unknown) => {
        const parsed = parseExecutorMessage(raw);
        if (parsed.kind === 'malformed') { deps.log?.(`[executor ${slug}] malformed message: ${parsed.reason}`); return; }
        const message = parsed.message;
        if (message.kind === 'request') void request(message.requestId, message.method, message.params);
        else if (message.kind === 'event') {
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
        release();
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
