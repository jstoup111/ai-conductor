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

const AS_BUILT_MIXED_DESIGN = [
  '# As-Built Architecture Review',
  '',
  'Verdict: BLOCKED',
  '',
  '## Blocking Findings',
  '',
  '| Finding | Class | Governing clause | Summary |',
  '|---|---|---|---|',
  '| AB-D | DESIGN | Open question: durable state shape | Needs a human architectural decision. |',
  '| AB-1 | REMEDIABLE | 1 | The approved task is not wired into the live gate. |',
  '',
  '## Blocking Violations',
  '',
  '- AB-D needs a decision; AB-1 is code conformance.',
  '',
].join('\n');

const PRD_AUDIT_FIXABLE = [
  '# PRD Audit',
  '',
  '**PRD:** none',
  '',
  '## Verdict Table',
  '',
  '| Criterion | Grade | Plan task | Evidence |',
  '|---|---|---|---|',
  '| S3.1 | FIXABLE | 1 | src/feature.ts:1 — the criterion is not satisfied |',
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
      '### Task 2: retain approved behavior',
      '',
      '### Task 3: verify approved behavior',
      '',
      '### Task 4: document approved behavior',
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
      governingClause: plan.includes('**Governing clause:** 1'),
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

/**
 * AB-R7 / APPROVED decision 4, serial side. A no-op escalation is a
 * termination-bound exit for this gate, so BOTH exits write the existing
 * `kickback-cap` class and list every finding with its class and governing
 * clause. The group side is covered in the parallel-validation fan-out
 * acceptance; this pins the serial SHIP walk.
 *
 * Reaching the serial branch takes auto mode (the branch is nested under
 * `if (this.mode === 'auto')`) AND a group that declines to fan out. The
 * width-1 degrade does exactly that: with manual_test skipped and prd_audit
 * already done, `architecture_review_as_built` is the only dispatchable
 * member, so the join is skipped and the walk dispatches it serially.
 */
describe('acceptance: a serial as-built kickback-to-build no-op is a capped terminal', () => {
  it('halts kickback-cap and lists every blocking finding', async () => {
    const { root, statePath } = await seedFixture();

    // Width-1 degrade: only the as-built member is left to dispatch.
    const seeded = await readState(statePath);
    const state = (seeded.ok ? seeded.value : {}) as Record<string, unknown>;
    state.manual_test = 'skipped';
    state.prd_audit = 'done';
    state.architecture_review_as_built = 'pending';
    await writeState(statePath, state as ConductState);
    await writeFile(join(root, '.pipeline', 'prd-audit.md'), PRD_AUDIT_PASS);

    // The single-use no-op baseline this gate consumes: a prior lap already
    // routed BUILD, and neither the tree nor the resolved tasks have moved.
    await writeFile(
      join(root, '.pipeline', 'kickback-ledger.json'),
      JSON.stringify({
        version: 1,
        gates: {
          architecture_review_as_built: {
            count: 1,
            treeHash: null,
            lastReason: 'prior as-built kickback',
            priorVerdict: false,
            resolvedBefore: 1,
          },
        },
      }),
    );

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'architecture_review_as_built') {
          await writeFile(
            join(root, '.pipeline', 'architecture-review-as-built.md'),
            AS_BUILT_REMEDIABLE,
          );
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
      fromStep: 'architecture_review_as_built',
      verifyArtifacts: true,
      maxRetries: 1,
      escalateBuildFailure: async () => ({}),
      git: async () => ({ stdout: '' }),
    });
    await conductor.run();

    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8');
    expect(halt).toContain('as-built architecture review kickback-to-build no-op');
    expect(haltClass.trim()).toBe('kickback-cap');
    expect(halt).toContain('Blocking findings:');
    expect(halt).toContain('AB-1 (REMEDIABLE; 1): The approved task is not wired into the live gate.');
  });
});

/**
 * AB-R11 / APPROVED decision 3: one DESIGN row makes the WHOLE report halt
 * needs-human. Terminal as-built evidence therefore carries no remediation
 * authority, and no as-built plan work may be appended before that halt — even
 * when a REMEDIABLE sibling sits in the same table and PRD-owned work is also
 * being remediated in the same group.
 */
describe('acceptance: a mixed DESIGN as-built report appends no as-built work', () => {
  it('halts without appending a rem-as-built task for the REMEDIABLE sibling', async () => {
    const { root, statePath } = await seedFixture();
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'manual_test') {
          await writeFile(join(root, '.pipeline', 'manual-test-results.md'), MANUAL_TEST_PASS);
        } else if (step === 'prd_audit') {
          await writeFile(join(root, '.pipeline', 'prd-audit.md'), PRD_AUDIT_FIXABLE);
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(root, '.pipeline', 'architecture-review-as-built.md'),
            AS_BUILT_MIXED_DESIGN,
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(root, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'S3.1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Satisfy the criterion.',
                  tasks: [{ id: 'prd-fix', title: 'Satisfy S3.1' }],
                },
                {
                  id: 'AB-1',
                  disposition: 'build',
                  category: null,
                  rationale: 'Implement the behavior already required by Task 1.',
                  tasks: [{ id: 'wire-live-gate', title: 'Wire the approved behavior' }],
                },
              ],
            }),
          );
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
    // The DESIGN row withholds as-built remediation authority entirely, so no
    // as-built gap is admitted and no rem-as-built task is appended...
    expect(plan).not.toContain('rem-as-built-');
    // ...while PRD-owned work, which has its own evidence and authority, still
    // proceeds. Before this fix the terminal as-built evidence poisoned the
    // whole mixed admission and NEITHER gate's work was appended.
    expect(plan).toContain('rem-prd-audit-');
    // The whole report still halts needs-human for the DESIGN row.
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8').catch(() => '');
    expect(haltClass.trim()).toBe('needs-human');
  });
});
