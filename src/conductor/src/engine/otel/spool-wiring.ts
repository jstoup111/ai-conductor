import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { ConductorEventEmitter } from '../../ui/events.js';
import { resolveMainRepoRootStrict } from '../park-marker.js';
import type { ResolvedOtelConfig } from './otel-config.js';
import { SpoolDrainer } from './spool-drainer.js';
import { SpoolLease } from './spool-lease.js';
import { SpoolStore } from './spool-store.js';
import { buildExporters, type Exporters } from './transport.js';

export interface SpoolRuntime {
  store: SpoolStore;
  lease: SpoolLease;
  drainer: SpoolDrainer;
}

const runtimes = new Map<string, SpoolRuntime>();
const warnedStarts = new Set<string>();

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

function runtimeFor(directory: string, config: Extract<ResolvedOtelConfig, { enabled: true; exporter: 'otlp' }>, events?: ConductorEventEmitter): SpoolRuntime {
  const existing = runtimes.get(directory);
  if (existing) return existing;
  const store = new SpoolStore(directory, { maxBytes: config.spool?.maxBytes });
  const runtime = {
    store,
    lease: new SpoolLease(directory),
    drainer: new SpoolDrainer(store, { endpoint: config.endpoint, headers: () => config.headers ?? {}, events }),
  };
  runtimes.set(directory, runtime);
  return runtime;
}

/** Builds direct exporters unless this OTLP process can anchor its spool in Git's main checkout. */
export async function buildSpoolExporters(
  config: Extract<ResolvedOtelConfig, { enabled: true }>,
  startDir: string,
  events?: ConductorEventEmitter,
): Promise<Exporters> {
  if (config.exporter !== 'otlp') return buildExporters(config);
  if (config.spool?.enabled === false) {
    const directory = await resolveSpoolDir(startDir);
    if (directory !== null) {
      const size = await spoolSize(directory);
      if (size > 0 && !warnedStarts.has(startDir)) {
        warnedStarts.add(startDir);
        void events?.emit({ type: 'renderer_error', rendererName: 'otel', error: `[otel] spool disabled: existing spool at ${directory} (${size} bytes) left untouched` });
      }
    }
    return buildExporters(config);
  }
  if (!config.spool?.enabled) return buildExporters(config);
  const directory = await resolveSpoolDir(startDir);
  if (directory !== null) return buildExporters(config, { spoolStore: runtimeFor(directory, config, events).store, events });
  if (!warnedStarts.has(startDir)) {
    warnedStarts.add(startDir);
    void events?.emit({ type: 'renderer_error', rendererName: 'otel', error: '[otel] spool disabled: main git checkout could not be resolved; exporting directly' });
  }
  return buildExporters(config);
}

export function __resetSpoolRuntimeForTests(): void {
  runtimes.clear();
  warnedStarts.clear();
}
