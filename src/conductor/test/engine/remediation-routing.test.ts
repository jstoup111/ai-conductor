import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';

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
    const events = new ConductorEventEmitter();
    const redirects: unknown[] = [];
    events.on('remediation_sealed_artifact_redirect', (event) => redirects.push(event));
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events,
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

    return { dispatched, outcome, redirects };
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

  it.each(['build', 'acceptance_specs'])('redirects a rationale-only foreign artifact from %s without appending it', async (disposition) => {
    const { outcome } = await remediate([{
      id: `rationale-${disposition}`,
      disposition,
      category: null,
      rationale: 'Amend .docs/stories/another-feature.md to correct the accepted assertion.',
      tasks: [{ id: 'foreign-only', title: 'Repair source behavior' }],
    }]);
    expect(outcome).toMatchObject({ kind: 'halt' });
    await expect(readFile(join(projectRoot, '.docs/plans/feature.md'), 'utf8')).resolves.not.toContain('foreign-only');
  });

  it.each([
    ['incidental rationale context', { id: 'incidental', rationale: 'Update source; .docs/stories/another-feature.md is context only.', tasks: [{ id: 'source', title: 'src/x.ts' }] }],
    ['own-feature rationale', { id: 'own', rationale: 'Amend .docs/stories/feature.md.', tasks: [{ id: 'own-task', title: 'src/x.ts' }] }],
    ['rationale-free gap', { id: 'absent', rationale: '', tasks: [{ id: 'none', title: 'src/x.ts' }] }],
  ])('routes BUILD without redirecting a %s', async (_caseName, gap) => {
      await writeFile(join(projectRoot, '.docs/plans/feature.md'), '# Implementation plan\n', 'utf8');
      const { outcome, redirects } = await remediate([{ ...gap, disposition: 'build', category: null }]);
      expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
      expect(redirects).toEqual([]);
  });

  it('emits the foreign artifact and gap id when redirecting a sealed rationale target', async () => {
    const seen: unknown[] = [];
    const dispositions = [{
      id: 'event-gap', disposition: 'build', category: null,
      rationale: 'Amend .docs/specs/another-feature.md.', tasks: [{ id: 'source', title: 'src/x.ts' }],
    }];
    const dispatched: StepName[] = [];
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline/events.jsonl'), events);
    persister.start();
    events.on('remediation_sealed_artifact_redirect', (event) => {
      seen.push(event);
    });
    const conductor = new Conductor({ stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), projectRoot,
      stepRunner: { run: async (step) => { dispatched.push(step); await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({ dispositions })); return { success: true }; } },
      events, mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1 });
    await (conductor as unknown as {
      planRemediation: (
        state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<unknown>;
    }).planRemediation(
      { session_started_at: Date.now() - 1000, feature_desc: 'feature' }, ALL_STEPS, 'blocked', { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' });
    expect(seen).toEqual([{ type: 'remediation_sealed_artifact_redirect', gapId: 'event-gap', artifact: '.docs/specs/another-feature.md' }]);
    expect(await readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8')).toContain(
      '"type":"remediation_sealed_artifact_redirect","gapId":"event-gap","artifact":".docs/specs/another-feature.md"',
    );
    persister.stop();
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
