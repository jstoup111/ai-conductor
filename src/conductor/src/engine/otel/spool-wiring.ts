import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveMainRepoRootStrict } from '../park-marker.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { SpoolDrainer } from './spool-drainer.js';
import { SpoolLease } from './spool-lease.js';
import { SpoolStore } from './spool-store.js';
import { readLogPolicy } from './log-policy.js';

export interface SpoolRuntime {
  store: SpoolStore;
  lease: SpoolLease;
  drainer: SpoolDrainer;
}

const warnedStarts = new Set<string>();
const disabledWarnings = new Map<string, Promise<void>>();
const disabledLogWarnings = new Map<string, Promise<void>>();
const warnedLogStarts = new Set<string>();

async function spoolSize(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory);
    const sizes = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry);
      const metadata = await stat(path);
      return metadata.isDirectory() ? spoolSize(path) : metadata.size;
    }));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    return 0;
  }
}

/** Returns the durable spool under the main checkout, never a linked worktree. */
export async function resolveSpoolDir(startDir: string): Promise<string | null> {
  const mainRoot = await resolveMainRepoRootStrict(startDir);
  return mainRoot === null ? null : join(mainRoot, '.daemon', 'otel-spool');
}

/** Synchronous start-boundary counterpart for interactive visualizer setup. */
export function resolveSpoolDirSync(startDir: string): string | null {
  try {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: startDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!gitCommonDir) return null;
    const mainRoot = dirname(isAbsolute(gitCommonDir) ? gitCommonDir : resolve(startDir, gitCommonDir));
    return join(mainRoot, '.daemon', 'otel-spool');
  } catch {
    return null;
  }
}

export function createSpoolRuntime(
  directory: string,
  config: Extract<ResolvedOtelConfig, { enabled: true; exporter: 'otlp' }>,
  events?: ConductorEventEmitter,
  logMaxBytes?: number,
  /**
   * Logs are an independently opted-in signal.  A trace/metric owner must not
   * attach the retained-log loop merely because it happens to hold the shared
   * spool lease.
   */
  logDrainEnabled = false,
): SpoolRuntime {
  const store = new SpoolStore(directory, { maxBytes: config.spool?.maxBytes, logMaxBytes });
  let drainer: SpoolDrainer | undefined;
  const lease = new SpoolLease(directory, { onLost: () => { void drainer?.stop(); } });
  drainer = new SpoolDrainer(store, {
      endpoint: config.endpoint,
      // Resolve references per POST. Credentials never enter the spool.
      headers: () => config.headerReferences
        ? Object.fromEntries(Object.entries(config.headerReferences).map(([name, reference]) => [name, process.env[reference.env] ?? '']))
        : config.headers ?? {},
      ...(logDrainEnabled ? { authorizeLog: async (destinationId: string | undefined) => {
        const policy = await readLogPolicy(dirname(directory));
        if (!policy.sendable || !policy.config.spool.enabled || policy.destinationId !== destinationId) return undefined;
        return {
          endpoint: policy.config.endpoint,
          headers: policy.config.headerReferences
            ? Object.fromEntries(Object.entries(policy.config.headerReferences).map(([name, reference]) => [name, process.env[reference.env] ?? '']))
            : {},
        };
      } } : {}),
      events,
    });
  return { store, lease, drainer };
}

/** Builds direct exporters unless this OTLP process can anchor its spool in Git's main checkout. */
export async function warnDisabledSpoolBacklog(
  config: Extract<ResolvedOtelConfig, { enabled: true }>,
  startDir: string,
  events?: ConductorEventEmitter,
): Promise<void> {
  if (config.exporter !== 'otlp' || config.spool?.enabled !== false || config.spoolWarnings?.length) return;
  const existing = disabledWarnings.get(startDir);
  if (existing) return existing;
  const warning = (async () => {
    const directory = await resolveSpoolDir(startDir);
    if (directory === null) return;
    const size = await spoolSize(directory);
    if (size > 0 && !warnedStarts.has(startDir)) {
      warnedStarts.add(startDir);
      await events?.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] spool disabled: existing spool at ${directory} (${size} bytes) left untouched` });
    }
  })();
  disabledWarnings.set(startDir, warning);
  try {
    await warning;
  } finally {
    disabledWarnings.delete(startDir);
  }
}

/**
 * Retained logs carry their own consent and retention switches.  Do not purge
 * or drain a backlog when either switch is off; tell the local operator once
 * that it remains on disk.  The authorization read is canonical, so a linked
 * worktree cannot make a main-checkout backlog eligible by changing its local
 * configuration.
 */
export async function warnDisabledLogSpoolBacklog(
  logDrainEnabled: boolean,
  startDir: string,
  events?: ConductorEventEmitter,
): Promise<void> {
  const directory = await resolveSpoolDir(startDir);
  if (directory === null) return;
  const existing = disabledLogWarnings.get(directory);
  if (existing) return existing;
  const warning = (async () => {
    const logDirectory = join(directory, 'logs');
    const size = await spoolSize(logDirectory);
    if (size === 0) return;

    let disabled = !logDrainEnabled;
    if (!disabled) {
      const policy = await readLogPolicy(startDir);
      disabled = !policy.sendable || !policy.config.spool.enabled;
    }
    if (!disabled || warnedLogStarts.has(directory)) return;
    warnedLogStarts.add(directory);
    await events?.emit({
      type: 'renderer_error', rendererName: 'otel',
      error: `[otel] log spool disabled: retained logs at ${logDirectory} (${size} bytes) left untouched`,
    });
  })();
  disabledLogWarnings.set(directory, warning);
  try {
    await warning;
  } finally {
    disabledLogWarnings.delete(directory);
  }
}

/** Emits the shared direct-export fallback warning when Git cannot anchor a spool. */
export function warnSpoolUnavailable(startDir: string, events?: ConductorEventEmitter): void {
  if (warnedStarts.has(startDir)) return;
  warnedStarts.add(startDir);
  void events?.emit({ type: 'renderer_error', rendererName: 'otel', error: '[otel] spool disabled: main git checkout could not be resolved; exporting directly' });
}
