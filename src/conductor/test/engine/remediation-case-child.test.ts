// Covers: task:2, task:28
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readRemediationCaseStoreFeature,
  remediationCaseStorePath,
  RemediationCaseStore,
  type RemediationCaseStoreState,
} from '../../src/engine/remediation-case-store.js';
import { parseChildId } from '../../src/engine/child-context.js';
import {
  buildReviewWorkOrderPath,
  markBuildReviewWorkOrderAttempted,
  publishBuildReviewWorkOrder,
} from '../../src/engine/build-review-work-order.js';
import { remediationCaseJudgementPath } from '../../src/engine/remediation-case-artifact.js';
import { remediationTypedPlanPath } from '../../src/engine/remediation-plan-store.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'stacked-review' } as const;
const temporaryDirectories: string[] = [];

function state(id: string): RemediationCaseStoreState {
  return {
    version: 'v2',
    feature: FEATURE,
    cases: [
      {
        id,
        domain: 'build_review',
        disposition: 'act',
        priority: 'high',
        rationale: 'The child change needs its own regression coverage.',
        confidence: 'high',
        resolution: 'open',
        sources: [{ sourceId: `testQuality:${id}`, outcome: 'acted', recordedAt: '2026-10-09T12:00:00.000Z' }],
        effect: { id: `effect-${id}`, kind: 'action', status: 'reserved' },
      },
    ],
    prdWideningCases: [],
    suppressions: [],
  };
}

function appliedState(id: string): RemediationCaseStoreState {
  const initial = state(id);
  return {
    ...initial,
    cases: initial.cases.map((record) => ({
      ...record,
      effect: { id: `effect-${id}`, kind: 'action' as const, status: 'applied' as const, workOrderId: `order-${id}` },
    })),
  };
}

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-case-child-'));
  temporaryDirectories.push(root);
  return root;
}

function workOrder(id: string, title: string) {
  return {
    version: 'v1' as const,
    domain: 'build_review' as const,
    feature: FEATURE,
    effectId: `effect-${id}`,
    cases: [{ caseId: id, priority: 'high' as const, tasks: [{ title }] }],
  };
}

function retryContext(root: string, child?: ReturnType<typeof parseChildId>) {
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: {} as never,
    events: new ConductorEventEmitter(),
  }) as unknown as {
    activeRegionChild: typeof child;
    durableBuildReviewRetryContext(hint: string | undefined): Promise<{ kind: string; context?: string }>;
  };
  conductor.activeRegionChild = child;
  return conductor;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('child-scoped build-review remediation cases', () => {
  it('keeps cases for an earlier child intact while the active child starts an independent store', async () => {
    const root = await projectRoot();
    const child1 = parseChildId(1)!;
    const child2 = parseChildId(2)!;
    const first = new RemediationCaseStore(root, FEATURE, { child: child1 });
    const second = new RemediationCaseStore(root, FEATURE, { child: child2 });

    await expect(first.mutate(async () => ({ value: undefined, nextState: state('child-1-case') }))).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    const firstBytes = await readFile(remediationCaseStorePath(root, child1), 'utf8');

    await expect(second.read()).resolves.toEqual({
      ok: true,
      state: {
        version: 'v4',
        feature: FEATURE,
        cases: [],
        prdWideningCases: [],
        asBuiltCases: [],
        suppressions: [],
        outbox: [],
      },
    });
    await expect(second.mutate(async () => ({ value: undefined, nextState: state('child-2-case') }))).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    await expect(readFile(remediationCaseStorePath(root, child1), 'utf8')).resolves.toBe(firstBytes);
    await expect(second.read()).resolves.toEqual({
      ok: true,
      state: { ...state('child-2-case'), version: 'v4', asBuiltCases: [], outbox: [] },
    });
    await expect(readRemediationCaseStoreFeature(root, undefined, child2)).resolves.toEqual({
      ok: true,
      feature: FEATURE,
    });
  });

  it('uses the legacy flat path when there is no active child', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, FEATURE);

    await expect(store.mutate(async () => ({ value: undefined, nextState: state('flat-case') }))).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(remediationCaseStorePath(root)).toBe(join(root, '.pipeline', 'remediation-cases.json'));
    await expect(store.read()).resolves.toEqual({
      ok: true,
      state: { ...state('flat-case'), version: 'v4', asBuiltCases: [], outbox: [] },
    });
  });

  it('publishes child 4 admitted repair work under its region and sends its tasks to BUILD', async () => {
    const root = await projectRoot();
    const child = parseChildId(4)!;
    const store = new RemediationCaseStore(root, FEATURE, { child });
    await expect(
      store.mutate(async () => ({ value: undefined, nextState: appliedState('child-4-case') })),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair child 4'), undefined, child),
    ).resolves.toMatchObject({ ok: true });

    await expect(readFile(buildReviewWorkOrderPath(root, child), 'utf8')).resolves.toContain('child-4-case');
    await expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(retryContext(root, child).durableBuildReviewRetryContext(undefined)).resolves.toMatchObject({
      kind: 'ready',
      context: expect.stringContaining('Repair child 4'),
    });
  });

  it('does not send child 4 work to child 3 BUILD when child 3 has no open case', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    const child4Store = new RemediationCaseStore(root, FEATURE, { child: child4 });
    await child4Store.mutate(async () => ({ value: undefined, nextState: appliedState('child-4-case') }));
    await publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair child 4 only'), undefined, child4);

    await expect(retryContext(root, child3).durableBuildReviewRetryContext(undefined)).resolves.toEqual({
      kind: 'absent',
    });
  });

  it('sends only child 3 admitted tasks to child 3 BUILD when both child regions are open', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    await new RemediationCaseStore(root, FEATURE, { child: child3 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-3-case'),
    }));
    await new RemediationCaseStore(root, FEATURE, { child: child4 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-4-case'),
    }));
    await publishBuildReviewWorkOrder(root, workOrder('child-3-case', 'Repair child 3 only'), undefined, child3);
    await publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair child 4 only'), undefined, child4);

    const result = await retryContext(root, child3).durableBuildReviewRetryContext(undefined);
    expect(result).toMatchObject({ kind: 'ready', context: expect.stringContaining('Repair child 3 only') });
    expect(result.context).not.toContain('Repair child 4 only');
  });

  it('keeps an admitted no-children work order feature-local and sends its tasks to BUILD', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, FEATURE);
    await store.mutate(async () => ({ value: undefined, nextState: appliedState('flat-case') }));
    await publishBuildReviewWorkOrder(root, workOrder('flat-case', 'Repair flat case'));

    await expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).resolves.toContain('flat-case');
    await expect(retryContext(root).durableBuildReviewRetryContext(undefined)).resolves.toMatchObject({
      kind: 'ready',
      context: expect.stringContaining('Repair flat case'),
    });
  });

  // Covers: task:8
  it('retires only the settled child region work order and judgement before a later BUILD retry', async () => {
    const root = await projectRoot();
    const child = parseChildId(2)!;
    const store = new RemediationCaseStore(root, FEATURE, { child });
    await expect(
      store.mutate(async () => ({ value: undefined, nextState: appliedState('child-2-case') })),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      publishBuildReviewWorkOrder(
        root,
        {
          version: 'v1',
          domain: 'build_review',
          feature: FEATURE,
          effectId: 'effect-child-2-case',
          cases: [{ caseId: 'child-2-case', priority: 'high', tasks: [{ title: 'Repair child 2' }] }],
        },
        undefined,
        child,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(markBuildReviewWorkOrderAttempted(root, FEATURE, undefined, child)).resolves.toMatchObject({
      ok: true,
    });
    await writeFile(remediationCaseJudgementPath(root, child), '{"stale":"judgement"}');
    const settled = appliedState('child-2-case');
    await store.mutate(async () => ({
      value: undefined,
      nextState: { ...settled, cases: settled.cases.map((row) => ({ ...row, resolution: 'resolved' as const })) },
    }));

    await expect(retryContext(root, child).durableBuildReviewRetryContext(undefined)).resolves.toEqual({
      kind: 'absent',
    });
    await expect(readFile(buildReviewWorkOrderPath(root, child), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(remediationCaseJudgementPath(root, child), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:12
  it('adopts a legacy feature-level order only into its open child owner before BUILD', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    await new RemediationCaseStore(root, FEATURE, { child: child4 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-4-case'),
    }));
    await publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair adopted child 4'));

    await expect(retryContext(root, child3).durableBuildReviewRetryContext(undefined)).resolves.toEqual({
      kind: 'absent',
    });
    await expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(buildReviewWorkOrderPath(root, child4), 'utf8')).resolves.toContain('Repair adopted child 4');
    await expect(retryContext(root, child4).durableBuildReviewRetryContext(undefined)).resolves.toMatchObject({
      kind: 'ready',
      context: expect.stringContaining('Repair adopted child 4'),
    });
  });

  // Covers: task:13
  it('removes unowned legacy remediation inputs before a stacked child BUILD retry', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    const resolved = appliedState('resolved-child-4-case');
    await new RemediationCaseStore(root, FEATURE, { child: child4 }).mutate(async () => ({
      value: undefined,
      nextState: { ...resolved, cases: resolved.cases.map((row) => ({ ...row, resolution: 'resolved' as const })) },
    }));
    await publishBuildReviewWorkOrder(root, workOrder('resolved-child-4-case', 'Must not be delivered'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(remediationCaseJudgementPath(root), '{"legacy":true}');
    await writeFile(remediationTypedPlanPath(root), '{"legacy":true}');
    await writeFile(join(root, '.pipeline', 'build-stall-question.md'), 'legacy question');

    await expect(retryContext(root, child3).durableBuildReviewRetryContext(undefined)).resolves.toEqual({
      kind: 'absent',
    });
    await Promise.all([
      expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(remediationCaseJudgementPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(remediationTypedPlanPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(join(root, '.pipeline', 'build-stall-question.md'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      }),
    ]);
  });

  // Covers: rem-as-built-rem-asbuilt-d4-legacy-cleanup
  it('adopts and retires flat remediation inputs at BUILD dispatch when adjudication is disabled', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    await new RemediationCaseStore(root, FEATURE, { child: child4 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-4-case'),
    }));
    await publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair adopted child 4'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(remediationCaseJudgementPath(root), '{"legacy":true}');
    await writeFile(remediationTypedPlanPath(root), '{"legacy":true}');
    await writeFile(join(root, '.pipeline', 'build-stall-question.md'), 'legacy question');
    await writeState(join(root, '.pipeline', 'conduct-state.json'), {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done', complexity_tier: 'M',
    } as ConductState);

    const dispatched: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: { run: async (step) => { dispatched.push(step); return { success: true }; } },
      events: new ConductorEventEmitter(),
      config: { build_review: { adjudication: { enabled: false } } },
      fromStep: 'build',
      verifyArtifacts: false,
    });
    (conductor as unknown as { activeRegionChild: typeof child3 }).activeRegionChild = child3;

    await conductor.run();

    expect(dispatched).toContain('build');
    await expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(buildReviewWorkOrderPath(root, child4), 'utf8')).resolves.toContain('Repair adopted child 4');
    await Promise.all([
      expect(readFile(remediationCaseJudgementPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(remediationTypedPlanPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(join(root, '.pipeline', 'build-stall-question.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
    ]);
  });

  // Covers: rem-as-built-rem-asbuilt-d3-terminal-stall-retire
  it('retires only child 3 stall inputs after its terminal HALT has been written', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    await mkdir(join(root, '.pipeline', 'children', String(child3)), { recursive: true });
    await mkdir(join(root, '.pipeline', 'children', String(child4)), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', String(child3), 'build-stall-question.md'), 'child 3 question');
    await writeFile(remediationTypedPlanPath(root, child3), '{"stalled":true}');
    await writeFile(join(root, '.pipeline', 'children', String(child4), 'build-stall-question.md'), 'child 4 question');
    await writeFile(remediationTypedPlanPath(root, child4), '{"stalled":true}');

    const conductor = retryContext(root, child3) as unknown as {
      retireTerminalBuildStallInputs(): Promise<void>;
    };
    await conductor.retireTerminalBuildStallInputs();

    await Promise.all([
      expect(readFile(join(root, '.pipeline', 'children', String(child3), 'build-stall-question.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(remediationTypedPlanPath(root, child3), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' }),
      expect(readFile(join(root, '.pipeline', 'children', String(child4), 'build-stall-question.md'), 'utf8')).resolves.toBe('child 4 question'),
      expect(readFile(remediationTypedPlanPath(root, child4), 'utf8')).resolves.toBe('{"stalled":true}'),
    ]);
  });

  // Covers: task:13
  it('keeps a flat order when any child case store is unreadable', async () => {
    const root = await projectRoot();
    const child3 = parseChildId(3)!;
    const child4 = parseChildId(4)!;
    const child5 = parseChildId(5)!;
    await new RemediationCaseStore(root, FEATURE, { child: child4 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-4-case'),
    }));
    await publishBuildReviewWorkOrder(root, workOrder('child-4-case', 'Repair child 4 after recovery'));
    await new RemediationCaseStore(root, FEATURE, { child: child5 }).mutate(async () => ({
      value: undefined,
      nextState: appliedState('child-5-case'),
    }));
    await writeFile(remediationCaseStorePath(root, child5), '{malformed');

    await expect(retryContext(root, child3).durableBuildReviewRetryContext(undefined)).resolves.toEqual({
      kind: 'absent',
    });
    await expect(readFile(buildReviewWorkOrderPath(root), 'utf8')).resolves.toContain('Repair child 4 after recovery');
    await expect(readFile(buildReviewWorkOrderPath(root, child4), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
