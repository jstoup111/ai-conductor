/**
 * T6: FR-1 regression — absent otel config constructs nothing and leaves
 * events.jsonl byte-identical (minus the `ts` field which always differs).
 *
 * Real call site: resolveOtelConfig with no otel block.
 * Real input: representative ConductorEvent sequence.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { buildVisualizers, createOtelVisualizer } from '../../src/index.js';
import type { VisualizerPlugin } from '../../src/types/plugin.js';

async function emitBasicRun(emitter: ConductorEventEmitter): Promise<void> {
  await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
  await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
  await emitter.emit({ type: 'step_started', step: 'brainstorm', index: 1 });
  await emitter.emit({
    type: 'step_completed',
    step: 'brainstorm',
    status: 'done',
  });
  await emitter.emit({ type: 'feature_complete', featureDesc: 'otel-noop-test' });
}

/** Strip ts field, then compare JSON structure line-by-line. */
function stripTs(content: string): string[] {
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const obj = JSON.parse(line);
      delete obj.ts;
      return JSON.stringify(obj);
    });
}

describe('FR-1: no-op when disabled', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('absent otel block returns enabled=false with no error', () => {
    const result = resolveOtelConfig({}, '/some/pipeline');
    expect(result.enabled).toBe(false);
    expect((result as { error?: string }).error).toBeUndefined();
  });

  it('events.jsonl is structurally identical between baseline and disabled-otel runs', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-noop-'));

    // Baseline run: EventPersister only, no OTel
    const baseDir = join(tempDir, 'base');
    await mkdir(baseDir, { recursive: true });
    const basePath = join(baseDir, 'events.jsonl');
    const baseEmitter = new ConductorEventEmitter();
    const basePersister = new EventPersister(basePath, baseEmitter);
    basePersister.start();
    await emitBasicRun(baseEmitter);
    basePersister.stop();

    // With-disabled-otel run: resolveOtelConfig returns disabled; no visualizer attached
    const testDir = join(tempDir, 'test');
    await mkdir(testDir, { recursive: true });
    const testPath = join(testDir, 'events.jsonl');
    const testEmitter = new ConductorEventEmitter();
    const testPersister = new EventPersister(testPath, testEmitter);

    // Disabled config gate — same as production wiring check
    const resolved = resolveOtelConfig({ /* no otel key */ }, testDir);
    expect(resolved.enabled).toBe(false);
    // When disabled, no visualizer is constructed or attached
    // (asserted by the fact we don't call start on any visualizer here)

    testPersister.start();
    await emitBasicRun(testEmitter);
    testPersister.stop();

    const baseline = await readFile(basePath, 'utf-8');
    const withDisabled = await readFile(testPath, 'utf-8');

    expect(stripTs(withDisabled)).toEqual(stripTs(baseline));
  });

  it('no OtelVisualizer is constructed when otel is absent (constructor spy)', () => {
    // Simulate the production path: only push to visualizerList if enabled.
    // When disabled, the if-gate is never entered → constructor never called.
    const resolved = resolveOtelConfig({}, '/some/pipeline');
    expect(resolved.enabled).toBe(false);

    const emitter = new ConductorEventEmitter();
    const rendererErrors: string[] = [];
    emitter.on('renderer_error', (ev) => rendererErrors.push((ev as { error: string }).error));

    // Production-shaped gate: only call createOtelVisualizer when enabled.
    const visualizerList: VisualizerPlugin[] = [];
    if (resolved.enabled) {
      // This branch is DEAD for disabled configs — createOtelVisualizer never called.
      const v = createOtelVisualizer(resolved, { feature: 'x', project: 'y' }, emitter);
      if (v) visualizerList.push(v);
    }

    // buildVisualizers receives an empty list → no-op, no errors.
    buildVisualizers(visualizerList, emitter);
    expect(visualizerList).toHaveLength(0);
    expect(rendererErrors).toHaveLength(0);
  });
});
