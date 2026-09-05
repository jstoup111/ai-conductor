/**
 * Regression specs for the story-id derivation defect in conductor.ts.
 *
 * Same first-digit-run family as #2219 / PR #2222, which fixed
 * `story-criteria.ts` and `artifacts.ts` but missed two sites in
 * `conductor.ts`:
 *
 *   1. The prd_audit remediation-authorization block re-derived the
 *      authoritative criterion-id set from `extractAuthoritativeStoryCriteria`
 *      prose with `^Story\s+(\d+)\s+`. `## Story 5a:` never matched, so every
 *      one of its criteria vanished from the expected set and the report's
 *      legitimate `S5A.*` rows were rejected as "absent from the active
 *      stories".
 *   2. `criterionStorySection` matched criterion keys with `^S(\d+)\.(\d+)$`,
 *      so `S5a.3` failed to resolve and its PLAN_GAP fell closed to
 *      main-path/blocking instead of being recorded as a negative path.
 *
 * Both fixtures carry a stories file shaped like the one that hit this in the
 * field: a plain `Story 5`, a suffixed `Story 5a`, and a nested `Story 2.1`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, routePrdAuditPlanGaps } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

/**
 * Story 2.1 (nested id), Story 5 (plain), Story 5a (suffixed). Story 5a has
 * two happy-path criteria and one negative-path criterion, so `S5a.3` is a
 * negative path and `S5a.1` a happy one.
 */
const STORIES = [
  '# Stories',
  '',
  '## Story 2.1: Nested id',
  '',
  '#### Happy Path',
  '- Given a nested story id, when the gate derives criteria, then S2.1.1 exists.',
  '',
  '## Story 5: Plain id',
  '',
  '#### Happy Path',
  '- Given a plain story id, when the gate derives criteria, then S5.1 exists.',
  '',
  '## Story 5a: Suffixed id',
  '',
  '#### Happy Path',
  '- Given a suffixed story id, when the gate derives criteria, then S5a.1 exists.',
  '- Given a suffixed story id, when a second criterion follows, then S5a.2 exists.',
  '',
  '#### Negative Paths',
  '- Given a suffixed story id, when the path is negative, then S5a.3 is an edge case.',
  '',
].join('\n');

describe('prd_audit remediation authorization derives suffixed story ids', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'story-id-derivation-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a report keyed S5a.1 instead of rejecting it as absent from the stories', async () => {
    const planPath = join(dir, '.docs/plans/suffixed-story.md');
    await writeFile(planPath, '### Task 1: Existing work\n', 'utf8');
    await writeFile(join(dir, '.docs/stories/suffixed-story.md'), STORIES, 'utf8');
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
      'utf8',
    );
    await writeFile(
      join(dir, '.pipeline/prd-audit.md'),
      [
        '# PRD Audit',
        '',
        '**PRD:** present',
        '',
        '## Verdict Table',
        '',
        '| Criterion | Grade | Plan task | PRD: | Evidence |',
        '|---|---|---|---|---|',
        '| S5a.1 | FIXABLE | 1 | FR-1 | x |',
      ].join('\n'),
      'utf8',
    );

    const conductor = new Conductor({
      stateFilePath: join(dir, '.pipeline/conduct-state.json'),
      stepRunner: {
        run: async (step: StepName) => {
          if (step === 'remediate') {
            await writeFile(
              join(dir, '.pipeline/remediation.json'),
              JSON.stringify({
                dispositions: [
                  {
                    id: 'FR-1',
                    disposition: 'existing-task',
                    category: null,
                    rationale: 'Task 1 already owns this repair.',
                    tasks: [{ id: '1', title: 'Existing work' }],
                  },
                ],
              }),
              'utf8',
            );
          }
          return { success: true };
        },
      },
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    } as never);

    const outcome = await (
      conductor as unknown as {
        planRemediation: (
          state: unknown,
          steps: typeof ALL_STEPS,
          dispatchContext: string,
          hintSource: unknown,
        ) => Promise<{ kind: string; detail?: string; target?: string }>;
      }
    ).planRemediation(
      { feature_desc: 'suffixed-story', session_started_at: Date.now() - 1_000 },
      ALL_STEPS,
      'test suffixed story id',
      {
        source: 'prd_audit',
        evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }],
      },
    );

    expect(outcome.detail ?? '').not.toContain('absent from the active stories');
    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
  });
});

describe('criterionStorySection resolves suffixed story ids (via routePrdAuditPlanGaps)', () => {
  const planGapReport = (criterion: string): string =>
    [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      `| ${criterion} | PLAN_GAP | | An edge case is not in the approved plan. |`,
    ].join('\n');

  it('records a negative-path PLAN_GAP on S5a.3 rather than failing closed to a halt', () => {
    expect(routePrdAuditPlanGaps(planGapReport('S5a.3'), STORIES, {} as never)).toMatchObject({
      kind: 'record',
      findings: [{ gate: 'prd_audit', grade: 'PLAN_GAP', criterion: 'S5A.3' }],
    });
  });

  it('still halts a happy-path PLAN_GAP on S5a.1', () => {
    expect(routePrdAuditPlanGaps(planGapReport('S5a.1'), STORIES, {} as never)).toMatchObject({
      kind: 'halt',
      haltClass: 'plan-gap',
    });
  });

  it('still halts a happy-path PLAN_GAP on the nested id S2.1.1', () => {
    expect(routePrdAuditPlanGaps(planGapReport('S2.1.1'), STORIES, {} as never)).toMatchObject({
      kind: 'halt',
      haltClass: 'plan-gap',
    });
  });
});
