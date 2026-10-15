// Covers: task:rem-prd-audit-W1, task:rem-prd-audit-W2, task:rem-prd-audit-W4, task:rem-prd-audit-W5

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const routingMutationSpy = vi.hoisted(() => ({
  calls: [] as string[],
  ownerTaskIds: [] as Array<readonly string[] | undefined>,
  citedPaths: [] as Array<readonly string[] | undefined>,
  hostPlans: [] as Array<readonly { readonly branch: string; readonly planPath: string }[] | undefined>,
  allocatedRemTaskIds: [] as string[],
  routedItems: [] as Array<{ readonly host: number; readonly reason: string }>,
  storedRouteItems: [] as Array<{ readonly owner: number; readonly host: number }>,
  projectionResult: undefined as Awaited<ReturnType<typeof import('../../src/engine/remediation-projection.js').buildRemediationProjection>> | undefined,
  consolidatedManualTestFail: undefined as readonly string[] | undefined,
  routeResult: undefined as Awaited<ReturnType<typeof import('../../src/engine/routing/round-router.js').routeAdmittedRound>> | undefined,
}));

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'conductor-residue-routing-judge',
  })),
}));

vi.mock('../../src/engine/remediation-projection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/remediation-projection.js')>();
  return {
    ...actual,
    buildRemediationProjection: vi.fn(async (...args: Parameters<typeof actual.buildRemediationProjection>) =>
      routingMutationSpy.projectionResult ?? actual.buildRemediationProjection(...args)),
  };
});

vi.mock('../../src/engine/routing/route-record-store.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/routing/route-record-store.js')>(),
  nextRoundId: vi.fn(async () => 'r1'),
  createRouteRecord: vi.fn(async (_worktree, _slug, input) => {
    routingMutationSpy.calls.push('create-record');
    routingMutationSpy.storedRouteItems = input.items.map(({ owner, host }) => ({ owner, host }));
    return {
      kind: 'created' as const,
      record: {
        ...input,
        phase: 'prepared' as const,
        hosts: { 1: 'pending' as const },
        currentHostIndex: 0,
        receipt: {},
        outbox: [],
      },
    };
  }),
}));

vi.mock('../../src/engine/routing/round-admission.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/routing/round-admission.js')>(),
  admitRound: vi.fn(async (_worktree, _slug, record, firstHost, dependencies) => {
    routingMutationSpy.calls.push('admit-marker');
    const admitted = {
      ...record,
      phase: 'open' as const,
      hosts: { ...record.hosts, [firstHost]: 'admitted' as const },
    };
    if (dependencies?.persist) {
      const events = await import('../../src/engine/routing/routing-events.js');
      await dependencies.persist(events.routedRepairPhaseEvent(record.roundId, firstHost, 'admitted', false));
      await dependencies.persist(events.remediationRoutedEvent(admitted));
    }
    return { kind: 'admitted' as const, record: admitted };
  }),
}));

vi.mock('../../src/engine/routing/round-router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/routing/round-router.js')>();
  return {
    ...actual,
    routeAdmittedRound: vi.fn(async (...args: Parameters<typeof actual.routeAdmittedRound>) => {
      routingMutationSpy.calls.push('route');
      routingMutationSpy.ownerTaskIds = args[0].admitted.map((item) => item.ownerTaskIds);
      routingMutationSpy.citedPaths = args[0].admitted.map((item) => item.citedPaths);
      routingMutationSpy.hostPlans.push(args[0].hostPlans);
      routingMutationSpy.consolidatedManualTestFail = args[0].consolidatedManualTestFail;
      const result = routingMutationSpy.routeResult ?? await actual.routeAdmittedRound(...args);
      routingMutationSpy.routedItems = result.kind === 'routed'
        ? result.items.map(({ host, reason }) => ({ host, reason }))
        : [];
      routingMutationSpy.allocatedRemTaskIds = result.kind === 'routed'
        ? Object.values(result.allocation).flatMap(({ remTaskIds }) => remTaskIds)
        : [];
      return result;
    }),
  };
});

vi.mock('../../src/engine/remediation-task-append.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/remediation-task-append.js')>();
  return {
    ...actual,
    appendConductorRemediationTasks: vi.fn(async (
      ...args: Parameters<typeof actual.appendConductorRemediationTasks>
    ) => {
      routingMutationSpy.calls.push('append');
      return actual.appendConductorRemediationTasks(...args);
    }),
  };
});

vi.mock('../../src/engine/guarded-engine-commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/guarded-engine-commit.js')>();
  return {
    ...actual,
    commitEngineChangeWhenStacked: vi.fn(async () => {
      routingMutationSpy.calls.push('commit');
      return undefined;
    }),
  };
});

vi.mock('../../src/engine/artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/artifacts.js')>();
  return {
    ...actual,
    recordAppendedRemediationTaskIds: vi.fn(async () => {
      routingMutationSpy.calls.push('record-appended');
    }),
  };
});

vi.mock('../../src/engine/task-seed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/task-seed.js')>();
  return {
    ...actual,
    seedTaskStatus: vi.fn(async () => {
      routingMutationSpy.calls.push('seed');
    }),
  };
});

vi.mock('../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    recordPendingRepair: vi.fn(async () => {
      routingMutationSpy.calls.push('record-pending');
    }),
  };
});

vi.mock('../../src/engine/repair-restage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/repair-restage.js')>();
  return {
    ...actual,
    admitAndRestageRepair: vi.fn(async () => {
      routingMutationSpy.calls.push('restage');
      return { kind: 'failed' as const, detail: 'fixture must not restage a routed repair' };
    }),
  };
});

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { persistFixtureRemediationPlan, persistFixtureProjectedRemediationPlan } from './remediation-plan-fixtures.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

class ContextBoundResidueRunner implements StepRunner {
  calls = 0;

  constructor(private readonly projectRoot: string) {}

  async run(_step: string, _state: ConductState, options: Parameters<StepRunner['run']>[2]) {
    const request = options?.remediationRequest;
    if (request?.mode !== 'gap-plan' || options?.runId === undefined) {
      throw new Error('fixture requires a remediation gap-plan request');
    }
    await persistFixtureRemediationPlan(this.projectRoot, options, {
      version: 'v1',
      dispositions: [{
        reference: { kind: 'stall', id: 'stall:residue' },
        disposition: 'build', category: null,
        rationale: 'Taskless build-stall residue must be placed in the routed round.',
        tasks: [], boundTaskIds: [],
      }],
    });
    return { success: true };
  }

  async dispatchResidueRoutingJudgement(prompt: string) {
    this.calls += 1;
    const request = JSON.parse(prompt.slice(prompt.indexOf('{'))) as {
      items: Array<{ itemId: string }>;
    };
    return {
      success: true,
      output: JSON.stringify({
        version: 'v1',
        items: request.items.map(({ itemId }) => ({
          itemId, child: 1, candidates: [1], rationale: 'The first slice owns this residue.',
        })),
      }),
    };
  }
}

class RoutingOffMixedHaltRunner implements StepRunner {
  constructor(private readonly projectRoot: string) {}

  async run(_step: string, _state: ConductState, options: Parameters<StepRunner['run']>[2]) {
    const request = options?.remediationRequest;
    if (request?.mode !== 'gap-plan' || options?.runId === undefined) {
      throw new Error('fixture requires a remediation gap-plan request');
    }
    await persistFixtureRemediationPlan(this.projectRoot, options, {
      version: 'v1',
      dispositions: [
        {
          reference: { kind: 'stall', id: 'stall:append' },
          disposition: 'build', category: null,
          rationale: 'Append the ordinary leaf repair before surfacing the sibling halt.',
          tasks: [{ id: 'leaf-repair', title: 'Append the ordinary leaf repair' }], boundTaskIds: [],
        },
        {
          reference: { kind: 'stall', id: 'stall:human' },
          disposition: 'halt', category: 'architectural-clarity',
          rationale: 'A human must decide the sibling architectural boundary.',
          tasks: [], boundTaskIds: [],
        },
      ],
    });
    return { success: true };
  }
}

class AsBuiltResidueRunner implements StepRunner {
  calls = 0;
  projection: unknown;

  constructor(private readonly projectRoot: string) {}

  async run(_step: string, _state: ConductState, options: Parameters<StepRunner['run']>[2]) {
    const request = options?.remediationRequest;
    if (request?.mode !== 'gap-plan' || options?.runId === undefined) {
      throw new Error('fixture requires a remediation gap-plan request');
    }
    const finding = request.projection.requiredReferences[0];
    if (finding?.kind !== 'as-built-finding') throw new Error('fixture requires an as-built finding');
    await persistFixtureProjectedRemediationPlan(this.projectRoot, options, [{
      id: finding.id, referenceKind: 'as-built-finding', disposition: 'build', category: null,
      rationale: 'Wire the ADR-governed boundary.',
      tasks: [{ id: 'wire-boundary', title: 'Wire the ADR-governed boundary' }],
    }]);
    return { success: true };
  }

  async dispatchResidueRoutingJudgement(prompt: string) {
    this.calls += 1;
    this.projection = JSON.parse(prompt.slice(prompt.indexOf('{')));
    const request = this.projection as { items: Array<{ itemId: string }> };
    return {
      success: true,
      output: JSON.stringify({
        version: 'v1',
        items: request.items.map(({ itemId }) => ({
          itemId, child: 1, candidates: [1], rationale: 'The ADR applies to the first slice.',
        })),
      }),
    };
  }
}

class AsBuiltTaskBoundRunner implements StepRunner {
  constructor(private readonly projectRoot: string) {}

  async run(_step: string, _state: ConductState, options: Parameters<StepRunner['run']>[2]) {
    const request = options?.remediationRequest;
    if (request?.mode !== 'gap-plan' || options?.runId === undefined) {
      throw new Error('fixture requires a remediation gap-plan request');
    }
    const finding = request.projection.requiredReferences[0];
    if (finding?.kind !== 'as-built-finding') throw new Error('fixture requires an as-built finding');
    await persistFixtureProjectedRemediationPlan(this.projectRoot, options, [{
      id: finding.id, referenceKind: 'as-built-finding', disposition: 'build', category: null,
      rationale: 'Repair the authored task boundary.',
      tasks: [{ id: 'repair-task-for-first', title: 'Repair the authored task boundary' }],
    }]);
    return { success: true };
  }
}

const AS_BUILT_FIXTURE_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'fixture' },
  planGap: { enabled: true, reason: 'fixture' },
  adrCompliance: { enabled: false, reason: 'fixture' },
  diagramDrift: { enabled: false, reason: 'fixture' },
};

describe('Conductor residue routing judge binding', () => {
  let projectRoot: string;

  beforeEach(async () => {
    routingMutationSpy.calls = [];
    routingMutationSpy.ownerTaskIds = [];
    routingMutationSpy.citedPaths = [];
    routingMutationSpy.hostPlans = [];
    routingMutationSpy.allocatedRemTaskIds = [];
    routingMutationSpy.routedItems = [];
    routingMutationSpy.storedRouteItems = [];
    routingMutationSpy.projectionResult = undefined;
    routingMutationSpy.consolidatedManualTestFail = undefined;
    routingMutationSpy.routeResult = undefined;
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-residue-routing-judge-'));
    const planPath = join(projectRoot, '.docs', 'plans', 'feature.md');
    await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(planPath, '# Implementation plan\n', 'utf8');
    await writeFile(
      join(projectRoot, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
      'utf8',
    );
    await writeCoverageBindingEnvelope(projectRoot, {
      version: 1, slug: 'demo', runId: 'fixture', status: 'done', entries: [],
      sliceMembership: { taskSlices: { first: 1, second: 2 }, titles: ['first', 'second'] },
    }, envelopeFilesystem);
    await initTestRepo(projectRoot);
    const git = makeGitRunner(projectRoot);
    const mustSucceed = async (args: string[]) => {
      const result = await git(args);
      if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    };
    const first = childBranchFor('demo', parseChildId(1)!);
    if (!first.ok) throw new Error(first.reason);
    await mustSucceed(['add', '.']);
    await mustSucceed(['commit', '-qm', 'base']);
    await mustSucceed(['checkout', '-qb', first.branch]);
    await mustSucceed(['checkout', '-qb', leafBranchFor('demo'), 'main']);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('binds a context-dependent residue judge and routes each residue item without a malformed halt', async () => {
    const runner = new ContextBoundResidueRunner(projectRoot);
    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'build stall requires residue routing',
      { source: 'build_stall', evidence: [{ gate: 'build', evidenceFile: '.pipeline/build-stall-question.md' }] },
    );

    expect(runner.calls, JSON.stringify(outcome)).toBe(1);
    expect(outcome).toMatchObject({ kind: 'route' });
    expect(outcome.detail).toBeUndefined();
  });

  // Covers: task:rem-prd-audit-refusal-51431839-5348-4d88-8273-9c808a3b7887
  it('keeps routing-off mixed halt rounds on the main leaf append and commit path before halting', async () => {
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: false } },
      stepRunner: new RoutingOffMixedHaltRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({ kind: 'no-child' as const }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'routing-off mixed remediation must preserve leaf ordering',
      { source: 'build_stall' },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('stall:human (architectural-clarity: A human must decide the sibling architectural boundary.)'),
    });
    expect(routingMutationSpy.calls).toEqual(['append', 'record-appended', 'seed', 'commit']);
  });

  it('sends an ADR-only as-built finding with its summary and reference to the residue judge', async () => {
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
        summary: 'The ADR-governed boundary is not wired.',
      }],
      violations: 'The ADR implementation is incomplete.',
      resolution: 'Wire the boundary.',
    }, { attemptId: 'fixture-as-built', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });

    const runner = new AsBuiltResidueRunner(projectRoot);
    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built ADR finding requires residue routing',
      {
        source: 'architecture-review-as-built',
        evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }],
      },
    );

    expect(runner.calls, JSON.stringify(outcome)).toBe(1);
    expect(outcome).toMatchObject({ kind: 'route' });
    expect(runner.projection).toMatchObject({
      items: [expect.objectContaining({
        rationale: 'Wire the ADR-governed boundary.',
        summary: 'The ADR-governed boundary is not wired.',
        governingEvidence: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
      })],
    });
  });

  // Covers: task:rem-as-built-W3
  it('routes a proposed repair task to its admitted authored parent host', async () => {
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task first: authored work\n',
      'utf8',
    );
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: 'first' },
        summary: 'The authored boundary needs repair.',
      }],
      violations: 'The task-bound implementation is incomplete.',
      resolution: 'Repair the task boundary.',
    }, { attemptId: 'fixture-task-bound', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });

    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltTaskBoundRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built task-bound finding requires owner routing',
      { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route' });
    expect(routingMutationSpy.ownerTaskIds).toEqual([['first']]);
    expect(routingMutationSpy.calls).toEqual(['route', 'create-record', 'admit-marker']);
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-W14
  it('routes a contract-canonicalized multi-task as-built finding to its earliest owner', async () => {
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task T2: second authored work\n\n### Task T3: third authored work\n',
      'utf8',
    );
    await writeCoverageBindingEnvelope(projectRoot, {
      version: 1, slug: 'demo', runId: 'fixture', status: 'done', entries: [],
      sliceMembership: { taskSlices: { T2: 1, T3: 2 }, titles: ['second', 'third'] },
    }, envelopeFilesystem);
    const { resolveAsBuiltReferences } = await import('../../src/engine/as-built-contract.js');
    const canonicalized = await resolveAsBuiltReferences({
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: 'task-T2,task-T3' },
        summary: 'The shared authored boundary needs repair.',
      }],
      violations: 'The shared task-bound implementation is incomplete.',
      resolution: 'Repair the shared task boundary.',
    }, projectRoot, '.docs/plans/feature.md');
    if (!canonicalized.ok) throw new Error(`fixture contract resolution failed: ${canonicalized.requirement}`);
    await expect(canonicalized.verdict.findings[0]?.reference).toEqual({ kind: 'plan-task', taskId: 'T2,T3' });
    await persistAsBuiltVerdict(projectRoot, canonicalized.verdict, {
      attemptId: 'fixture-multi-task', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY,
    });
    // Task-context projection currently treats a canonical multi-task binding
    // as one active-plan id. It is outside W14's routing-handoff scope; pin
    // the actual contract output while isolating this conductor routing seam.
    routingMutationSpy.projectionResult = {
      ok: true,
      projection: {
        version: 1,
        source: 'as-built',
        requiredReferences: [{
          kind: 'as-built-finding', id: 'as-built:fixture-multi-task:1',
          sourceGate: 'architecture_review_as_built',
          reference: { kind: 'plan-task', taskId: 'T2,T3' },
          summary: 'The shared authored boundary needs repair.',
        }],
        evidence: { excerpts: [], omittedFiles: [] },
        tasks: [
          { id: 'T2', title: 'second authored work', doneWhen: [] },
          { id: 'T3', title: 'third authored work', doneWhen: [] },
        ],
        pendingAsBuiltFindings: [], priorLaps: [], refusals: [],
        vocabulary: {
          dispositions: ['build', 'acceptance_specs', 'architecture_review', 'plan', 'publication', 'existing-task', 'halt'],
          haltCategories: ['architectural-clarity', 'product-scope', 'unsupported', 'policy'],
        },
      },
    };

    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltTaskBoundRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built multi-task finding requires earliest-owner routing',
      { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(outcome.detail).toBeUndefined();
    expect(routingMutationSpy.ownerTaskIds).toEqual([['T2', 'T3']]);
    expect(routingMutationSpy.storedRouteItems).toEqual([{ owner: 1, host: 1 }]);
  });

  it('routes a T1 repair citing a child-2 prerequisite to host 2', async () => {
    const git = makeGitRunner(projectRoot);
    const mustSucceed = async (args: string[]) => {
      const result = await git(args);
      if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    };
    const first = parseChildId(1)!;
    const second = parseChildId(2)!;
    const childBranch = (position: typeof first) => {
      const result = childBranchFor('demo', position);
      if (!result.ok) throw new Error(result.reason);
      return result.branch;
    };

    await mustSucceed(['checkout', childBranch(first)]);
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'owner.ts'), 'export const owner = true;\n');
    await mustSucceed(['add', 'src/owner.ts']);
    await mustSucceed(['commit', '-qm', 'child one']);
    await mustSucceed(['update-ref', closureRefFor('demo', first), 'HEAD']);
    await mustSucceed(['checkout', '-qb', childBranch(second)]);
    await writeFile(join(projectRoot, 'src', 'child-two.ts'), 'export const childTwo = true;\n');
    await mustSucceed(['add', 'src/child-two.ts']);
    await mustSucceed(['commit', '-qm', 'child two']);
    await mustSucceed(['update-ref', closureRefFor('demo', second), 'HEAD']);
    await mustSucceed(['checkout', leafBranchFor('demo')]);
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'owner.ts'), 'export const owner = true;\n');
    await writeFile(join(projectRoot, 'src', 'child-two.ts'), 'export const childTwo = true;\n');
    await mustSucceed(['add', 'src/owner.ts', 'src/child-two.ts']);
    await mustSucceed(['commit', '-qm', 'leaf prerequisites']);

    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task first: authored work\n\n**Files:** src/owner.ts\n\n**Done when:**\n- [test] `src/child-two.ts` is available to the repair.\n',
      'utf8',
    );
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: 'first' },
        summary: 'src/child-two.ts is needed by the authored repair.',
      }],
      violations: 'The task-bound implementation is incomplete.',
      resolution: 'Repair the task boundary.',
    }, { attemptId: 'fixture-child-two', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });

    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltTaskBoundRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: leafBranchFor('demo'), nextChild: undefined,
        }),
      },
    });
    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built T1 repair needs the child-2 prerequisite',
      { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route' });
    expect(routingMutationSpy.ownerTaskIds).toEqual([['first']]);
    expect(routingMutationSpy.citedPaths).toEqual([expect.arrayContaining(['src/child-two.ts', 'src/owner.ts'])]);
    expect(routingMutationSpy.routedItems).toEqual([{ host: 2, reason: 'prerequisite-paths' }]);
    expect(routingMutationSpy.calls).toEqual(['route', 'create-record', 'admit-marker']);
  });

  // Covers: task:rem-prd-audit-W6
  it('reserves a rem id already held by a candidate child plan before allocating the routed block', async () => {
    const git = makeGitRunner(projectRoot);
    const mustSucceed = async (args: string[]) => {
      const result = await git(args);
      if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    };
    const first = parseChildId(1)!;
    const second = parseChildId(2)!;
    const child = childBranchFor('demo', first);
    if (!child.ok) throw new Error(child.reason);

    await mustSucceed(['checkout', child.branch]);
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task first: authored work\n\n### Task rem-as-built-repair-task-for-first: Existing child repair\n',
      'utf8',
    );
    await mustSucceed(['add', '.docs/plans/feature.md']);
    await mustSucceed(['commit', '-qm', 'child remediation']);
    await mustSucceed(['checkout', leafBranchFor('demo')]);
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task first: authored work\n',
      'utf8',
    );
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: 'first' },
        summary: 'The authored boundary needs repair.',
      }],
      violations: 'The task-bound implementation is incomplete.',
      resolution: 'Repair the task boundary.',
    }, { attemptId: 'fixture-child-rem-id', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });

    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltTaskBoundRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: leafBranchFor('demo'), nextChild: undefined,
        }),
      },
    });
    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built task-bound finding collides with a child remediation id',
      { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route' });
    expect(routingMutationSpy.hostPlans).toEqual([[{ branch: child.branch, planPath: '.docs/plans/feature.md' }]]);
    expect(routingMutationSpy.allocatedRemTaskIds).toEqual(['rem-as-built-repair-task-for-first-2']);
  });

  it('passes validation-group FAIL rows verbatim to the router and returns the stored host retry hint', async () => {
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'feature.md'),
      '# Implementation plan\n\n### Task first: authored work\n',
      'utf8',
    );
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'plan-task', taskId: 'first' },
        summary: 'The authored boundary needs repair.',
      }],
      violations: 'The task-bound implementation is incomplete.',
      resolution: 'Repair the task boundary.',
    }, { attemptId: 'fixture-task-bound', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });

    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltTaskBoundRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });
    const failRows = ['manual_test: FAIL row one\n  observed detail', 'manual_test: FAIL row two'];
    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; hint?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'validation-group task-bound finding with manual-test FAIL rows',
      {
        source: 'validation-group',
        consolidatedManualTestFail: true,
        consolidatedManualTestFailRows: failRows,
        evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }],
      },
    );

    expect(outcome).toMatchObject({ kind: 'route' });
    expect(routingMutationSpy.consolidatedManualTestFail).toEqual(failRows);
    expect(outcome.hint).toContain(failRows[0]!);
    expect(outcome.hint).toContain(failRows[1]!);
  });

  // Covers: task:rem-as-built-W12, task:rem-as-built-W13
  it('persists an admitted routed round before returning the build route that navigates back', async () => {
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
        summary: 'The ADR-governed boundary is not wired.',
      }],
      violations: 'The ADR implementation is incomplete.',
      resolution: 'Wire the boundary.',
    }, { attemptId: 'fixture-as-built', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });
    const second = parseChildId(2)!;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltResidueRunner(projectRoot),
      events,
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    try {
      const outcome = await (conductor as unknown as {
        planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string }>;
      }).planRemediation(
        { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
        ALL_STEPS,
        'as-built ADR finding requires residue routing',
        { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
      );

      expect(outcome).toMatchObject({ kind: 'route' });
      expect(routingMutationSpy.calls).toEqual(['route', 'create-record', 'admit-marker']);
      expect((await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({ type: 'routed_repair_phase', roundId: 'r1', phase: 'admitted' }),
        expect.objectContaining({ type: 'remediation_routed', roundId: 'r1' }),
      ]);
    } finally {
      persister.stop();
    }
  });

  // Covers: task:rem-as-built-W12
  it('leaves the leaf plan byte-identical and does not invoke leaf repair writers when routing halts', async () => {
    await persistAsBuiltVerdict(projectRoot, {
      version: 'v2', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{
        class: 'REMEDIABLE',
        reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 3 },
        summary: 'The ADR-governed boundary is not wired.',
      }],
      violations: 'The ADR implementation is incomplete.',
      resolution: 'Wire the boundary.',
    }, { attemptId: 'fixture-as-built', codeStamp: null, policy: AS_BUILT_FIXTURE_POLICY });
    routingMutationSpy.routeResult = { kind: 'halt', haltClass: 'needs-human', detail: 'fixture route refusal' };
    const planBefore = await readFile(join(projectRoot, '.docs', 'plans', 'feature.md'), 'utf8');
    const second = parseChildId(2)!;
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: new AsBuiltResidueRunner(projectRoot),
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({
          kind: 'active' as const, child: second, position: second, isLeaf: true,
          branch: 'feat/daemon-demo', nextChild: undefined,
        }),
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'as-built ADR finding requires residue routing',
      { source: 'architecture-review-as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.json' }] },
    );

    expect(outcome).toMatchObject({ kind: 'halt', detail: 'fixture route refusal' });
    expect(routingMutationSpy.calls).toEqual(['route']);
    expect(await readFile(join(projectRoot, '.docs', 'plans', 'feature.md'), 'utf8')).toBe(planBefore);
  });
});
