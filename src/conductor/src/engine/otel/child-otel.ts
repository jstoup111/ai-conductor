import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessConfig } from '../../types/config.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import type { ExecutorOtelProjectionTrace, ExecutorMessage } from '../executor-protocol.js';
import { leafBranchFor } from '../feature-branch-identity.js';
import { createSessionEventIdentity } from '../../execution/session-event-identity.js';
import { MetricsRecorder } from './metrics.js';
import { MetricsListener } from './metrics-listener.js';
import { resolveOtelConfig } from './otel-config.js';
import { createBrokeredMeter } from './brokered-meter.js';
import { createSpoolWriterRuntime } from './spool-wiring.js';
import { wireOtelVisualizer } from './wire.js';

export function buildDispatchTraceIdentity(projectRoot: string, slug: string, identity: { harnessVersion: string; sourceRef?: string }): ExecutorOtelProjectionTrace {
  const pipeline = join(projectRoot, '.worktrees', slug, '.pipeline');
  let runId = '';
  try { runId = readFileSync(join(pipeline, 'conduct-session-id'), 'utf8').trim(); } catch {}
  return { runId: runId || createSessionEventIdentity(), project: projectRoot, branch: leafBranchFor(slug), harnessVersion: identity.harnessVersion, ...(identity.sourceRef ? { sourceRef: identity.sourceRef } : {}) };
}

export function startChildOtelProjection(input: {
  config: HarnessConfig; trace: ExecutorOtelProjectionTrace; engineVersionId: string; slug: string; mainRoot: string;
  events: ConductorEventEmitter; sendMeter: (message: Extract<ExecutorMessage, { kind: 'meter' }>) => unknown;
}): { stop(): Promise<void> } {
  const pipelineDir = join(input.mainRoot, '.worktrees', input.slug, '.pipeline');
  const resolved = resolveOtelConfig(input.config, pipelineDir);
  if (!resolved.enabled) return { stop: async () => {} };
  const writer = resolved.exporter === 'otlp' && resolved.spool?.enabled ? createSpoolWriterRuntime(join(input.mainRoot, '.daemon', 'otel-spool'), resolved) : undefined;
  const visualizer = wireOtelVisualizer(input.config, {
    pipelineDir, runId: input.trace.runId, feature: input.slug, project: input.trace.project, branch: input.trace.branch,
    engineVersion: input.engineVersionId, harnessVersion: input.trace.harnessVersion, metrics: false,
    ...(input.trace.sourceRef ? { sourceRef: input.trace.sourceRef } : {}),
  }, input.events, writer);
  const listener = new MetricsListener(new MetricsRecorder(createBrokeredMeter(input.sendMeter), {
    project: input.trace.project, worker: 'child', feature: input.slug,
  }, resolved.attributes), undefined, input.slug);
  listener.start(input.events);
  let stopped: Promise<void> | undefined;
  return { stop: () => stopped ??= (async () => { listener.stop(); await visualizer?.stop(); })() };
}
