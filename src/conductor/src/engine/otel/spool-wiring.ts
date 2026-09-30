import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveMainRepoRootStrict } from '../park-marker.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { SpoolDrainer } from './spool-drainer.js';
import { SpoolLease } from './spool-lease.js';
import { SpoolStore } from './spool-store.js';

export interface SpoolRuntime {
  store: SpoolStore;
  lease: SpoolLease;
  drainer: SpoolDrainer;
}

const runtimes = new Map<string, SpoolRuntime>();
const warnedStarts = new Set<string>();
const disabledWarnings = new Map<string, Promise<void>>();

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
): SpoolRuntime {
  const store = new SpoolStore(directory, { maxBytes: config.spool?.maxBytes });
  return {
    store,
    lease: new SpoolLease(directory),
    drainer: new SpoolDrainer(store, {
      endpoint: config.endpoint,
      // Resolve references per POST. Credentials never enter the spool.
      headers: () => config.headerReferences
        ? Object.fromEntries(Object.entries(config.headerReferences).map(([name, reference]) => [name, process.env[reference.env] ?? '']))
        : config.headers ?? {},
      events,
    }),
  };
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

/** Emits the shared direct-export fallback warning when Git cannot anchor a spool. */
export function warnSpoolUnavailable(startDir: string, events?: ConductorEventEmitter): void {
  if (warnedStarts.has(startDir)) return;
  warnedStarts.add(startDir);
  void events?.emit({ type: 'renderer_error', rendererName: 'otel', error: '[otel] spool disabled: main git checkout could not be resolved; exporting directly' });
}

export function __resetSpoolRuntimeForTests(): void {
  runtimes.clear();
  warnedStarts.clear();
  disabledWarnings.clear();
}
