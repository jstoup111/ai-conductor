import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRemediationPlanResult } from '../../src/engine/artifacts.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EVENT_SINKS } from '../../src/engine/event-sinks.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('rejected remediation dispositions', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-rejection-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/plans/feature.md'), '# Implementation plan\n');
    await writeFile(
      join(projectRoot, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: join(projectRoot, '.docs/plans/feature.md') }),
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('retains rejected strings and malformed disposition values', async () => {
    await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
      dispositions: [
        { id: 'AB-1', disposition: 'unknown-disposition' },
        { id: 'AB-2' },
        { id: 'AB-3', disposition: 7 },
        { disposition: { a: 1 } },
        null,
      ],
    }));

    const plan = (await readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit')).plan;
    expect(plan?.gaps).toEqual([]);
    expect(plan?.rejected).toMatchObject([
      { gapId: 'AB-1', disposition: 'unknown-disposition' },
      { gapId: 'AB-2', disposition: '<missing>' },
      { gapId: 'AB-3', disposition: '7' },
      { gapId: '#4', disposition: '{"a":1}' },
    ]);
    expect(plan?.rejected.every((rejection) => rejection.accepted.includes('build'))).toBe(true);
  });

  it('emits every rejection and halts with the rejected vocabulary when no gap survives', async () => {
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('remediation_disposition_rejected', (event) => { events.push(event); });
    const outcome = await remediate(emitter, [
      { id: 'AB-1', disposition: 'unknown-disposition' },
      { id: 'AB-2', disposition: 'unknown-disposition' },
    ]);

    expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
    expect(outcome.detail).toContain('AB-1 → "unknown-disposition"');
    expect(outcome.detail).toContain('AB-2 → "unknown-disposition"');
    expect(outcome.detail).toContain('build');
    expect(outcome.detail).not.toContain('verdict is BLOCKED');
    expect(events).toMatchObject([
      { type: 'remediation_disposition_rejected', gapId: 'AB-1', disposition: 'unknown-disposition' },
      { type: 'remediation_disposition_rejected', gapId: 'AB-2', disposition: 'unknown-disposition' },
    ]);
  });

  it('routes recognized gaps and reports only the dropped gap', async () => {
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('remediation_disposition_rejected', (event) => { events.push(event); });
    const outcome = await remediate(emitter, [
      { id: 'AB-1', disposition: 'build', rationale: 'fix it', tasks: [{ id: 'rem-1', title: 'Fix it' }] },
      { id: 'AB-2', disposition: 'unknown-disposition' },
    ]);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(outcome.evidence).toContain('AB-2 → "unknown-disposition"');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ gapId: 'AB-2', disposition: 'unknown-disposition' });
    expect(await readFile(join(projectRoot, '.docs/plans/feature.md'), 'utf8')).toContain('### Task rem-1: Fix it');
  });

  it('still halts when rejection-event persistence throws', async () => {
    const expected = await remediate(new ConductorEventEmitter(), [
      { id: 'AB-1', disposition: 'unknown-disposition' },
    ]);
    const outcome = await remediate({
      emit: async () => { throw new Error('persister unavailable'); },
    } as unknown as ConductorEventEmitter, [{ id: 'AB-1', disposition: 'unknown-disposition' }]);

    expect(outcome).toMatchObject({ kind: 'halt', haltClass: 'needs-human' });
    expect(outcome.detail).toBe(expected.detail);
  });

  it('adds dropped dispositions to taskless-build and category halts', async () => {
    const taskless = await remediate(new ConductorEventEmitter(), [
      { id: 'AB-1', disposition: 'build', tasks: [] },
      { id: 'AB-2', disposition: 'unknown-disposition' },
    ], 'prd-audit');
    const category = await remediate(new ConductorEventEmitter(), [
      { id: 'AB-1', disposition: 'halt', category: 'product-scope', rationale: 'operator decision needed' },
      { id: 'AB-2', disposition: 'unknown-disposition' },
    ]);

    expect(taskless.detail).toContain('no dispatchable build work');
    expect(taskless.detail).toContain('AB-2 → "unknown-disposition"');
    expect(category.detail).toContain('product-scope: operator decision needed');
    expect(category.detail).toContain('AB-2 → "unknown-disposition"');
  });

  it('declares the rejection event on every required sink', () => {
    const event: ConductorEvent = {
      type: 'remediation_disposition_rejected', gapId: 'AB-1', disposition: 'unknown', accepted: ['build'],
    };
    expect(event.type).toBe('remediation_disposition_rejected');
    expect(EVENT_SINKS.remediation_disposition_rejected).toEqual({ render: true, persist: true, audit: true, otel: false });
  });

  async function remediate(events: ConductorEventEmitter, dispositions: unknown[], source = 'build-stall') {
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({ dispositions }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner, events,
      projectRoot, mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
    });
    return (conductor as unknown as {
      planRemediation: (
        state: ConductState, steps: typeof ALL_STEPS, context: string,
        source: { source: string; evidence: readonly [] },
      ) => Promise<{ kind: string; target?: StepName; detail: string; evidence: string; haltClass?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS, 'test remediation', { source, evidence: [] },
    );
  }
});
