// Covers: task:16, task:8
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startDaemonEventPersistence,
  startFeatureEventPersistence,
} from '../../src/engine/event-persister.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { renderReport } from '../../src/engine/report-renderer.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../test-conductor.js';
import type { ConductorEvent, ConductState } from '../../src/types/index.js';
import type { LiveRegion } from '../../src/ui/live-region.js';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { CapturingSpanExporter } from '../fixtures/capturing-span-exporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', '..', 'src');

/**
 * Task 8: EventPersister MUST be wired only in index.ts — zero references in
 * conductor.ts or step-runners.ts.
 */
describe('EventPersister wiring constraints', () => {
  it('conductor.ts has zero EventPersister references', () => {
    const conductorSrc = readFileSync(join(srcRoot, 'engine', 'conductor.ts'), 'utf-8');
    expect(conductorSrc).not.toContain('EventPersister');
  });

  it('step-runners.ts has zero EventPersister references', () => {
    const stepRunnersSrc = readFileSync(join(srcRoot, 'engine', 'step-runners.ts'), 'utf-8');
    expect(stepRunnersSrc).not.toContain('EventPersister');
  });

  it('index.ts imports EventPersister', () => {
    const indexSrc = readFileSync(join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).toContain('EventPersister');
  });

  it('forwards interleaved configured-member contexts to one daemon projection and renders them without duplicating the feature ledger', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? process.env.TEMP ?? '/tmp', 'task-16-forwarding-'));
    const daemonEvents = new ConductorEventEmitter();
    const daemonPersistence = startDaemonEventPersistence(root, daemonEvents);
    const alpha = startFeatureEventPersistence(join(root, 'alpha'), daemonEvents, 'alpha');
    const beta = startFeatureEventPersistence(join(root, 'beta'), daemonEvents, 'beta');
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const meterProvider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 })],
    });
    const metrics = new MetricsListener(
      new MetricsRecorder(meterProvider.getMeter('task-16-forwarding'), { project: 'project', worker: 'worker' }),
      () => 1_000,
    );
    const spanExporter = new CapturingSpanExporter();
    const visualizer = new OtelVisualizer(
      resolveOtelConfig({ otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } }, join(root, '.pipeline')),
      { spanExporter, exportTimeoutMillis: 50 },
    );
    metrics.start(daemonEvents);
    visualizer.start(daemonEvents, { runId: 'daemon-run', feature: 'daemon', project: root });
    const runFeature = async (feature: 'alpha' | 'beta', scope: typeof alpha) => {
      const featureRoot = join(root, feature);
      const stateFilePath = join(featureRoot, 'conduct-state.json');
      await writeState(stateFilePath, {
        ...Object.fromEntries(ALL_STEPS.filter(({ name }) => name !== 'explore').map(({ name }) => [name, 'done'])),
      } as ConductState);
      let context: Extract<ConductorEvent, { type: 'step_started' }>['executionContext'];
      const conductor = new Conductor({
        projectRoot: featureRoot,
        stateFilePath,
        events: scope.events,
        mode: 'auto',
        verifyArtifacts: false,
        config: {
          steps: {
            explore: {
              max_retries: 1,
              parallel: [{ name: 'audit', skill: 'skills/audit/SKILL.md' }],
            },
          },
        },
        stepRunner: {
          run: async (step, _state, options) => {
            context = options?.executionContext;
            await scope.events.emit({
              type: 'provider_attempt', step, executionContext: context,
              provider: 'claude', model: 'gpt-5.6-luna', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
            });
            return { success: true };
          },
        },
      });
      await conductor.run();
      return context!;
    };

    try {
      // A failing OTel projection is best-effort: it must not alter forwarding
      // or the one-feature-ledger policy.
      daemonEvents.on('step_completed', () => { throw new Error('fake exporter failed'); });

      const [alphaContext, betaContext] = await Promise.all([
        runFeature('alpha', alpha),
        runFeature('beta', beta),
      ]);

      expect(alphaContext).toMatchObject({ subject: { kind: 'configured-member', parentGroup: 'explore', member: 'audit' } });
      expect(betaContext).toMatchObject({ subject: { kind: 'configured-member', parentGroup: 'explore', member: 'audit' } });
      expect(alphaContext.executionId).not.toBe(betaContext.executionId);
      await meterProvider.forceFlush();
      await visualizer.stop();
      const durationPoints = metricExporter.getMetrics().flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.step.duration')
        .flatMap((metric) => metric.dataPoints);
      expect(durationPoints.filter((point) => point.attributes.feature === 'alpha' && point.attributes.step === 'configured:explore/audit')).toHaveLength(1);
      expect(durationPoints.filter((point) => point.attributes.feature === 'beta' && point.attributes.step === 'configured:explore/audit')).toHaveLength(1);
      expect(spanExporter.getFinishedSpans().filter((span) => span.name === 'configured:explore/audit')).toHaveLength(2);

      const [alphaLedger, betaLedger] = await Promise.all([
        readFile(join(root, 'alpha', '.pipeline', 'events.jsonl'), 'utf8'),
        readFile(join(root, 'beta', '.pipeline', 'events.jsonl'), 'utf8'),
      ]);
      expect(alphaLedger).toContain(alphaContext.executionId);
      expect(betaLedger).toContain(betaContext.executionId);
      expect(alphaLedger.split('\n').filter((line) => line.includes('"type":"step_completed"'))).toHaveLength(1);
      expect(betaLedger.split('\n').filter((line) => line.includes('"type":"step_completed"'))).toHaveLength(1);
      await expect(readFile(join(root, '.daemon', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      const rendered: string[] = [];
      renderDaemonEvent({
        type: 'step_completed', step: 'explore', status: 'done', executionContext: alphaContext,
      }, (line) => rendered.push(line));
      expect(rendered.join('\n')).toContain('configured:explore/audit ✓ done');

      const terminalLines: string[] = [];
      const renderer = new TerminalRenderer({
        stateFilePath: join(root, 'state.json'),
        steps: ALL_STEPS,
        readStateFn: async () => ({ ok: true, value: {} as ConductState }),
        liveRegion: {
          update: () => {}, clear: () => {}, suspend: () => {}, resume: () => {},
          stop: () => {},
          log: (line: string) => terminalLines.push(line),
        } as LiveRegion,
      });
      await renderer.handle({ type: 'step_started', step: 'explore', index: 0, executionContext: alphaContext });
      await renderer.handle({
        type: 'step_completed', step: 'explore', status: 'done', executionContext: alphaContext,
      });
      expect(terminalLines.join('\n')).toContain('configured:explore/audit');

      const report = renderReport(join(root, 'alpha', '.pipeline', 'events.jsonl'));
      expect(report).toMatch(/configured:explore\/audit\s+\d+/);
    } finally {
      metrics.stop();
      await visualizer.stop();
      await meterProvider.shutdown();
      alpha.stop();
      beta.stop();
      daemonPersistence.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
