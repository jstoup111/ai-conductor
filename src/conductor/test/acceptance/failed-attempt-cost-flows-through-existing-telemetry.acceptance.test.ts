/**
 * Validation: a failed provider attempt's usage travels exactly the same cost
 * telemetry path as a successful one, using only fields that already exist:
 *
 *   provider adapter → provider_attempt (events.jsonl) → computeCostRollup →
 *   shipped-record `## Cost` / finish usage total → OTel cost metrics.
 *
 * Totals are success + failure. A failed attempt with no attributable usage
 * stays `unmetered` (cost_complete=false), never a complete $0.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { ResultPromise } from 'execa';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider, type CodexDoctorRunner } from '../../src/execution/codex-provider.js';
import { PiProvider, type PiEnvironment } from '../../src/execution/pi-provider.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { RateCard } from '../../src/execution/rate-card.js';
import { formatFeatureUsageTotal } from '../../src/execution/provider-diagnostics.js';
import { computeCostRollup, toFeatureCostSnapshot, toFeatureUsageTotals } from '../../src/engine/cost-rollup.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { renderShippedRecordWithCost } from '../../src/engine/shipped-record.js';
import { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import type { ProviderAttemptEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const FEATURE = 'failed-cost-feature';
const CODEX_MODEL = 'gpt-5.6-terra';
const RATE_CARD: RateCard = {
  as_of: '2026-10-07T00:00:00.000Z',
  source: 'test',
  models: {
    [CODEX_MODEL]: { input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5, cache_read_input_token_cost: 2e-7 },
  },
};

const piEnvironment: PiEnvironment = {
  stat: async () => ({ isFile: () => true, isDirectory: () => false }),
  env: {},
  homeDir: () => '/home/test-agent',
  cwd: () => '/workspace',
};

const readyDoctor: CodexDoctorRunner = async () => ({
  stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
  exitCode: 0,
});

function processResult(stdout: string, exitCode: number): ResultPromise {
  return Promise.resolve({ stdout, stderr: '', exitCode, failed: exitCode !== 0 }) as unknown as ResultPromise;
}

function runtime(key: string, provider: LLMProvider): ProviderRuntime {
  const policy = resolveProviderModelPolicy(key);
  return { key, provider, policy, builtIn: true, availability: new ModelAvailability(policy.modelFallbackLadder) };
}

describe('validation: failed-attempt usage flows through the existing cost telemetry', () => {
  let worktreeDir: string;
  let events: ConductorEventEmitter;
  let persister: EventPersister;
  let exporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider;
  let listener: MetricsListener;

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), 'failed-attempt-cost-'));
    events = new ConductorEventEmitter();
    persister = new EventPersister(join(worktreeDir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    meterProvider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    listener = new MetricsListener(
      new MetricsRecorder(meterProvider.getMeter('failed-attempt-cost'), { project: 'p', worker: 'w', feature: FEATURE }),
      () => Date.now(),
      FEATURE,
    );
    listener.start(events);
  });

  afterEach(async () => {
    listener.stop();
    persister.stop();
    await meterProvider.shutdown();
    await rm(worktreeDir, { recursive: true, force: true });
  });

  async function execute(key: string, provider: LLMProvider, modelOverride?: string): Promise<ProviderAttemptEvent> {
    const attempts: ProviderAttemptEvent[] = [];
    await executeProviderCandidates({
      step: 'build',
      configuredProviders: [key],
      preferredProvider: key,
      ...(modelOverride === undefined ? {} : { modelOverride }),
      runtimes: new ProviderRuntimeSet([runtime(key, provider)]),
      sessions: new ProviderSessionScope(() => `${key}-session`),
      options: { prompt: 'Build the feature.', cwd: worktreeDir, reviewDispatch: true },
      onAttempt: async (step, attempt) => {
        const event: ProviderAttemptEvent = { type: 'provider_attempt', step, ...attempt };
        attempts.push(event);
        await events.emit(event);
      },
    });
    expect(attempts).toHaveLength(1);
    return attempts[0]!;
  }

  const workedPiStream = () => readFile(new URL('../fixtures/pi/worked-stream.jsonl', import.meta.url), 'utf8');

  const failedPi = async (stdout: string) => execute('pi', new PiProvider(
    'pi', async () => ({ stdout, stderr: '', exitCode: 1 }), piEnvironment, undefined, () => undefined,
  ));

  const claude = (stdout: string, exitCode: number) => execute('claude', new ClaudeProvider(
    undefined, (() => processResult(stdout, exitCode)) as never,
  ));

  const failedCodex = (stdout: string) => execute('codex', new CodexProvider(
    readyDoctor, 'codex', undefined, (() => processResult(stdout, 1)) as never, undefined, () => RATE_CARD,
  ), CODEX_MODEL);

  /** Emit the existing closing telemetry exactly as the conductor does after a step and at finish. */
  async function closeFeature() {
    const rollup = await computeCostRollup(worktreeDir);
    await events.emit({ ...toFeatureCostSnapshot(rollup), featureSlug: FEATURE } as never);
    await events.emit({ type: 'feature_usage_total', featureSlug: FEATURE, ...toFeatureUsageTotals(rollup) } as never);
    await meterProvider.forceFlush();
    const points = (name: string): Array<{ value: number; attributes: Record<string, unknown> }> => exporter.getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
      .filter((metric) => metric.descriptor.name === name)
      .flatMap((metric) => metric.dataPoints as Array<{ value: unknown; attributes: Record<string, unknown> }>)
      .map((point) => ({ value: point.value as number, attributes: point.attributes }));
    return { rollup, points };
  }

  it('totals success + failure spend from every provider in the rollup, shipped record, finish line and OTel cost metrics', async () => {
    const pi = await failedPi(await workedPiStream());
    const claudeFailure = await claude(JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 40, total_cost_usd: 1.25,
      usage: { input_tokens: 300, output_tokens: 40 },
    }), 1);
    const codex = await failedCodex([
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 } }),
    ].join('\n'));
    const claudeSuccess = await claude(JSON.stringify({
      type: 'result', result: 'done', total_cost_usd: 0.5, usage: { input_tokens: 50, output_tokens: 10 },
    }), 0);

    // Each failed attempt carries its usage on the existing provider_attempt event.
    expect([pi.outcome, claudeFailure.outcome, codex.outcome, claudeSuccess.outcome])
      .toEqual(['failure', 'failure', 'failure', 'success']);
    expect(pi.tokenUsage?.costUsd).toBeCloseTo(0.0035, 12);
    expect(claudeFailure.tokenUsage).toMatchObject({ input: 300, output: 40, costUsd: 1.25 });
    expect(codex.tokenUsage).toMatchObject({ input: 1000, output: 100, costSource: 'rate-card' });
    expect(codex.tokenUsage?.costUsd).toBeCloseTo(0.0032, 12);

    // The persisted ledger is what every reader rolls up.
    const persisted = (await readFile(join(worktreeDir, '.pipeline', 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; outcome?: string; tokenUsage?: unknown });
    expect(persisted.filter((event) => event.type === 'provider_attempt' && event.outcome === 'failure' && event.tokenUsage))
      .toHaveLength(3);

    const expectedTotal = 0.0035 + 1.25 + 0.0032 + 0.5;
    const { rollup, points } = await closeFeature();
    expect(rollup).toMatchObject({
      dispatches: 4,
      tokens: { input: 200 + 300 + 1000 + 50, output: 65 + 40 + 100 + 10 },
      unmetered: { count: 0 },
      costUnmetered: { count: 0 },
    });
    expect(rollup.costUsd).toBeCloseTo(expectedTotal, 10);

    const shipped = renderShippedRecordWithCost(
      { slug: FEATURE, specHash: 'abc', pr: 'https://example.test/pr/1', shipped: '2026-10-07' }, rollup,
    );
    expect(shipped).toContain(`cost_usd: ${Math.round(expectedTotal * 10000) / 10000}\n`);
    expect(formatFeatureUsageTotal(toFeatureUsageTotals(rollup)))
      .toBe('finish: total usage — 4 dispatches, $1.76, 1.6k fresh + 750 cached→215 tok');

    // OTel: existing instruments and attributes only, valued at success + failure.
    const featureCost = points('conductor.feature.cost');
    expect(featureCost.length).toBeGreaterThan(0);
    for (const point of featureCost) {
      expect(point.value).toBeCloseTo(expectedTotal, 10);
      expect(point.attributes).toMatchObject({ cost_complete: true });
    }
    const stepCost = points('conductor.feature.step.cost');
    expect(stepCost.reduce((sum, point) => sum + point.value, 0)).toBeCloseTo(expectedTotal, 10);
    const dispatches = points('conductor.step.dispatches');
    expect(dispatches.reduce((sum, point) => sum + point.value, 0)).toBe(4);
    expect(dispatches.every((point) => point.attributes.metering === 'fully-metered')).toBe(true);
  });

  it('keeps a failed attempt with no usage unmetered and cost_complete=false, never a complete $0', async () => {
    const claudeSuccess = await claude(JSON.stringify({
      type: 'result', result: 'done', total_cost_usd: 0.5, usage: { input_tokens: 50, output_tokens: 10 },
    }), 0);
    const killedEarly = (await workedPiStream()).split('\n').slice(0, 7).join('\n');
    const pi = await failedPi(killedEarly);

    expect(claudeSuccess.outcome).toBe('success');
    expect(pi).toMatchObject({ outcome: 'failure', invoked: true });
    expect(pi).not.toHaveProperty('tokenUsage');

    const { rollup, points } = await closeFeature();
    expect(rollup).toMatchObject({ dispatches: 2, costUsd: 0.5, unmetered: { count: 1 } });
    expect(formatFeatureUsageTotal(toFeatureUsageTotals(rollup))).toBe(
      'finish: total usage — 2 dispatches, $0.50 (1 cost-metered dispatch), 50→10 tok, 1 unmetered',
    );
    const featureCost = points('conductor.feature.cost');
    expect(featureCost.length).toBeGreaterThan(0);
    for (const point of featureCost) expect(point.attributes).toMatchObject({ cost_complete: false });
    expect(points('conductor.step.dispatches').map((point) => point.attributes.metering).sort())
      .toEqual(['fully-metered', 'unmetered']);
  });
});
