// Covers: task:22
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
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

  it('emits one spine event per rejected vocabulary entry without admitting its plan', async () => {
    const rejected = [
      {
        gapId: 'AB-unknown-disposition',
        disposition: 'unknown-disposition',
        accepted: ['build', 'plan'],
        field: 'disposition',
      },
      {
        gapId: 'AB-unknown-category',
        disposition: 'unknown-category',
        accepted: ['architectural-clarity', 'product-scope', 'unanswerable'],
        field: 'category',
      },
    ] as const;
    const { outcome, events, gateBlocked, calls } = await remediate(rejected);

    expect(calls).toBe(1);
    expect(outcome).toMatchObject({ kind: 'none' });
    expect(events).toEqual(rejected.map((rejection) => ({
      type: 'remediation_disposition_rejected',
      ...rejection,
    })));
    expect(gateBlocked).toEqual([]);
    expect(await readFile(join(projectRoot, '.docs/plans/feature.md'), 'utf8')).toBe('# Implementation plan\n');
  });

  it('emits every rejection again for each rejected retry without routing or halting from plan contents', async () => {
    const rejected = [{
      gapId: 'AB-unknown-disposition',
      disposition: 'unknown-disposition',
      accepted: ['build', 'plan'],
      field: 'disposition',
    }] as const;
    const { outcome, events, gateBlocked, calls } = await remediate(rejected, 2);

    expect(calls).toBe(2);
    expect(outcome).toMatchObject({ kind: 'none' });
    expect(events).toEqual([
      { type: 'remediation_disposition_rejected', ...rejected[0] },
      { type: 'remediation_disposition_rejected', ...rejected[0] },
    ]);
    expect(gateBlocked).toEqual([]);
    expect(await readFile(join(projectRoot, '.docs/plans/feature.md'), 'utf8')).toBe('# Implementation plan\n');
  });

  async function remediate(
    rejected: readonly {
      gapId: string;
      disposition: string;
      accepted: readonly string[];
      field: 'disposition' | 'category';
    }[],
    maxRetries = 1,
  ) {
    const events: ConductorEvent[] = [];
    const gateBlocked: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('remediation_disposition_rejected', (event) => { events.push(event); });
    emitter.on('gate_blocked', (event) => { gateBlocked.push(event); });
    let calls = 0;
    const runner: StepRunner = {
      run: async () => {
        calls++;
        return {
          success: false,
          output: `structured-result-rejected: vocabulary mismatch; rejections: ${JSON.stringify(rejected)}`,
        };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events: emitter,
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries,
    });
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        context: string,
        source: { source: string; evidence: readonly [] },
      ) => Promise<{ kind: string; target?: StepName; detail?: string; evidence?: string; haltClass?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'test remediation',
      { source: 'build-stall', evidence: [] },
    );
    return { outcome, events, gateBlocked, calls };
  }
});
