import { createHash } from 'node:crypto';
import { loadMergedConfigForRead, projectConfigPath } from '../config.js';
import { resolveMainRepoRootStrict } from '../park-marker.js';
import { resolveLogConfig, type ResolvedLogConfig } from './log-config.js';

/** The only policy used to admit or deliver a remote log batch. */
export type LogPolicy =
  | { sendable: true; root: string; config: Extract<ResolvedLogConfig, { enabled: true }>; destinationId: string }
  | { sendable: false; root?: string; reason: string };

export interface LogPolicyOptions {
  /** The delivery deadline cancels policy reads before they can authorize I/O. */
  signal?: AbortSignal;
  resolveRoot?: (startDir: string, signal?: AbortSignal) => Promise<string | null>;
  loadConfig?: (projectRoot: string, signal?: AbortSignal) => ReturnType<typeof loadMergedConfigForRead>;
  /** Kept local and bounded: a worktree may never become an authorization source. */
  warn?: (message: string) => void;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('log policy read cancelled');
}

function unavailable(root: string | undefined, reason: string): LogPolicy {
  return root === undefined ? { sendable: false, reason } : { sendable: false, root, reason };
}

function stableLogBlock(config: { otel?: unknown }): string {
  const otel = config.otel;
  if (otel === null || typeof otel !== 'object') return '';
  const logs = (otel as { logs?: unknown }).logs;
  try { return JSON.stringify(logs ?? null); } catch { return '[unreadable]'; }
}

/**
 * A non-secret identity for immutable batches.  Header *reference names*, not
 * their resolved values, intentionally participate so rotating a credential
 * does not strand a batch while changing its reference does.
 */
export function logDestinationId(config: Extract<ResolvedLogConfig, { enabled: true }>): string {
  const headers = Object.entries(config.headerReferences ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, reference]) => [name, reference.env]);
  // The durable filename is observable local metadata. Keep its matching
  // contract opaque while still binding it to the normalized endpoint and
  // header reference names (never their resolved values).
  return `sha256:${createHash('sha256').update(JSON.stringify([config.endpoint, headers])).digest('hex')}`;
}

/**
 * Read the main checkout's user-over-project configuration without migration,
 * normalization, or a configuration-file write.  Failure is deliberately
 * fail-closed for logs only; callers' ordinary local configuration remains
 * usable.
 */
export async function readLogPolicy(startDir: string, options: LogPolicyOptions = {}): Promise<LogPolicy> {
  throwIfCancelled(options.signal);
  const resolveRoot = options.resolveRoot ?? ((directory: string) => resolveMainRepoRootStrict(directory));
  let root: string | null;
  try {
    root = await resolveRoot(startDir, options.signal);
  } catch {
    throwIfCancelled(options.signal);
    return unavailable(undefined, 'log policy unavailable: canonical project root could not be resolved');
  }
  throwIfCancelled(options.signal);
  if (root === null) return unavailable(undefined, 'log policy unavailable: canonical project root could not be resolved');
  const loadConfig = options.loadConfig ?? ((directory: string) => loadMergedConfigForRead(directory));
  let loaded: Awaited<ReturnType<typeof loadMergedConfigForRead>>;
  try {
    loaded = await loadConfig(root, options.signal);
  } catch {
    throwIfCancelled(options.signal);
    return unavailable(root, 'log policy unavailable: canonical configuration could not be read');
  }
  throwIfCancelled(options.signal);
  if (!loaded.ok) return unavailable(root, 'log policy unavailable: canonical configuration could not be read');
  let resolved: ResolvedLogConfig;
  try {
    resolved = resolveLogConfig(loaded.config);
  } catch {
    return unavailable(root, 'log policy unavailable: canonical configuration is invalid');
  }
  if (!resolved.enabled) {
    return { sendable: false, root, reason: resolved.error ?? 'log export is disabled' };
  }
  // A linked checkout may carry a tempting local override.  It is observed
  // solely to explain why it is ignored; authorization remains the canonical
  // main-root result above and this read performs no migration or write.
  if (root !== startDir) {
    try {
      const local = await loadConfig(startDir, options.signal);
      throwIfCancelled(options.signal);
      if (local.ok && stableLogBlock(local.config) !== stableLogBlock(loaded.config)) {
        options.warn?.(`log settings in this worktree are ignored; using canonical project policy at ${projectConfigPath(root)}`);
      }
    } catch {
      // The canonical policy has already been read successfully.  An optional
      // local comparison must never turn into a second authorization source.
    }
  }
  return { sendable: true, root, config: resolved, destinationId: logDestinationId(resolved) };
}

/** Recheck policy at the point of I/O; retained data never grants consent. */
export async function authorizeLogDestination(
  startDir: string,
  destinationId: string,
  options?: LogPolicyOptions,
): Promise<Extract<LogPolicy, { sendable: true }> | undefined> {
  const policy = await readLogPolicy(startDir, options);
  return policy.sendable && policy.destinationId === destinationId ? policy : undefined;
}
