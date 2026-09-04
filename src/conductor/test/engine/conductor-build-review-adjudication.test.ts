// Covers: task:18, task:16, task:19, task:20, task:rem-as-built-rem-ab1-4, task:rem-as-built-rem-ab2-4, task:rem-as-built-rem-ab3-1
//
// Task 18's production-wiring clauses. Three build laps closed the components
// and left the seam open: the coordinator was reachable, but the deferral
// dependencies, the durable BUILD handoff, and the covered/uncovered
// infrastructure distinction were not. Done-when 7 makes a bounded fixture
// necessary but not sufficient, so every assertion below observes the
// PRODUCTION call path — the real `Conductor` branch, the real coordinator, the
// real effects, with fakes only at the provider and `gh` boundaries.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompletionContext } from '../../src/engine/artifacts.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { chargeBuildReviewEffectInLedger } from '../../src/engine/kickback-ledger.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import * as remediationCaseReconciler from '../../src/engine/remediation-case-reconciler.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { Conductor } from '../test-conductor.js';

const LAP_ID = parseBuildReviewLapId('lap-adjudication')!;
const SNAPSHOT = 'sha256:snapshot';
const HASH = `sha256:${'b'.repeat(64)}`;

const FINDING: BuildReviewFinding = {
  concernKind: 'test-insensitive',
  summary: 'The changed assertion passes against reverted production.',
  evidenceLocations: ['test/example.test.ts:8'],
  anchor: { rubric: 'testQuality', locus: { path: 'test/example.test.ts', contentHash: HASH, display: 'example behavior' } },
};

const FINDING_ID = canonicalizeBuildReviewFindingIdentity({
  rubric: 'testQuality', contractVersion: 'v3', concernKind: FINDING.concernKind, anchor: FINDING.anchor,
})!.id;
const SOURCE_ID = `testQuality:${FINDING_ID}`;

function aggregate(kind: 'judged' | 'mixed'): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: kind === 'judged'
      ? { testQuality: { kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT, contractVersion: 'v3', findings: [FINDING], verdict: 'FAIL' } }
      : { testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'provider unavailable' } },
  });
}

/** A mechanically clean lap: the current content set is empty by construction. */
function passAggregate(): unknown {
  return joinBuildReviewRubricOutcomes({
    lapId: LAP_ID, snapshotDigest: SNAPSHOT,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: LAP_ID, snapshotDigest: SNAPSHOT,
        contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
    },
  });
}

function actionJudgement(): unknown {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'acted', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The changed test needs a focused assertion.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'test/example.test.ts:8 — assert the rejection path' }] },
    }],
  };
}

function deferralJudgement(): unknown {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: SOURCE_ID, outcome: 'deferred', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'defer', priority: 'low', confidence: 'high',
      rationale: 'The repair belongs to a separately planned change.',
      effect: { kind: 'deferral', title: 'Deferred build-review finding', body: 'The changed assertion is insensitive.', exclusionRationale: 'Outside this feature plan.' },
    }],
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly judgement?: unknown;
  /** Rubric ids the operator has covered with an exact reduced-coverage decision. */
  readonly infrastructure?: 'none' | 'covered' | 'uncovered';
  /**
   * Report uncovered infrastructure alongside a judged content finding.
   * Today's registry holds one rubric, so a genuinely mixed aggregate cannot be
   * built in production; the effective projection is the seam the conductor
   * actually reads for its mechanical state, so drive it there.
   */
  readonly reportUncoveredInfrastructure?: boolean;
  /** Writes durable `.pipeline` artifacts a previous process would have left. */
  readonly seedPipeline?: (projectRoot: string) => Promise<void>;
  readonly startFrom?: StepName;
  readonly adjudicationEnabled?: boolean;
  /** Forces an actual BUILD entry without relying on durable retry recovery. */
  readonly buildPending?: boolean;
  readonly chargeEffect?: typeof chargeBuildReviewEffectInLedger;
  /** A clean lap. The adjudication coordinator never runs for one. */
  readonly rawVerdict?: 'PASS' | 'FAIL';
}

async function fixture(options: FixtureOptions = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'conductor-build-review-adjudication-'));
  roots.push(projectRoot);
  const feature = { version: 'v1' as const, repository: projectRoot, feature: 'adjudicated-feature' };
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(join(projectRoot, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }), 'utf8');

  await options.seedPipeline?.(projectRoot);

  const statePath = join(projectRoot, '.pipeline', 'state.json');
  const state: Record<string, unknown> = { complexity_tier: 'M', run_started_at: 1 };
  for (const step of ALL_STEPS) if (step.name !== 'build_review') state[step.name] = 'done';
  if (options.startFrom === 'build') state.build_review = 'done';
  if (options.buildPending) state.build = 'pending';
  await writeState(statePath, state as ConductState);

  const mixed = options.infrastructure && options.infrastructure !== 'none';
  const clean = options.rawVerdict === 'PASS';
  const raw = clean ? passAggregate() : aggregate(mixed ? 'mixed' : 'judged');

  const dispatched: StepName[] = [];
  const artifactMtimes = new Map<string, number>();
  const retryReasons = new Map<StepName, string>();
  let remediateDispatches = 0;
  const runner: StepRunner = {
    run: async (step: StepName, _state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> => {
      dispatched.push(step);
      if (opts?.retryReason !== undefined) retryReasons.set(step, opts.retryReason);
      if (step === 'build') throw new Error('stop after BUILD dispatch');
      if (step === 'remediate') {
        remediateDispatches += 1;
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify(options.judgement ?? actionJudgement()), 'utf8');
        return { success: true };
      }
      if (step === 'build_review') {
        await writeFile(join(projectRoot, '.pipeline/build-review.json'), JSON.stringify(raw), 'utf8');
        return { success: true };
      }
      return { success: true };
    },
  };

  const infrastructureRubrics = mixed || options.reportUncoveredInfrastructure ? (['testQuality'] as const) : ([] as const);
  const uncovered = options.infrastructure === 'uncovered' || options.reportUncoveredInfrastructure
    ? (['testQuality'] as const) : ([] as const);
  const resolver: NonNullable<CompletionContext['buildReviewEffectiveResolver']> = vi.fn(async () => ({
    ok: true as const,
    feature,
    effective: {
      rawVerdict: clean ? ('PASS' as const) : ('FAIL' as const),
      verdict: clean ? ('PASS' as const) : ('FAIL' as const),
      acceptedFindingIds: [] as string[],
      unresolvedFindingIds: mixed || clean ? [] : [FINDING_ID],
      skippedRubrics: [],
      infrastructureFailureRubrics: [...infrastructureRubrics],
      uncoveredInfrastructureFailureRubrics: [...uncovered],
    },
  })) as never;

  const ghCalls: string[][] = [];
  const gh = vi.fn(async (args: string[]) => {
    ghCalls.push(args);
    if (args[0] === 'repo' && args[1] === 'view') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' };
    if (args[0] === 'issue' && args[1] === 'create') return { stdout: 'https://github.com/acme/conductor/issues/77\n' };
    return { stdout: '{}' };
  });

  const events = new ConductorEventEmitter();
  const kickbacks: Array<{ from: string; to: string }> = [];
  const lifecycle: ConductorEvent[] = [];
  const loopHalts: ConductorEvent[] = [];
  events.on('kickback', (event) => { if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to }); });
  events.on('loop_halt', (event) => { loopHalts.push(event); });
  for (const type of ['remediation_adjudication_started', 'remediation_adjudication_completed', 'remediation_effect_applied', 'remediation_case_reconciled'] as const) {
    events.on(type, (event) => { lifecycle.push(event); });
  }

  const conductor = new Conductor({
    projectRoot,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    fromStep: options.startFrom ?? 'build_review',
    verifyArtifacts: true,
    mode: 'auto',
    daemon: true,
    config: {
      kickback_escalation: { enabled: false },
      build_review: { adjudication: { enabled: options.adjudicationEnabled ?? true } },
    },
    buildReviewEffectiveResolver: resolver,
    buildReviewChargeEffect: options.chargeEffect,
    gh,
  } as never);

  for (const relative of ['.pipeline/remediation-cases.json', '.pipeline/build-review-work-order.json']) {
    await stat(join(projectRoot, relative)).then((metadata) => artifactMtimes.set(relative, metadata.mtimeMs)).catch(() => {});
  }

  await conductor.run().catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.startsWith('stop after')) throw error;
  });

  return {
    projectRoot, feature, dispatched, retryReasons, kickbacks, lifecycle, loopHalts, ghCalls,
    remediateDispatches: () => remediateDispatches, artifactMtimes,
    readJson: async (relative: string): Promise<unknown> =>
      JSON.parse(await readFile(join(projectRoot, relative), 'utf8')) as unknown,
    state: async (): Promise<ConductState> =>
      JSON.parse(await readFile(statePath, 'utf8')) as ConductState,
    haltMarker: async (): Promise<string> => readFile(join(projectRoot, '.pipeline/HALT'), 'utf8').catch(() => ''),
  };
}

describe('engine/conductor — build_review post-join adjudication wiring', () => {
  it('routes one adjudicated action through one dispatch, one charge, and a durable BUILD handoff', async () => {
    const run = await fixture();

    expect(run.remediateDispatches()).toBe(1);
    expect(run.kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(run.dispatched).toContain('build');
    // Done-when 1: exactly one first action charge, keyed by the stable effect id.
    const ledger = await run.readJson('.pipeline/kickback-ledger.json') as { gates: { build_review: { count: number; chargedEffectIds: string[] } } };
    expect(ledger.gates.build_review.count).toBe(1);
    expect(ledger.gates.build_review.chargedEffectIds).toHaveLength(1);
    // Done-when 5: the BUILD retry context comes from the DURABLE order.
    const order = await run.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    expect(order.effectId).toBe(ledger.gates.build_review.chargedEffectIds[0]);
    expect(run.retryReasons.get('build')).toContain(`Build-review remediation work order (effect: ${order.effectId})`);
    expect(run.retryReasons.get('build')).toContain('test/example.test.ts:8 — assert the rejection path');
    // BUILD attempt evidence is stamped before provider work, durably.
    expect(order.attemptedCaseIds).toHaveLength(1);
  });

  it.each([
    ['charge throws', async () => { throw new Error('ledger unavailable'); }],
    ['per-gate cap is exhausted', async () => ({ status: 'charged' as const, exhausted: true, cumulativeExhausted: false, entry: { count: 3, cumulative: 3 } })],
    ['cumulative cap is exhausted', async () => ({ status: 'charged' as const, exhausted: false, cumulativeExhausted: true, entry: { count: 3, cumulative: 6 } })],
  ])('halts needs-human without dispatching BUILD when %s', async (_name, chargeEffect) => {
    const charge = vi.fn(chargeEffect);
    const run = await fixture({ chargeEffect: charge as never });

    expect({ dispatched: run.dispatched, charges: charge.mock.calls.length }).toEqual({ dispatched: ['build_review', 'remediate'], charges: 1 });
    expect(await run.haltMarker()).toContain('build_review adjudication halted:');
  });

  it('recovers the accepted work order and BUILD navigation point from disk alone after a restart', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    const cases = await first.readJson('.pipeline/remediation-cases.json');

    // A genuinely fresh process: a new conductor, a new project root, no
    // `pendingRetryHints`, no memory of the lap that adjudicated the route.
    // Only the two durable artifacts travel, exactly as they would survive a
    // daemon restart.
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).toContain('build');
    expect(restart.retryReasons.get('build')).toContain(`Build-review remediation work order (effect: ${order.effectId})`);
    expect(restart.retryReasons.get('build')).toContain('test/example.test.ts:8 — assert the rejection path');
    // The restarted process re-stamps the attempt against the same durable id.
    const restartedOrder = await restart.readJson('.pipeline/build-review-work-order.json') as { effectId: string; attemptedCaseIds?: string[] };
    expect(restartedOrder.effectId).toBe(order.effectId);
    expect(restartedOrder.attemptedCaseIds).toEqual(order.attemptedCaseIds);
  });

  it('treats an all-resolved durable action order as absent on a fresh BUILD entry', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ resolution: string }> };
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify({
          ...(cases as object), cases: cases.cases.map((record) => ({ ...record, resolution: 'resolved' })),
        }), 'utf8');
      },
    });

    expect(restart.dispatched).toEqual(['build']);
    expect(restart.retryReasons.get('build')).toBeUndefined();
  });

  it('halts before BUILD when a durable work order is malformed rather than falling back to a stale hint', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), '{not json', 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).not.toContain('build');
    expect(await restart.haltMarker()).toContain('BUILD durable remediation recovery halted: work order malformed-json');
  });

  it.each(['work order', 'case store'] as const)('does not read a durable adjudication %s when adjudication is disabled', async (artifact) => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const disabled = await fixture({
      startFrom: 'build', buildPending: true, adjudicationEnabled: false,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), artifact === 'work order' ? '{not json' : JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), artifact === 'case store' ? '{not json' : JSON.stringify(cases), 'utf8');
      },
    });

    // A malformed artifact is an observable read spy: the disabled route must
    // remain on the pre-feature BUILD path rather than parsing or stamping it.
    expect(disabled.dispatched).toEqual(['build']);
    expect(disabled.retryReasons.get('build')).toBeUndefined();
    expect(await disabled.haltMarker()).not.toContain('BUILD durable remediation recovery halted');
    for (const [relative, before] of disabled.artifactMtimes) {
      expect((await stat(join(disabled.projectRoot, relative))).mtimeMs).toBe(before);
    }
  });

  it('halts before BUILD when a durable order names an effect the case store never recorded', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json') as { effectId: string };
    const cases = await first.readJson('.pipeline/remediation-cases.json');

    // The order still names an OPEN action case of THIS feature, so openness
    // and feature identity both pass; only its stable effect is foreign. Under
    // a feature-only read that order reached BUILD prompt construction.
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(
          join(root, '.pipeline/build-review-work-order.json'),
          JSON.stringify({ ...order, effectId: 'effect-from-another-route' }),
          'utf8',
        );
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
      },
    });

    expect(restart.dispatched).not.toContain('build');
    expect(restart.retryReasons.get('build')).toBeUndefined();
    expect(await restart.haltMarker()).toContain('BUILD durable remediation recovery halted: work order foreign-effect');
  });

  it('files a deferred case through the production tracker and intake dependencies', async () => {
    const run = await fixture({ judgement: deferralJudgement() });

    // Done-when 4: exact marker lookup precedes create, and both run from the
    // real dispatch — not from an injected coordinator fixture.
    expect(run.ghCalls.some((args) => args[0] === 'issue' && args[1] === 'list' && args.includes('--state') && args.includes('all'))).toBe(true);
    expect(run.ghCalls.some((args) => args[0] === 'issue' && args[1] === 'create')).toBe(true);
    const cases = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ effect: { status: string; issueUrl?: string } }> };
    expect(cases.cases[0]!.effect).toMatchObject({ status: 'applied', issueUrl: 'https://github.com/acme/conductor/issues/77' });
    // A finalized non-action outcome performs no BUILD navigation.
    expect(run.dispatched).not.toContain('build');
    expect(run.kickbacks).toEqual([]);
  });

  it('lets an exactly covered infrastructure branch settle instead of pinning the mechanical lane', async () => {
    const covered = await fixture({ infrastructure: 'covered' });

    // Done-when 6: covered infrastructure is not uncovered infrastructure. With
    // no unresolved content source the lap settles; it never fabricates PASS
    // from an uncovered fault, which the next case proves.
    expect(covered.dispatched).not.toContain('build');
    expect(await covered.haltMarker()).toBe('');
    expect(covered.remediateDispatches()).toBe(0);
  });

  it('keeps an uncovered infrastructure branch in the mechanical lane without a semantic kickback', async () => {
    const uncovered = await fixture({ infrastructure: 'uncovered' });

    expect(uncovered.dispatched).not.toContain('build');
    expect(uncovered.kickbacks).toEqual([]);
    expect(uncovered.remediateDispatches()).toBe(0);
    // An uncovered fault is not PASS: it exhausts the bounded mechanical
    // allowance, preserves the source diagnostic, and then writes the
    // conductor HALT marker. These are the durable outputs of the production
    // mechanical lane, rather than merely the absence of a semantic route.
    const ledger = await uncovered.readJson('.pipeline/kickback-ledger.json') as {
      gates: { build_review?: {
        count?: number;
        mechanicalFaults?: number;
        lastMechanicalFault?: { rubric: string; reason: string; detail: string; lapId: string };
      } };
    };
    expect(ledger.gates.build_review?.count ?? 0).toBe(0);
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(3);
    expect(ledger.gates.build_review?.lastMechanicalFault).toEqual({
      rubric: 'testQuality',
      reason: 'provider-error',
      detail: 'provider unavailable',
      lapId: LAP_ID,
    });
    expect(await uncovered.haltMarker()).toContain('build_review adjudication halted');
  });

  it.each([
    ['malformed ledger', 'not valid json {', 'kickback ledger is unreadable'],
    ['version-incompatible ledger', JSON.stringify({ version: 2, gates: {} }), 'kickback ledger has an unsupported version'],
  ])('halts before adjudication when the mechanical ledger is %s', async (_name, rawLedger, reason) => {
    const charge = vi.fn(async () => ({
      status: 'charged' as const,
      exhausted: false,
      cumulativeExhausted: false,
      entry: { count: 1, cumulative: 1 },
    }));
    const run = await fixture({
      infrastructure: 'uncovered', chargeEffect: charge as never,
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/kickback-ledger.json'), rawLedger, 'utf8');
      },
    });

    expect(await run.haltMarker()).toContain(reason);
    expect(run.remediateDispatches()).toBe(0);
    expect(run.dispatched).not.toContain('build');
    expect(charge).not.toHaveBeenCalled();
    await expect(readFile(join(run.projectRoot, '.pipeline/kickback-ledger.json'), 'utf8')).resolves.toBe(rawLedger);
  });
  it('does not leak a settled work order into a later unrelated BUILD dispatch', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const settled = await first.readJson('.pipeline/remediation-cases.json') as {
      version: string; feature: unknown; cases: Array<Record<string, unknown>>;
    };

    // BUILD repaired the case and the next lap resolved it. The order artifact
    // is still on disk and still parses — it must not keep re-entering BUILD
    // prompts, and it must not be re-stamped as attempted again.
    const resolved = { ...settled, cases: settled.cases.map((record) => ({ ...record, resolution: 'resolved' })) };
    const later = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(resolved), 'utf8');
      },
    });

    expect(later.dispatched).toContain('build');
    expect(later.retryReasons.get('build')).toBeUndefined();
  });
  it('settles a prior attempted action case when a later lap passes cleanly', async () => {
    const first = await fixture();
    const order = await first.readJson('.pipeline/build-review-work-order.json');
    const attempted = await first.readJson('.pipeline/remediation-cases.json') as {
      version: string; feature: unknown; cases: Array<Record<string, unknown>>;
    };
    expect(attempted.cases.map((record) => record.resolution)).toEqual(['open']);

    // The adjudication coordinator runs only on a raw FAIL, so before this a
    // clean lap left the repaired case open with its applied effect — and every
    // later BUILD entry, for any gate, read its stale order back.
    const later = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(attempted), 'utf8');
      },
    });

    expect(later.remediateDispatches()).toBe(0);
    const settled = await later.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; resolution: string }>;
    };
    expect(settled.cases.map((record) => record.resolution)).toEqual(['resolved']);
    expect(later.lifecycle).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: settled.cases[0]!.id, resolution: 'resolved',
    }));
  });

  it('keeps a clean PASS terminal when there is no durable case store', async () => {
    const run = await fixture({ rawVerdict: 'PASS' });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
  });

  it('settles an open non-action case without an order before terminal PASS', async () => {
    const first = await fixture({ judgement: deferralJudgement() });
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8'),
    });

    expect(await run.haltMarker()).toBe('');
    expect((await run.state()).build_review).toBe('done');
    const settled = await run.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; resolution: string }> };
    expect(settled.cases).toEqual([expect.objectContaining({ resolution: 'resolved' })]);
    expect(run.lifecycle).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: settled.cases[0]!.id, resolution: 'resolved',
    }));
  });

  it.each(['reserved', 'applied', 'failed'] as const)('halts a clean PASS when an open %s action effect has no order', async (status) => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json') as {
      cases: Array<{ id: string; effect: { id: string; kind: string; status: string; workOrderId?: string; diagnostic?: string } }>;
    };
    const seeded = {
      ...cases,
      cases: cases.cases.map((record) => ({
        ...record,
        effect: {
          ...record.effect,
          status,
          ...(status === 'reserved' || status === 'failed' ? { workOrderId: undefined } : {}),
          ...(status === 'failed' ? { diagnostic: 'previous effect failure' } : {}),
        },
      })),
    };
    const caseId = seeded.cases[0]!.id;
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(seeded), 'utf8'),
    });

    expect(await run.haltMarker()).toContain(`build_review clean-PASS durable settlement halted: work order attempt missing-work-order with open action case ${caseId} (${status})`);
    expect((await run.state()).build_review).not.toBe('done');
  });

  it('halts BUILD recovery when an open applied action case has no work order', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<{ id: string; effect: { status: string } }> };
    const caseId = cases.cases[0]!.id;
    const restart = await fixture({
      startFrom: 'build',
      seedPipeline: async (root) => writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8'),
    });

    expect(restart.dispatched).not.toContain('build');
    expect(await restart.haltMarker()).toContain(`BUILD durable remediation recovery halted: work order missing-work-order with open action case ${caseId} (applied)`);
  });

  it.each([
    ['malformed', async (root: string) => {
      await writeFile(join(root, '.pipeline/remediation-cases.json'), '{not json', 'utf8');
    }, 'malformed-json'],
    ['foreign-domain', async (root: string) => {
      const first = await fixture();
      const cases = await first.readJson('.pipeline/remediation-cases.json') as { cases: Array<Record<string, unknown>> };
      await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify({
        ...cases,
        cases: cases.cases.map((record, index) => index === 0 ? { ...record, domain: 'foreign-domain' } : record),
      }), 'utf8');
    }, 'foreign-domain'],
  ])('halts a clean PASS when the durable case store is %s', async (_name, seedPipeline, reason) => {
    const run = await fixture({ rawVerdict: 'PASS', seedPipeline });

    expect(await run.haltMarker()).toContain(`build_review clean-PASS durable settlement halted: case store ${reason}`);
    expect((await run.state()).build_review).not.toBe('done');
    // adr-2026-08-11 decision 1: the marker is not the halt. A halt reaches the
    // operator on the persisted spine, and the daemon's fallback emitter is
    // suppressed once a marker exists — so a bare marker write is silent.
    expect(run.loopHalts).toContainEqual(expect.objectContaining({
      type: 'loop_halt',
      reason: expect.stringContaining('build_review clean-PASS durable settlement halted'),
    }));
  });

  it('halts a clean PASS when durable work-order attempt evidence is invalid', async () => {
    const first = await fixture();
    const cases = await first.readJson('.pipeline/remediation-cases.json');
    const run = await fixture({
      rawVerdict: 'PASS',
      seedPipeline: async (root) => {
        await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
        await mkdir(join(root, '.pipeline/build-review-work-order.json'));
      },
    });

    expect(await run.haltMarker()).toContain('build_review clean-PASS durable settlement halted: work order attempt unreadable-work-order');
    expect((await run.state()).build_review).not.toBe('done');
  });

  it('halts a clean PASS when durable case reconciliation cannot persist', async () => {
    const first = await fixture();
    const [cases, order] = await Promise.all([
      first.readJson('.pipeline/remediation-cases.json'),
      first.readJson('.pipeline/build-review-work-order.json'),
    ]);
    const reconcile = vi.spyOn(remediationCaseReconciler, 'reconcileRemediationCases').mockResolvedValue({
      ok: false,
      reason: 'store-failure',
      storeReason: 'atomic-replace-failed',
    });
    try {
      const run = await fixture({
        rawVerdict: 'PASS',
        seedPipeline: async (root) => {
          await writeFile(join(root, '.pipeline/remediation-cases.json'), JSON.stringify(cases), 'utf8');
          await writeFile(join(root, '.pipeline/build-review-work-order.json'), JSON.stringify(order), 'utf8');
        },
      });

      expect(await run.haltMarker()).toContain('build_review clean-PASS durable settlement halted: case reconciliation store-failure');
      expect((await run.state()).build_review).not.toBe('done');
    } finally {
      reconcile.mockRestore();
    }
  });

  it('takes the mechanical lane for a non-action lap with uncovered infrastructure, spending no semantic kickback', async () => {
    const run = await fixture({ judgement: deferralJudgement(), reportUncoveredInfrastructure: true });

    // adr-2026-08-29 D3.2: the content was adjudicated and finalized, so the
    // legacy raw kickback would have re-sent settled content to BUILD and
    // charged a semantic route for it.
    expect(run.remediateDispatches()).toBeGreaterThanOrEqual(1);
    expect(run.dispatched).not.toContain('build');
    expect(run.kickbacks).toEqual([]);
    const ledger = await run.readJson('.pipeline/kickback-ledger.json') as { gates: { build_review?: { count?: number; mechanicalFaults?: number } } };
    expect(ledger.gates.build_review?.count ?? 0).toBe(0);
    // The mechanical allowance bounds the re-land loop and then halts.
    expect(ledger.gates.build_review?.mechanicalFaults).toBe(3);
    expect(await run.haltMarker()).toContain('build_review adjudication halted');
  });
});
