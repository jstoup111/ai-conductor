import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';

// Disposition-race guard (2026-08-15 incident): an operator `build-review
// accept` landed at 20:12:19 while the /remediate planner (dispatched
// 20:10:36) was composing rework from the raw aggregate; the 20:13 kickback
// ordered removal of exactly the accepted surface. The conductor must re-read
// the disposition store and use the EFFECTIVE verdict at routing time.
describe('engine/conductor — build_review kickback disposition-race guard', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function effective(overrides: { accepted: string[]; unresolved: string[] }) {
    return {
      ok: true as const,
      feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
      effective: {
        rawVerdict: 'FAIL' as const,
        verdict: overrides.unresolved.length === 0 ? ('PASS' as const) : ('FAIL' as const),
        acceptedFindingIds: overrides.accepted,
        unresolvedFindingIds: overrides.unresolved,
        skippedRubrics: [],
        infrastructureFailureRubrics: [],
      },
    };
  }

  async function fixture(resolver: ReturnType<typeof vi.fn>) {
    dir = await mkdtemp(join(tmpdir(), 'build-review-disposition-race-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );

    const dispatched: StepName[] = [];
    let buildReviewRuns = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        if (step === 'build_review') {
          buildReviewRuns += 1;
          await writeFile(
            join(dir!, '.pipeline', 'build-review.json'),
            JSON.stringify(buildReviewRuns === 1
              ? {
                  verdict: 'FAIL',
                  reasons: ['scope: unplanned audit-trail surface'],
                  rubric: { tautology: false, scope: true, rootCause: false, completeness: false },
                }
              : {
                  verdict: 'PASS',
                  rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
                }),
          );
        }
        return { success: true };
      },
    };

    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      buildReviewEffectiveResolver: resolver,
    });

    await conductor.run();
    return { dispatched, kickbacks, buildReviewRuns: () => buildReviewRuns };
  }

  it('drops the kickback and re-lands build_review when every finding is accepted at routing time', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted-scope-finding'], unresolved: [] }));

    const { dispatched, kickbacks, buildReviewRuns } = await fixture(resolver);

    expect(resolver).toHaveBeenCalled();
    // The raw FAIL never routed rework: no build dispatch, no kickback event.
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    // build_review re-ran and settled from the disposition-aware join.
    expect(buildReviewRuns()).toBe(2);
  });

  it('keeps the kickback when unresolved findings remain despite a partial acceptance', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks } = await fixture(resolver);

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });

  it('keeps the kickback when the disposition store is unavailable (fail-open to raw routing)', async () => {
    const resolver = vi.fn(async () => ({ ok: false as const, reason: 'build-review disposition state is unavailable' }));

    const { dispatched, kickbacks } = await fixture(resolver);

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });
});
