// Covers: task:33
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function runCompatibilityLap(custom: boolean, verdictShape: 'aggregate' | 'scalar' = 'aggregate') {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-custom-routing-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, step.name === 'build_review' ? 'pending' : 'done'])) as ConductState;
  state.complexity_tier = 'M';
  await writeState(join(root, '.pipeline', 'state.json'), state);
  const aggregate = joinBuildReviewRubricOutcomes({
    lapId: parseBuildReviewLapId('lap-compatibility')!, snapshotDigest: 'sha256:snapshot',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: parseBuildReviewLapId('lap-compatibility')!,
        snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'test-insensitive', summary: 'The changed test does not observe the behavior.',
          evidenceLocations: ['test/example.test.ts:8'],
          anchor: {
            rubric: 'testQuality',
            locus: {
              path: 'test/example.test.ts', contentHash: `sha256:${'a'.repeat(64)}`,
              display: 'example behavior',
            },
          },
        }],
      },
    },
  });
  const dispatched: StepName[] = [];
  const runner: StepRunner = { run: async (step) => {
    dispatched.push(step);
    if (step === 'build_review') {
      await writeFile(join(root, '.pipeline', 'build-review.json'), JSON.stringify(verdictShape === 'aggregate' ? aggregate : {
        verdict: 'FAIL', rubric: { testQuality: true }, reasons: ['legacy scalar failure'],
      }));
      return { success: false, output: 'build review found a failure' };
    }
    return { success: true };
  } };
  const conductor = new Conductor({
    projectRoot: root, stateFilePath: join(root, '.pipeline', 'state.json'), stepRunner: runner,
    events: new ConductorEventEmitter(), fromStep: 'build_review', mode: 'auto', daemon: true,
    config: { build_review: {
      rubrics: { testQuality: { enabled: true } },
      ...(custom ? { custom_rubrics: { portable: { enabled: true, skill: 'portable-policy', question: 'Review.', source: 'project' } } } : {}),
    } },
    buildReviewEffectiveResolver: async () => ({ ok: false, reason: 'build-review feature identity is unavailable' }) as never,
  } as never);
  await conductor.run();
  return { dispatched, halt: await (async () => {
    try { return await (await import('node:fs/promises')).readFile(join(root, '.pipeline', 'HALT'), 'utf8'); } catch { return ''; }
  })() };
}

describe('custom build-review compatibility routing', () => {
  it('refuses a custom-enabled compatibility lap before raw finding routing', async () => {
    const result = await runCompatibilityLap(true);
    expect(result.halt).toContain('custom-capability error');
    expect(result.dispatched).not.toContain('remediate');
  });

  it('preserves the legacy no-custom compatibility route', async () => {
    const result = await runCompatibilityLap(false);
    expect(result.halt).not.toContain('custom-capability error');
  });

  it('refuses a custom-enabled lap whose verdict has no settled aggregate instead of raw-FAIL routing', async () => {
    const result = await runCompatibilityLap(true, 'scalar');
    expect(result.halt).toContain('custom-capability error');
    expect(result.dispatched).not.toContain('remediate');
    expect(result.dispatched).not.toContain('build');
  });

  it('keeps the historical raw route for a scalar verdict without custom policies', async () => {
    const result = await runCompatibilityLap(false, 'scalar');
    expect(result.halt).not.toContain('custom-capability error');
  });
});
