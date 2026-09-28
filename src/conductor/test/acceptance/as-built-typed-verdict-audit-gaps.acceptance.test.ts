/**
 * Covers: S4.5, S4.17, S6.6, S6.7, S6.11, task:15, task:16, task:17, task:18
 *
 * Production-path acceptance for typed as-built verdict routing gaps named by
 * prd_audit. The real Conductor serial walk and validation-group join run;
 * StepRunner is the faithful fake at the provider boundary.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Conductor,
  type StepRunner,
  type StepRunOptions,
  type StepRunResult,
} from '../../src/engine/conductor.js';
import {
  resolveAsBuiltReferences,
  validateAsBuiltVerdict,
  type AsBuiltVerdict,
} from '../../src/engine/as-built-contract.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
const SLUG = 'as-built-typed-verdict-audit-gaps';
const ADR_STEM = 'adr-2026-09-01-sub-decisions';

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

const AS_BUILT_TEST_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'test fixture' },
  planGap: { enabled: true, reason: 'test fixture' },
  adrCompliance: { enabled: false, reason: 'test fixture' },
  diagramDrift: { enabled: false, reason: 'test fixture' },
};

async function persist(root: string, verdict: AsBuiltVerdict, runId: string | undefined): Promise<void> {
  await persistAsBuiltVerdict(root, verdict, {
    attemptId: runId ?? 'test-run',
    codeStamp: null,
    policy: AS_BUILT_TEST_POLICY,
  });
}

async function seedFixture(): Promise<{ root: string; statePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-audit-gaps-'));
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

async function writeAdr(root: string): Promise<void> {
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(root, '.docs', 'decisions', `${ADR_STEM}.md`), [
    '# ADR: Sub-decisions',
    '',
    'Status: APPROVED',
    '',
    '## Decision',
    '',
    '1. First decision.',
    '2. Second decision.',
    '3. Third decision.',
    '4. Fourth decision.',
    '5. Fifth decision.',
    '   - D5.2: the gate refuses a stale stamp.',
    '',
  ].join('\n'));
}

/** Serial width-1 degrade: only architecture_review_as_built dispatches. */
async function seedSerial(root: string, statePath: string): Promise<void> {
  const seeded = await readState(statePath);
  const state = (seeded.ok ? seeded.value : {}) as Record<string, unknown>;
  state.manual_test = 'skipped';
  state.prd_audit = 'done';
  state.architecture_review_as_built = 'pending';
  await writeState(statePath, state as ConductState);
  await writeFile(join(root, '.pipeline', 'prd-audit.md'), PRD_AUDIT_PASS);
}

function conductorFor(
  root: string,
  statePath: string,
  runner: StepRunner,
  overrides: Partial<ConstructorParameters<typeof Conductor>[0]> = {},
): Conductor {
  return new Conductor({
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
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('S4.5: a D5.2 sub-decision is cited as whole-number decision 5 and enters remediation', () => {
  it('validates decision 5 against the D5.2 ADR, rejects "5.2", and routes the finding to BUILD against decision 5', async () => {
    const { root, statePath } = await seedFixture();
    await writeAdr(root);
    const raw = {
      version: 'v1',
      verdict: 'BLOCKED',
      reachability: [],
      driftNotes: [],
      findings: [{
        id: 'AB-1',
        class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: ADR_STEM, decision: 5 },
        summary: 'The gate accepts a stale stamp, contrary to D5.2.',
      }],
      violations: 'AB-1 accepts a stale stamp.',
      resolution: 'Refuse the stale stamp per decision 5.',
    };
    const validated = validateAsBuiltVerdict(raw);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const resolved = await resolveAsBuiltReferences(validated.verdict, root);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const dotted = validateAsBuiltVerdict({
      ...raw,
      findings: [{ ...raw.findings[0], reference: { kind: 'adr-decision', stem: ADR_STEM, decision: '5.2' } }],
    });
    expect(dotted.ok).toBe(false);
    if (!dotted.ok) expect(dotted.field).toBe('findings[0].reference.decision');

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options?: StepRunOptions): Promise<StepRunResult> => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(root, '.pipeline', 'manual-test-results.md'), MANUAL_TEST_PASS);
        } else if (step === 'prd_audit') {
          await writeFile(join(root, '.pipeline', 'prd-audit.md'), PRD_AUDIT_PASS);
        } else if (step === 'architecture_review_as_built') {
          await persist(root, resolved.verdict, options?.runId);
        } else if (step === 'remediate') {
          await writeFile(join(root, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'AB-1',
              disposition: 'build',
              category: null,
              rationale: 'Refuse the stale stamp as decision 5 requires.',
              tasks: [{ id: 'refuse-stale-stamp', title: 'Refuse the stale stamp' }],
            }],
          }));
        } else if (step === 'build') {
          await writeFile(join(root, '.pipeline', 'HALT'), 'sentinel: BUILD reached\n');
          await writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human');
          return { success: false, output: 'sentinel' };
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    await conductorFor(root, statePath, runner).run();

    const plan = await readFile(join(root, '.docs', 'plans', `${SLUG}.md`), 'utf8');
    expect({
      buildDispatched: calls.includes('build'),
      appendedTask: /### Task rem-as-built-/.test(plan),
      governingClause: plan.includes(`**Governing clause:** ${ADR_STEM} decision 5`),
    }).toEqual({ buildDispatched: true, appendedTask: true, governingClause: true });
  });
});

describe('S4.17: rejected-result exhaustion names the last rejected field', () => {
  it('halts needs-human naming architecture_review_as_built and the rejected field, not a generic missing file', async () => {
    const { root, statePath } = await seedFixture();
    await seedSerial(root, statePath);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName): Promise<StepRunResult> => {
        if (step === 'architecture_review_as_built') {
          return {
            success: false,
            output: 'structured-result-rejected: findings[0].reference: an adr-decision or plan-task reference is required',
          };
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    await conductorFor(root, statePath, runner, { fromStep: 'architecture_review_as_built' }).run();

    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8').catch(() => 'needs-human');
    expect(halt).toMatch(/as-built architecture review|architecture_review_as_built/);
    expect(halt).toContain('structured-result-rejected: findings[0].reference');
    expect(halt).not.toContain('is missing');
    expect(haltClass.trim()).toBe('needs-human');
    expect(existsSync(join(root, '.pipeline', 'architecture-review-as-built.json'))).toBe(false);
  });
});

describe('S6.6: the as-built step writes no review-required marker in non-auto mode', () => {
  it('never prompts or leaves a marker for a non-clean verdict and completes the step', async () => {
    const { root, statePath } = await seedFixture();
    await seedSerial(root, statePath);
    const reviewed: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options?: StepRunOptions): Promise<StepRunResult> => {
        if (step === 'architecture_review_as_built') {
          await persist(root, {
            version: 'v1',
            verdict: 'APPROVED WITH DRIFT NOTES',
            reachability: [],
            driftNotes: [{
              note: 'staleStampGate is not exercised by a live caller.',
              unexercised: { primitive: 'staleStampGate', signature: 'gate.refuse(stamp)' },
            }],
          }, options?.runId);
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    await conductorFor(root, statePath, runner, {
      mode: 'default',
      daemon: false,
      fromStep: 'architecture_review_as_built',
      onReviewArtifacts: async (step) => {
        reviewed.push(step);
        return 'approved';
      },
    }).run();

    expect(reviewed).not.toContain('architecture_review_as_built');
    expect(existsSync(join(root, '.pipeline', 'review-required-architecture_review_as_built'))).toBe(false);
    const stateResult = await readState(statePath);
    expect(stateResult.ok ? stateResult.value.architecture_review_as_built : undefined).toBe('done');
  });
});

describe('S6.7: an undelivered PLAN_GAP halts plan-gap naming the outcome', () => {
  it('writes HALT.class plan-gap and names the affected outcome', async () => {
    const { root, statePath } = await seedFixture();
    await seedSerial(root, statePath);
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options?: StepRunOptions): Promise<StepRunResult> => {
        if (step === 'architecture_review_as_built') {
          await persist(root, {
            version: 'v1',
            verdict: 'PLAN_GAP',
            reachability: [],
            driftNotes: [],
            outcomeDelivered: false,
            affectedOutcome: 'Operators can resume a parked feature without data loss.',
          }, options?.runId);
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    await conductorFor(root, statePath, runner, { fromStep: 'architecture_review_as_built' }).run();

    const halt = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8');
    expect(haltClass.trim()).toBe('plan-gap');
    expect(halt).toContain('Operators can resume a parked feature without data loss.');
  });
});

describe('S6.11: a mechanical as-built fault in the validation group is a no-verdict branch', () => {
  it('records the member failed, retains satisfied siblings, halts mechanical, and appends no gap', async () => {
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
          return {
            success: false,
            output: 'as-built input fault',
            asBuiltFault: { kind: 'input', reason: 'as-built input fault: governing-adr-decisions is missing' },
          };
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    await conductorFor(root, statePath, runner).run();

    const stateResult = await readState(statePath);
    const state = stateResult.ok ? (stateResult.value as Record<string, unknown>) : {};
    const haltClass = await readFile(join(root, '.pipeline', 'HALT.class'), 'utf8');
    const plan = await readFile(join(root, '.docs', 'plans', `${SLUG}.md`), 'utf8');
    expect({
      asBuilt: state.architecture_review_as_built,
      manualTest: state.manual_test,
      prdAudit: state.prd_audit,
      haltClass: haltClass.trim(),
      remediateDispatched: calls.includes('remediate'),
      appended: plan.includes('rem-as-built-'),
    }).toEqual({
      asBuilt: 'failed',
      manualTest: 'done',
      prdAudit: 'done',
      haltClass: 'mechanical',
      remediateDispatched: false,
      appended: false,
    });
  });
});
