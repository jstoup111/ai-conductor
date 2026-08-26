/**
 * Covers: S3.2, task:14
 *
 * Acceptance RED for the daemon's cross-dispatch as-built remediation flow.
 * The real Conductor join, artifact gates, remediation appender, state
 * navigation, and local filesystem are exercised. StepRunner is the faithful
 * fake at the LLM/process boundary. The fixture stops at the first BUILD
 * dispatch, after the externally observable route and plan append exist.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Conductor,
  type StepRunner,
  type StepRunResult,
} from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
const SLUG = 'as-built-remediable-acceptance';

const MANUAL_TEST_PASS = [
  '# Manual Test',
  '',
  '| Story | Result |',
  '|---|---|',
  '| S3 | PASS |',
  '',
].join('\n');

const PRD_AUDIT_PASS = [
  '# PRD Audit',
  '',
  '**PRD:** none',
  '',
  '## Verdict Table',
  '',
  '| Criterion | Grade | Plan task | Evidence |',
  '|---|---|---|---|',
  '| S3.1 | PASS | 1 | src/feature.ts:1 |',
  '',
].join('\n');

const AS_BUILT_REMEDIABLE = [
  '# As-Built Architecture Review',
  '',
  'Verdict: BLOCKED',
  '',
  '## Blocking Findings',
  '',
  '| Finding | Class | Governing clause | Summary |',
  '|---|---|---|---|',
  '| AB-1 | REMEDIABLE | 1 | The approved task is not wired into the live gate. |',
  '',
  '## Blocking Violations',
  '',
  '- AB-1 is not wired into the live gate.',
  '',
  '## Resolution',
  '',
  '- Implement the already-approved Task 1 behavior.',
  '',
].join('\n');

async function seedFixture(): Promise<{ root: string; statePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-remediable-'));
  roots.push(root);
  const pipelineDir = join(root, '.pipeline');
  const statePath = join(pipelineDir, 'conduct-state.json');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(pipelineDir, { recursive: true });

  await writeFile(
    join(root, '.docs', 'plans', `${SLUG}.md`),
    [
      '# Plan',
      '',
      `**Stories:** .docs/stories/${SLUG}.md`,
      '',
      '### Task 1: wire the approved behavior',
      '',
      '**Done when:**',
      '- The live as-built gate enforces the approved behavior.',
      '',
      '**Files:** src/feature.ts',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(root, '.docs', 'stories', `${SLUG}.md`),
    [
      '**Status:** Accepted',
      '',
      '# Stories',
      '',
      '## Story 3: remediable as-built findings return to BUILD',
      '',
      '### Acceptance Criteria',
      '',
      '#### Happy Path',
      '- Given a remediable BLOCKED report, when the group joins, then one task is appended and BUILD is dispatched.',
      '',
    ].join('\n'),
  );
  await writeFile(join(root, 'src', 'feature.ts'), 'export const wired = false;\n');
  await writeFile(
    join(pipelineDir, 'engine-state.json'),
    JSON.stringify({ activePlanPath: `.docs/plans/${SLUG}.md` }),
  );
  await writeFile(
    join(pipelineDir, 'task-status.json'),
    JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
  );

  const manualTestIndex = ALL_STEPS.findIndex((step) => step.name === 'manual_test');
  const state: Record<string, unknown> = {
    feature_desc: SLUG,
    complexity_tier: 'L',
    track: 'technical',
    run_started_at: Date.now() - 5_000,
    session_started_at: Date.now() - 5_000,
  };
  for (const [index, step] of ALL_STEPS.entries()) {
    state[step.name] = index < manualTestIndex ? 'done' : 'pending';
  }
  await writeState(statePath, state as ConductState);
  return { root, statePath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('acceptance: an all-REMEDIABLE as-built verdict returns the daemon to BUILD', () => {
  it('appends one clause-bound task, restages the gate, and dispatches BUILD instead of halting needs-human', async () => {
    const { root, statePath } = await seedFixture();
    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(root, '.pipeline', 'manual-test-results.md'), MANUAL_TEST_PASS);
        } else if (step === 'prd_audit') {
          await writeFile(join(root, '.pipeline', 'prd-audit.md'), PRD_AUDIT_PASS);
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(root, '.pipeline', 'architecture-review-as-built.md'),
            AS_BUILT_REMEDIABLE,
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(root, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'AB-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Implement the behavior already required by Task 1.',
                  tasks: [{ id: 'wire-live-gate', title: 'Wire the approved behavior into the live gate' }],
                },
              ],
            }),
          );
        } else if (step === 'build') {
          await writeFile(
            join(root, '.pipeline', 'HALT'),
            'sentinel: stop after the remediable route reaches BUILD\n',
          );
          await writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human');
          return { success: false, output: 'sentinel: BUILD route observed' };
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      fromStep: 'manual_test',
      verifyArtifacts: true,
      maxRetries: 1,
      escalateBuildFailure: async () => ({}),
      git: async () => ({ stdout: '' }),
    });
    await conductor.run();

    const plan = await readFile(join(root, '.docs', 'plans', `${SLUG}.md`), 'utf8');
    const stateResult = await readState(statePath);
    const state = stateResult.ok ? stateResult.value : undefined;
    expect({
      remediateDispatches: calls.filter((step) => step === 'remediate').length,
      buildDispatched: calls.includes('build'),
      appendedTask: /### Task rem-as-built-/.test(plan),
      governingClause: plan.includes('Governing clause: 1'),
      asBuiltStatus: state?.architecture_review_as_built,
      sentinelReached: existsSync(join(root, '.pipeline', 'HALT')) &&
        (await readFile(join(root, '.pipeline', 'HALT'), 'utf8')).includes('sentinel:'),
    }).toEqual({
      remediateDispatches: 1,
      buildDispatched: true,
      appendedTask: true,
      governingClause: true,
      asBuiltStatus: 'stale',
      sentinelReached: true,
    });
  });
});
