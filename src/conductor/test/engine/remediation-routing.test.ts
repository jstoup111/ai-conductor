import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('sealed-artifact remediation routing', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'sealed-remediation-routing-'));
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/plans/feature.md'), '# Implementation plan\n', 'utf8');
    await writeFile(
      join(projectRoot, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: join(projectRoot, '.docs/plans/feature.md') }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function remediate(dispositions: unknown[], source = 'prd-audit') {
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({ dispositions }),
          'utf8',
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source, evidenceFile: '.pipeline/prd-audit.md' },
    );

    return { dispatched, outcome };
  }

  it('routes another feature\'s sealed-artifact amendment to DECIDE, never BUILD', async () => {
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'story-falsified',
                disposition: 'build',
                category: null,
                rationale: 'The accepted story must be amended.',
                tasks: [
                  {
                    id: 'rem-story-1',
                    title: 'Amend .docs/stories/another-feature.md with the corrected assertion',
                    status: 'pending',
                  },
                ],
              },
            ],
          }),
          'utf8',
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
    );

    expect({ outcome, dispatched }).toMatchObject({
      outcome: {
        kind: 'halt',
        detail: expect.stringContaining("DECIDE step 'plan'"),
      },
      dispatched: ['remediate'],
    });
    expect(outcome.target).not.toBe('build');
    expect(outcome.target).not.toBe('acceptance_specs');
  });

  it.each([
    ['build', 'route', 'build'],
    ['acceptance_specs', 'route', 'acceptance_specs'],
    ['architecture_review', 'halt', undefined],
    ['plan', 'halt', undefined],
    ['halt', 'halt', undefined],
  ])('preserves the %s remediation disposition', async (disposition, kind, target) => {
    const { outcome } = await remediate([
      {
        id: `unchanged-${disposition}`,
        disposition,
        category: disposition === 'halt' ? 'product-scope' : null,
        rationale: 'Ordinary remediation remains unchanged.',
        tasks: disposition === 'halt' ? [] : [{ id: `rem-${disposition}`, title: 'Repair ordinary source code' }],
      },
    ]);

    expect(outcome).toMatchObject({ kind, ...(target ? { target } : {}) });
  });

  it('keeps appending an own-plan remediation task before routing BUILD', async () => {
    const { outcome } = await remediate([
      {
        id: 'own-plan',
        disposition: 'build',
        category: null,
        rationale: 'Amend this feature\'s accepted story.',
        tasks: [{ id: 'rem-own-plan', title: 'Amend .docs/stories/feature.md with the corrected assertion' }],
      },
    ]);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    await expect(readFile(join(projectRoot, '.docs/plans/feature.md'), 'utf8')).resolves.toContain(
      '### Task rem-own-plan: Amend .docs/stories/feature.md with the corrected assertion',
    );
  });

  it('writes no request, ledger, or record artifact while redirecting a sealed cross-feature gap', async () => {
    const { outcome } = await remediate([
      {
        id: 'sealed-cross-feature',
        disposition: 'build',
        category: null,
        rationale: 'Amend another feature\'s accepted story.',
        tasks: [{ id: 'rem-sealed', title: 'Amend .docs/stories/another-feature.md with the corrected assertion' }],
      },
    ]);

    expect(outcome.kind).toBe('halt');
    expect(outcome.target).not.toBe('build');
    expect(outcome.target).not.toBe('acceptance_specs');
    const entries = await readdir(projectRoot, { recursive: true });
    expect(entries.filter((entry) => /request|ledger|record/i.test(entry))).toEqual([]);
  });
});
