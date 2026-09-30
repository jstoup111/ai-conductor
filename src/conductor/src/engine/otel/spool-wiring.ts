import { join } from 'node:path';
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
  if (config.exporter !== 'otlp' || !config.spool?.enabled) return buildExporters(config);
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
