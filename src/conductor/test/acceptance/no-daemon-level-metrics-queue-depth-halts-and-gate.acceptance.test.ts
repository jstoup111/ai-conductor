// Covers: S1.1, S1.2, S1.3, S1.4, S1.6, S3.1, S3.4, S3.8, S3.9, task:8, task:12
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { runDaemon, type DaemonDeps } from '../../src/engine/daemon.js';
import { localWorkSource } from '../../src/engine/daemon-work-source.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductorEvent } from '../../src/types/events.js';

const buildExporters = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/otel/transport.js', () => ({ buildExporters }));

interface DaemonOtelScope {
  flush(): Promise<void>;
  stop(): Promise<void>;
}

type WireDaemonOtel = (
  config: HarnessConfig,
  context: {
    mainRoot: string;
    project: string;
    projectName: string;
    workerName: string;
    rootEvents: ConductorEventEmitter;
  },
) => DaemonOtelScope | null | Promise<DaemonOtelScope | null>;

interface InteractiveOtelScope {
  name: string;
  start(): void;
  stop(): Promise<void>;
}

type WireInteractiveOtelMetrics = (
  config: HarnessConfig,
  context: {
    pipelineDir: string;
    project: string;
    feature: string;
    runId: string;
    branch: string | undefined;
    engineVersion: string | undefined;
  },
  events: ConductorEventEmitter,
) => InteractiveOtelScope | null;

interface DaemonTickSnapshot {
  counts: Record<'eligible' | 'waiting' | 'blocked' | 'gated' | 'parked', number>;
  oldestAgeSeconds: Partial<Record<'eligible' | 'waiting' | 'blocked' | 'gated' | 'parked', number>>;
  slots: { busy: number; free: number };
  inFlight: string[];
  blocked: Record<'paused' | 'build_auth_missing' | 'gh_version' | 'episode_active', boolean>;
  pollDurationMs: number;
}

const config = {
  otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' },
} as HarnessConfig;

let roots: string[] = [];

function testTmpdir(): string {
  return process.env.TMPDIR ?? process.env.TEMP ?? '/tmp';
}

beforeEach(() => {
  buildExporters.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function loadDaemonWire(): Promise<WireDaemonOtel> {
  const module = await import('../../src/engine/otel/wire.js');
  const candidate = (module as unknown as { wireDaemonOtel?: WireDaemonOtel }).wireDaemonOtel;
  expect(
    candidate,
    'daemon startup must expose the daemon-lifetime OTel wiring boundary',
  ).toBeTypeOf('function');
  return candidate!;
}

async function loadInteractiveWire(): Promise<WireInteractiveOtelMetrics> {
  const module = await import('../../src/engine/otel/wire.js');
  const candidate = (module as unknown as { wireInteractiveOtelMetrics?: WireInteractiveOtelMetrics }).wireInteractiveOtelMetrics;
  expect(candidate, 'interactive startup must expose the interactive-owned metric wiring boundary').toBeTypeOf('function');
  return candidate!;
}

function emitUntyped(events: ConductorEventEmitter, event: object): Promise<void> {
  return events.emit(event as ConductorEvent);
}

interface MetricPoint {
  attributes: Record<string, unknown>;
  value: unknown;
}

function metricPoints(exporter: InMemoryMetricExporter, name: string): MetricPoint[] {
  return exporter.getMetrics().flatMap((resourceMetrics): MetricPoint[] =>
    resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
      scopeMetrics.metrics
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[]),
    ),
  );
}

function latestMetricPoints(exporter: InMemoryMetricExporter, name: string): MetricPoint[] {
  return exporter.getMetrics().slice(-1).flatMap((resourceMetrics): MetricPoint[] =>
    resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
      scopeMetrics.metrics
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[]),
    ),
  );
}

function pointValue(
  exporter: InMemoryMetricExporter,
  name: string,
  attributes: Record<string, string>,
): number | undefined {
  const point = metricPoints(exporter, name).find((candidate) =>
    Object.entries(attributes).every(([key, value]) => candidate.attributes[key] === value),
  );
  return typeof point?.value === 'number' ? point.value : undefined;
}

function metricPointsWithAttributes(
  exporter: InMemoryMetricExporter,
  name: string,
  attributes: Record<string, string>,
): MetricPoint[] {
  return metricPoints(exporter, name).filter((candidate) =>
    Object.entries(attributes).every(([key, value]) => candidate.attributes[key] === value),
  );
}

function latestMetricPointsWithAttributes(
  exporter: InMemoryMetricExporter,
  name: string,
  attributes: Record<string, string>,
): MetricPoint[] {
  return latestMetricPoints(exporter, name).filter((candidate) =>
    Object.entries(attributes).every(([key, value]) => candidate.attributes[key] === value),
  );
}

async function createDaemonMeter(
  root: string,
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
): Promise<{
  events: ConductorEventEmitter;
  exporter: InMemoryMetricExporter;
  listenerInvocations: ConductorEvent['type'][];
  scope: DaemonOtelScope;
}> {
  const exporter = metricExporter;
  buildExporters.mockReturnValueOnce({
    spanExporter: new InMemorySpanExporter(),
    metricExporter: exporter,
  });
  const events = new ConductorEventEmitter();
  const listenerInvocations: ConductorEvent['type'][] = [];
  type Handler = Parameters<ConductorEventEmitter['on']>[1];
  const wrappedHandlers = new Map<Handler, Handler>();
  const realOn = events.on.bind(events);
  const realOff = events.off.bind(events);
  vi.spyOn(events, 'on').mockImplementation((type, handler) => {
    const wrapped: Handler = (event) => {
      listenerInvocations.push(event.type);
      return handler(event);
    };
    wrappedHandlers.set(handler, wrapped);
    realOn(type, wrapped);
  });
  vi.spyOn(events, 'off').mockImplementation((type, handler) => {
    const wrapped = wrappedHandlers.get(handler) ?? handler;
    realOff(type, wrapped);
    wrappedHandlers.delete(handler);
  });
  const wireDaemonOtel = await loadDaemonWire();
  const scope = await wireDaemonOtel(config, {
    mainRoot: root,
    project: root,
    projectName: 'project-p',
    workerName: 'worker-w',
    rootEvents: events,
  });
  expect(scope, 'enabled OTel must construct the daemon-owned meter').not.toBeNull();
  return { events, exporter, listenerInvocations, scope: scope! };
}

async function emitExitedDispatch(
  root: string,
  daemonEvents: ConductorEventEmitter,
  slug: string,
  kind: 'initial' | 'rekick',
): Promise<void> {
  const worktree = join(root, '.worktrees', slug);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  const dispatch = startFeatureEventPersistence(worktree, daemonEvents);
  await emitUntyped(daemonEvents, { type: 'feature_dispatch_started', slug, kind });
  await dispatch.events.emit({ type: 'step_started', step: 'build', index: 0 });
  await dispatch.events.emit({ type: 'step_completed', step: 'build', status: 'done' });
  await dispatch.events.emit({
    type: 'step_retry',
    step: 'build',
    attempt: 1,
    maxAttempts: 3,
    reason: 'acceptance retry',
  });
  await dispatch.events.emit({ type: 'loop_halt', reason: 'acceptance halt' });
  dispatch.stop();
  await emitUntyped(daemonEvents, {
    type: 'feature_dispatch_ended',
    slug,
    outcome: 'halted',
  });
}

describe('daemon-level metrics acceptance', () => {
  it('flushes a completed dispatch without shutting down the shared daemon meter', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'daemon-metrics-flush-'));
    roots.push(root);
    const daemon = await createDaemonMeter(root);

    await emitExitedDispatch(root, daemon.events, 'feature-a', 'initial');
    await daemon.scope.flush();
    expect(pointValue(daemon.exporter, 'conductor.run.outcomes', {
      project: 'project-p', worker: 'worker-w', feature: 'feature-a', outcome: 'halted',
    })).toBe(1);

    await emitExitedDispatch(root, daemon.events, 'feature-b', 'rekick');
    await daemon.scope.flush();
    expect(pointValue(daemon.exporter, 'conductor.run.outcomes', {
      project: 'project-p', worker: 'worker-w', feature: 'feature-b', outcome: 'halted',
    })).toBe(1);
    await daemon.scope.stop();
  });

  it('contains rejecting and hanging metric lifecycle calls without losing the next dispatch', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'daemon-metrics-lifecycle-'));
    roots.push(root);
    const daemonExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    vi.spyOn(daemonExporter, 'forceFlush').mockRejectedValueOnce(new Error('flush rejected'));
    const daemon = await createDaemonMeter(root, daemonExporter);
    const daemonErrors: string[] = [];
    daemon.events.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') daemonErrors.push(event.error);
    });

    await emitExitedDispatch(root, daemon.events, 'first', 'initial');
    await expect(daemon.scope.flush()).resolves.toBeUndefined();

    await emitExitedDispatch(root, daemon.events, 'second', 'initial');
    await expect(daemon.scope.flush()).resolves.toBeUndefined();
    expect(metricPointsWithAttributes(daemonExporter, 'conductor.step.duration', {
      project: 'project-p', worker: 'worker-w', feature: 'second', step: 'build',
    })).toHaveLength(1);
    expect(daemonErrors).toEqual(['[otel] metric export failed: flush rejected']);
    await daemon.scope.stop();

    const interactiveExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    vi.spyOn(interactiveExporter, 'shutdown').mockImplementation(() => new Promise<void>(() => {}));
    buildExporters.mockReturnValueOnce({
      spanExporter: new InMemorySpanExporter(),
      metricExporter: interactiveExporter,
    });
    const interactiveEvents = new ConductorEventEmitter();
    const interactiveErrors: string[] = [];
    interactiveEvents.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') interactiveErrors.push(event.error);
    });
    const wireInteractiveOtelMetrics = await loadInteractiveWire();
    const interactive = wireInteractiveOtelMetrics(config, {
      pipelineDir: join(root, '.pipeline'), project: root, feature: 'interactive', runId: 'run-1',
      branch: 'feat/interactive', engineVersion: 'test',
    }, interactiveEvents);
    expect(interactive).not.toBeNull();
    await expect(interactive!.stop()).resolves.toBeUndefined();
    expect(interactiveErrors).toEqual(['[otel] metric export failed: metric lifecycle timed out']);
  });

  it('keeps feature counters monotonic across exited dispatches and resets only with the daemon process', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'daemon-metrics-monotonic-'));
    roots.push(root);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const firstDaemon = await createDaemonMeter(root);

    await emitExitedDispatch(root, firstDaemon.events, 'feature-s', 'initial');
    await emitExitedDispatch(root, firstDaemon.events, 'feature-s', 'rekick');
    await firstDaemon.scope.stop();

    expect(pointValue(firstDaemon.exporter, 'conductor.run.outcomes', {
      project: 'project-p', worker: 'worker-w', feature: 'feature-s', outcome: 'halted',
    })).toBe(2);
    expect(pointValue(firstDaemon.exporter, 'conductor.step.retries', {
      project: 'project-p', worker: 'worker-w', feature: 'feature-s', step: 'build',
    })).toBe(2);
    expect(buildExporters).toHaveBeenCalledTimes(1);
    expect(warnings.mock.calls.flat().join('\n')).not.toMatch(/duplicate.*instrument/i);

    const restartedDaemon = await createDaemonMeter(root);
    await emitExitedDispatch(root, restartedDaemon.events, 'feature-s', 'initial');
    await restartedDaemon.scope.stop();

    expect(pointValue(restartedDaemon.exporter, 'conductor.run.outcomes', {
      project: 'project-p', worker: 'worker-w', feature: 'feature-s', outcome: 'halted',
    })).toBe(1);
    const resources = restartedDaemon.exporter.getMetrics().map((metrics) => metrics.resource.attributes);
    expect(resources).not.toHaveLength(0);
    expect(resources.every((resource) => resource['service.instance.id'] === 'project-p/worker-w')).toBe(true);
  });

  it('exports liveness, zero-valued backlog states, and free slots from a real idle daemon tick', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'idle-daemon-metrics-'));
    roots.push(root);
    const daemon = await createDaemonMeter(root);
    const emissions: Array<Promise<void>> = [];
    const onTick = (snapshot: DaemonTickSnapshot): void => {
      emissions.push(emitUntyped(daemon.events, {
        type: 'daemon_backlog_snapshot',
        ...snapshot,
      }));
    };

    await runDaemon({
      discoverBacklog: async () => [],
      runFeature: async () => {
        throw new Error('idle acceptance fixture must not dispatch');
      },
      sleep: async () => {},
      onTick,
    } as DaemonDeps, {
      concurrency: 3,
      once: false,
      idlePollMs: 0,
      maxIdlePolls: 1,
    });
    await Promise.all(emissions);
    const snapshotInvocations = daemon.listenerInvocations
      .filter((type) => type === 'daemon_backlog_snapshot').length;
    expect(snapshotInvocations).toBeGreaterThan(0);
    await daemon.scope.stop();

    expect(pointValue(daemon.exporter, 'conductor.daemon.up', {
      project: 'project-p', worker: 'worker-w',
    })).toBe(1);
    for (const state of ['eligible', 'waiting', 'blocked', 'gated', 'parked']) {
      expect(pointValue(daemon.exporter, 'conductor.daemon.backlog', {
        project: 'project-p', worker: 'worker-w', state,
      }), `missing zero-valued backlog point for ${state}`).toBe(0);
    }
    expect(pointValue(daemon.exporter, 'conductor.daemon.slots', {
      project: 'project-p', worker: 'worker-w', state: 'busy',
    })).toBe(0);
    expect(pointValue(daemon.exporter, 'conductor.daemon.slots', {
      project: 'project-p', worker: 'worker-w', state: 'free',
    })).toBe(3);

    await emitUntyped(daemon.events, {
      type: 'daemon_backlog_snapshot',
      counts: { eligible: 0, waiting: 0, blocked: 0, gated: 0, parked: 0 },
      oldestAgeSeconds: {},
      slots: { busy: 0, free: 3 },
      inFlight: [],
      blocked: { paused: false, build_auth_missing: false, gh_version: false, episode_active: false },
      pollDurationMs: 0,
    });
    expect(daemon.listenerInvocations
      .filter((type) => type === 'daemon_backlog_snapshot')).toHaveLength(snapshotInvocations);
  });

  it('exports live slots and one in-flight point per slug from a real busy daemon tick', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'busy-daemon-metrics-'));
    roots.push(root);
    const daemon = await createDaemonMeter(root);
    const releases = new Map<string, () => void>();
    let busyTickSeen: (() => void) | undefined;
    const busyTick = new Promise<void>((resolve) => { busyTickSeen = resolve; });
    let stopAfterBusyTick = false;
    const emissions: Array<Promise<void>> = [];

    const daemonRun = runDaemon({
      discoverBacklog: async () => [{ slug: 'feature-a' }, { slug: 'feature-b' }],
      runFeature: async (item) => new Promise((resolve) => {
        releases.set(item.slug, () => resolve({ slug: item.slug, status: 'done' }));
      }),
      onTick: (snapshot) => {
        if (snapshot.slots.busy !== 2) return;
        emissions.push(emitUntyped(daemon.events, { type: 'daemon_backlog_snapshot', ...snapshot }));
        stopAfterBusyTick = true;
        busyTickSeen?.();
      },
      shouldStop: () => stopAfterBusyTick,
    }, {
      concurrency: 2,
      once: false,
      idlePollMs: 0,
    });

    await busyTick;
    await Promise.all(emissions);
    await daemon.scope.stop();

    expect(pointValue(daemon.exporter, 'conductor.daemon.slots', {
      project: 'project-p', worker: 'worker-w', state: 'busy',
    })).toBe(2);
    expect(pointValue(daemon.exporter, 'conductor.daemon.slots', {
      project: 'project-p', worker: 'worker-w', state: 'free',
    })).toBe(0);
    for (const feature of ['feature-a', 'feature-b']) {
      expect(latestMetricPointsWithAttributes(daemon.exporter, 'conductor.daemon.inflight', {
        project: 'project-p', worker: 'worker-w', feature,
      })).toHaveLength(1);
      expect(pointValue(daemon.exporter, 'conductor.daemon.inflight', {
        project: 'project-p', worker: 'worker-w', feature,
      })).toBe(1);
    }

    for (const release of releases.values()) release();
    await daemonRun;
  });

  it('records daemon stalls by reason without feature identity', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'daemon-stall-metrics-'));
    roots.push(root);
    const daemon = await createDaemonMeter(root);

    const dispatch = startFeatureEventPersistence(root, daemon.events, 'feature-s');
    await dispatch.events.emit({
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 3,
      resolvedAfter: 3,
    });
    dispatch.stop();
    await daemon.scope.stop();

    const points = latestMetricPointsWithAttributes(daemon.exporter, 'conductor.daemon.stalls', {
      project: 'project-p', worker: 'worker-w', reason: 'no_task_progress',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(1);
    expect(points[0]?.attributes).not.toHaveProperty('feature');
  });

  it('exports oldest age only for determinable members while retaining the full backlog depth', async () => {
    const root = await mkdtemp(join(testTmpdir(), 'mixed-age-daemon-metrics-'));
    roots.push(root);
    const daemon = await createDaemonMeter(root);
    const observedAt = 129_600_000;
    const firstSeenDir = join(root, '.daemon', 'first-seen');
    await mkdir(firstSeenDir, { recursive: true });
    await writeFile(join(firstSeenDir, 'oldest'), JSON.stringify({ state: 'eligible', enteredAt: 0 }));
    await writeFile(join(firstSeenDir, 'newly-seen'), JSON.stringify({
      state: 'eligible', enteredAt: observedAt - 17_000,
    }));
    await mkdir(join(firstSeenDir, 'undeterminable'));
    const source = localWorkSource({
      projectRoot: root,
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn().mockResolvedValue(undefined),
      discoverBacklog: vi.fn().mockResolvedValue({
        items: [{ slug: 'oldest' }, { slug: 'newly-seen' }, { slug: 'undeterminable' }],
        waiting: [], blocked: [], gated: [],
      }),
      now: () => observedAt,
    });
    await source.discover({ refresh: false });
    const snapshot = await source.snapshot?.([]);
    expect(snapshot).toBeDefined();
    await emitUntyped(daemon.events, {
      type: 'daemon_backlog_snapshot',
      ...snapshot!,
      slots: { busy: 0, free: 3 }, inFlight: [],
      blocked: { paused: false, build_auth_missing: false, gh_version: false, episode_active: false },
    });
    await daemon.scope.stop();

    expect(pointValue(daemon.exporter, 'conductor.daemon.backlog', {
      project: 'project-p', worker: 'worker-w', state: 'eligible',
    })).toBe(3);
    expect(pointValue(daemon.exporter, 'conductor.daemon.backlog.oldest_age', {
      project: 'project-p', worker: 'worker-w', state: 'eligible',
    })).toBe(129_600);
    expect(metricPointsWithAttributes(daemon.exporter, 'conductor.daemon.backlog.oldest_age', {
      project: 'project-p', worker: 'worker-w', state: 'gated',
    })).toHaveLength(0);
  });
});
