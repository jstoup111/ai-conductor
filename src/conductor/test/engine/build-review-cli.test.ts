// Covers: task:2, task:16, task:19, task:27, task:rem-prd-audit-r16-1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { joinBuildReviewRubricOutcomes, parseBuildReviewAggregate, type BuildReviewAggregateInput } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewFinding, type BuildReviewRubricResult } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity, stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { remediationCaseStorePath, RemediationCaseStore, type RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';
import { parseChildId, type ChildId } from '../../src/engine/child-context.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';
import { dispatchBuildReviewAccept, dispatchBuildReviewFindings, dispatchBuildReviewRecordReducedCoverage, dispatchBuildReviewResolveCase } from '../../src/engine/build-review-cli.js';
import { renderExhaustedMechanicalBuildReviewHalt } from '../../src/engine/conductor.js';

vi.mock('../../src/engine/config.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/config.js')>(),
  loadConfig: vi.fn(async () => ({ ok: true as const, config: {}, warnings: [] })),
}));

const lapId = parseBuildReviewLapId('lap-current')!;
const finding = { concernKind: 'test-insensitive', summary: 'A changed test does not observe the behavior it should.', severity: 'minor', evidenceLocations: ['test/a.test.ts:1'], anchor: { rubric: 'testQuality' as const, locus: { path: 'test/a.test.ts', contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', display: 'fixture test' } } } satisfies BuildReviewFinding;
const infrastructureAggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:snapshot',
  results: {
    testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'offline' },
  },
});

const readOnlyReviewUnavailableAggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:read-only-review-unavailable',
  results: {
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:read-only-review-unavailable',
      contractVersion: 'v3', findings: [], verdict: 'PASS',
    },
  },
  customResults: {
    portablePolicy: {
      declaration: {
        version: 'v1', rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
        question: 'Does this preserve the portable policy contract?', source: 'project', resources: ['criteria.md'],
      },
      result: {
        kind: 'infrastructure-failure', rubric: 'portablePolicy', reason: 'read-only-review-unavailable',
        detail: 'No installed provider can perform the required read-only review.',
      },
    },
  },
  currentCustomRubrics: ['portablePolicy'],
} satisfies BuildReviewAggregateInput);

const securityInfrastructureAggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:security',
  results: {
    testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
    security: { kind: 'infrastructure-failure', rubric: 'security', reason: 'provider-error', detail: 'security provider offline' },
  },
});

const aggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:snapshot',
  results: {
    testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [finding], verdict: 'FAIL' },
  },
});

const scopeIncompleteAggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:snapshot',
  results: {
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS',
      scopeResolutions: [{
        candidateId: 'candidate:setup', status: 'indeterminate',
        sourceRegion: { path: 'test/a.test.ts', startLine: 2, endLine: 3, contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'setup binding' },
        obligationReferences: ['story:S6.2'], missingEvidenceReason: 'the pinned binding is incomplete',
      }],
    },
  },
});

const refutedCaseStore: RemediationCaseStoreState = {
  version: 'v1',
  feature: { version: 'v1', repository: '/main', feature: 'review-rubrics' },
  cases: [{
    id: 'case-refuted', domain: 'build_review', disposition: 'refute', priority: 'high',
    rationale: 'The cited assertion is contradicted by the current test.', confidence: 'high', resolution: 'resolved',
    sources: [{ sourceId: 'testQuality:sha256:refuted', outcome: 'refuted', recordedAt: '2026-09-11T12:00:00.000Z' }],
    effect: { kind: 'none' },
    refutation: {
      claim: 'The changed test does not observe the behavior.',
      assertions: [{
        assertion: 'The test omits the observable assertion.', verdict: 'refuted',
        evidence: [{ path: 'test/a.test.ts', excerpt: 'expect(result).toBe(true)' }],
      }, {
        assertion: 'The assertion is reachable.', verdict: 'upheld',
        evidence: [{ path: 'src/a.ts', excerpt: 'return result;' }],
      }],
    },
  }],
};

function aggregateWithTestQuality(result: BuildReviewRubricResult) {
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot', results: { ...infrastructureAggregate.results, testQuality: result },
  });
}

describe('build-review findings CLI', () => {
  let caseRead: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    caseRead = vi.spyOn(RemediationCaseStore.prototype, 'read').mockResolvedValue({
      ok: true, state: { ...refutedCaseStore, cases: [] },
    });
  });

  afterEach(() => {
    caseRead.mockRestore();
  });

  // Covers: task:12
  it('renders refuted autonomous cases separately from operator dispositions in human and JSON output', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const dispositionStore = {
      list: async () => ({ ok: true as const, records: [{
        version: 'v1' as const, feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' },
        finding: identity, sourceLapId: lapId, summary: 'accepted', rationale: 'operator risk', operator: 'operator', acceptedAt: '2026-09-11T12:00:00.000Z',
      }] }), append: vi.fn(),
    };
    const caseStore = { read: async () => ({ ok: true as const, state: refutedCaseStore }) };
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => dispositionStore,
      createCaseStore: () => caseStore, readMechanicalFaults: async () => 0,
    };
    const human = vi.fn();
    const json = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, { ...deps, print: json })).resolves.toBe(0);

    expect(human).toHaveBeenCalledWith(expect.stringMatching(
      /Operator dispositions:[\s\S]*operator risk[\s\S]*Autonomous case outcomes:[\s\S]*case-refuted[\s\S]*disposition: refute[\s\S]*resolution: resolved[\s\S]*testQuality:sha256:refuted[\s\S]*effect: none[\s\S]*The changed test does not observe the behavior\.[\s\S]*The test omits the observable assertion\. \(refuted\)[\s\S]*The assertion is reachable\. \(upheld\)[\s\S]*The cited assertion is contradicted by the current test\./,
    ));
    expect(JSON.parse(json.mock.calls[0]![0])).toMatchObject({
      cases: [{
        id: 'case-refuted', disposition: 'refute', resolution: 'resolved',
        sources: [{ sourceId: 'testQuality:sha256:refuted' }], effect: { kind: 'none' },
        refutation: { claim: 'The changed test does not observe the behavior.', assertions: [
          { assertion: 'The test omits the observable assertion.', verdict: 'refuted' },
          { assertion: 'The assertion is reachable.', verdict: 'upheld' },
        ] }, rationale: 'The cited assertion is contradicted by the current test.',
      }],
      acceptedDispositions: [expect.objectContaining({ disposition: expect.objectContaining({ rationale: 'operator risk' }) })],
    });
  });

  // Covers: task:23
  it('renders child-scoped carried sources, operator resolutions, and pending case-store outbox entries', async () => {
    const originOne = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const originTwo = canonicalizeBuildReviewFindingIdentity({
      ...finding,
      rubric: 'testQuality',
      contractVersion: 'v3',
      anchor: { rubric: 'testQuality', locus: { ...finding.anchor.locus, path: 'test/b.test.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } },
    })!;
    const carried = originOne;
    const origins = [
      { sourceId: `testQuality:${originOne.id}`, lapId: 'lap-origin-one' },
      { sourceId: `testQuality:${originTwo.id}`, lapId: 'lap-origin-two' },
    ];
    const childState: RemediationCaseStoreState = {
      version: 'v3', feature: { version: 'v1', repository: '/main', feature: 'review-rubrics' }, prdWideningCases: [], suppressions: [],
      cases: [{
        ...refutedCaseStore.cases[0]!, id: 'case-carried', disposition: 'reject', rationale: 'Already accepted risk.',
        sources: [{ sourceId: `testQuality:${carried.id}`, outcome: 'carried', recordedAt: '2026-10-22T10:00:00.000Z' }],
        operatorAcceptance: { origins },
      }, {
        ...refutedCaseStore.cases[0]!, id: 'case-operator-resolved', disposition: 'act', rationale: 'Original autonomous case.',
        sources: [{ sourceId: `testQuality:${originOne.id}`, outcome: 'acted', recordedAt: '2026-10-22T10:00:00.000Z' }],
        effect: { id: 'effect-operator-resolved', kind: 'action', status: 'failed', diagnostic: 'Resolved by operator.' },
        operatorResolution: { operator: 'release-operator', rationale: 'The remaining risk is accepted.', resolvedAt: '2026-10-22T11:00:00.000Z' },
      }],
      outbox: [{
        eventId: 'pending-operator-resolution', occurredAt: '2026-10-22T11:00:00.000Z',
        event: { type: 'remediation_case_operator_resolved', eventId: 'pending-operator-resolution', feature: 'review-rubrics', caseId: 'case-operator-resolved', sourceIds: [`testQuality:${originOne.id}`] },
      }],
    };
    const records = [
      { version: 'v1' as const, feature: childState.feature, finding: originOne, sourceLapId: parseBuildReviewLapId('lap-origin-one')!, summary: 'origin one', rationale: 'First accepted risk.', operator: 'first-operator', acceptedAt: '2026-10-20T10:00:00.000Z' },
      { version: 'v1' as const, feature: childState.feature, finding: originTwo, sourceLapId: parseBuildReviewLapId('lap-origin-two')!, summary: 'origin two', rationale: 'Second accepted risk.', operator: 'second-operator', acceptedAt: '2026-10-21T10:00:00.000Z' },
    ];
    const createCaseStore = vi.fn((_worktree: string, _feature: unknown, child?: number) => {
      expect(child).toBe(1);
      return { read: async () => ({ ok: true as const, state: childState }) };
    });
    const human = vi.fn();
    const json = vi.fn();
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records }), append: vi.fn() }),
      createCaseStore, readMechanicalFaults: async () => 0,
    };

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', child: '1', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', child: '1', format: 'json' }, { ...deps, print: json })).resolves.toBe(0);

    const humanOutput = human.mock.calls[0]![0] as string;
    expect(humanOutput).toContain(`Carried source: testQuality:${carried.id}; case: case-carried; origin source ids: testQuality:${originOne.id}, testQuality:${originTwo.id}; origin laps: lap-origin-one, lap-origin-two; origin dispositions: first-operator (First accepted risk.), second-operator (Second accepted risk.)`);
    expect(humanOutput).toContain(`Operator-resolved case: case-operator-resolved; source ids: testQuality:${originOne.id}; operator: release-operator; rationale: The remaining risk is accepted.; resolved at: 2026-10-22T11:00:00.000Z`);
    expect(humanOutput).toContain('Pending case-store outbox entry: pending-operator-resolution');
    expect(JSON.parse(json.mock.calls[0]![0] as string)).toMatchObject({
      carriedSources: [{
        sourceId: `testQuality:${carried.id}`, caseId: 'case-carried', originSourceIds: origins.map((origin) => origin.sourceId), originLapIds: origins.map((origin) => origin.lapId),
        originDispositions: [
          { sourceId: `testQuality:${originOne.id}`, lapId: 'lap-origin-one', operator: 'first-operator', rationale: 'First accepted risk.' },
          { sourceId: `testQuality:${originTwo.id}`, lapId: 'lap-origin-two', operator: 'second-operator', rationale: 'Second accepted risk.' },
        ],
      }],
      operatorResolvedCases: [{ caseId: 'case-operator-resolved', sourceIds: [`testQuality:${originOne.id}`], operator: 'release-operator', rationale: 'The remaining risk is accepted.', resolvedAt: '2026-10-22T11:00:00.000Z' }],
      pendingOutbox: [{ eventId: 'pending-operator-resolution', event: { type: 'remediation_case_operator_resolved' } }],
    });
    expect(createCaseStore).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', childState.feature, 1);
  });

  // Covers: task:23
  it('omits carried and operator-resolved rows when the selected store has neither', async () => {
    const print = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state: { ...refutedCaseStore, cases: [] } }) }),
      readMechanicalFaults: async () => 0, print,
    })).resolves.toBe(0);
    const output = JSON.parse(print.mock.calls[0]![0] as string);
    expect(output).not.toHaveProperty('carriedSources');
    expect(output).not.toHaveProperty('operatorResolvedCases');
    expect(output).not.toHaveProperty('pendingOutbox');
  });

  it('passes the coordinator-equivalent unsettled set for resolved R and open N on S to the CLI verdict', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const sourceId = `testQuality:${identity.id}`;
    const resolved = {
      ...refutedCaseStore.cases[0],
      sources: [{ sourceId, outcome: 'refuted' as const, recordedAt: '2026-10-19T12:00:00.000Z' }],
    };
    const open = {
      ...resolved,
      id: 'case-open', disposition: 'act' as const, resolution: 'open' as const,
      sources: [{ sourceId, outcome: 'acted' as const, recordedAt: '2026-10-20T12:00:00.000Z' }],
      effect: { id: 'case-open-effect', kind: 'action' as const, status: 'reserved' as const },
    };
    caseRead.mockResolvedValue({ ok: true, state: { ...refutedCaseStore, cases: [resolved, open] } });
    const print = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      readMechanicalFaults: async () => 0,
      print,
    })).resolves.toBe(0);

    expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [identity.id] });
  });

  // Covers: task:12
  it.each([
    ['malformed-state', 'malformed-state'],
    ['unknown-version', 'unknown-version'],
  ])('refuses a %s remediation case store instead of omitting autonomous cases', async (_name, reason) => {
    const print = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      createCaseStore: (_worktree, _feature) => ({
        read: async () => ({ ok: false as const, reason: reason as 'malformed-state' | 'unknown-version' }),
      }), print,
    })).resolves.toBe(1);
    expect(print).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`remediation case store.*${reason}`, 'i')));
  });

  // Covers: task:12
  it('reports no autonomous cases when the remediation case store is absent', async () => {
    const print = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state: { ...refutedCaseStore, cases: [] } }) }), print,
    })).resolves.toBe(0);
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Autonomous case outcomes: none'));
  });

  it('records reduced coverage for an interactive resolved local operator using the engine-derived cause', async () => {
    const appendReducedCoverageIfCurrent = vi.fn(async (input, validate) => {
      expect(await validate([])).toBe(true);
      return {
      ok: true as const,
      record: {
        kind: 'reduced-coverage' as const,
        version: 'v1' as const,
        feature: input.feature,
        identity: { rubric: input.rubric, reason: input.reason },
        rationale: input.rationale,
        operator: input.operator,
        acceptedAt: '2026-08-19T12:00:00.000Z',
      },
      };
    });
    const store = { appendReducedCoverageIfCurrent };

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'Provider is unavailable.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(infrastructureAggregate), readMechanicalFaults: async () => 3, createStore: () => store, print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledWith({
      feature: { version: 'v1', repository: '/main', feature: 'review-rubrics' }, rubric: 'testQuality', reason: 'provider-error',
      rationale: 'Provider is unavailable.', operator: 'local-operator',
    }, expect.any(Function));
  });

  // Covers: task:15
  it('records reduced coverage for read-only-review-unavailable before the mechanical-fault ceiling', async () => {
    const appendReducedCoverageIfCurrent = vi.fn(async (input, validate) => {
      expect(await validate([])).toBe(true);
      return {
        ok: true as const,
        record: {
          kind: 'reduced-coverage' as const, version: 'v1' as const, feature: input.feature,
          identity: { rubric: input.rubric, reason: input.reason }, rationale: input.rationale,
          operator: input.operator, acceptedAt: '2026-09-25T00:00:00.000Z',
        },
      };
    });

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'portablePolicy', rationale: 'No provider can enforce the required boundary.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(readOnlyReviewUnavailableAggregate), readMechanicalFaults: async () => 2,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'read-only-review-unavailable', operator: 'local-operator',
    }), expect.any(Function));
  });

  it('accepts the terminal security recovery command and writes its reduced-coverage record', async () => {
    const appendReducedCoverageIfCurrent = vi.fn(async (input, validate) => {
      expect(await validate([])).toBe(true);
      return {
        ok: true as const,
        record: {
          kind: 'reduced-coverage' as const, version: 'v1' as const, feature: input.feature,
          identity: { rubric: input.rubric, reason: input.reason }, rationale: input.rationale,
          operator: input.operator, acceptedAt: '2026-09-16T00:00:00.000Z',
        },
      };
    });
    const print = vi.fn();
    const renderedRecovery = renderExhaustedMechanicalBuildReviewHalt({ mechanicalFaults: 3 }, securityInfrastructureAggregate);

    expect(renderedRecovery).toContain(
      'ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-current --rubric security --rationale "<rationale>".',
    );

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'security', rationale: 'Security provider is unavailable.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(securityInfrastructureAggregate), readMechanicalFaults: async () => 3,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print, appendEvent: vi.fn(),
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledWith(expect.objectContaining({
      rubric: 'security', reason: 'provider-error', operator: 'local-operator',
    }), expect.any(Function));
    expect(print).toHaveBeenCalledWith('build-review record-reduced-coverage: recorded security for lap lap-current.');
  });

  it('records exhausted current scope-incomplete coverage through the existing leased action', async () => {
    const appendReducedCoverageIfCurrent = vi.fn(async (input, validate) => {
      expect(await validate([])).toBe(true);
      return {
        ok: true as const,
        record: {
          kind: 'reduced-coverage' as const, version: 'v1' as const, feature: input.feature,
          identity: { rubric: input.rubric, reason: input.reason }, rationale: input.rationale,
          operator: input.operator, acceptedAt: '2026-09-06T00:00:00.000Z',
        },
      };
    });
    const print = vi.fn();
    const appendEvent = vi.fn();

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'The pinned association cannot be recovered.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(scopeIncompleteAggregate), readMechanicalFaults: async () => 3,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print, appendEvent,
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledWith(expect.objectContaining({
      rubric: 'testQuality', reason: 'scope-incomplete', operator: 'local-operator',
    }), expect.any(Function));
    expect(appendEvent).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', expect.objectContaining({
      type: 'build_review_reduced_coverage_accepted', rubric: 'testQuality', reason: 'scope-incomplete', operator: 'local-operator',
    }));
    expect(print).toHaveBeenCalledWith('build-review record-reduced-coverage: recorded testQuality for lap lap-current.');
  });

  it('reports the committed decision when acceptance telemetry throws', async () => {
    // A recorded finding disposition is durable once
    // appendReducedCoverageIfCurrent commits. An event-writer throw used to
    // fall into the outer refusal path, so the operator saw a failure for a
    // recovery that had actually succeeded — and the retry they were told to
    // make then refused as a duplicate, leaving the command unusable.
    const appendReducedCoverageIfCurrent = vi.fn(async (_input: never, validate: never) => {
      await (validate as unknown as (r: unknown[]) => Promise<boolean>)([]);
      return {
        ok: true as const,
        record: {
          kind: 'reduced-coverage' as const, version: 'v1' as const,
          feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' },
          identity: { rubric: 'testQuality' as const, reason: 'provider-error' as const },
          rationale: 'risk', operator: 'local-operator', acceptedAt: '2026-08-19T12:00:00.000Z',
        },
      };
    });
    const print = vi.fn();

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(infrastructureAggregate), readMechanicalFaults: async () => 3,
      createStore: () => ({ appendReducedCoverageIfCurrent }),
      print,
      appendEvent: () => { throw new Error('closeout event sink unavailable'); },
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledWith(expect.stringContaining('recorded testQuality for lap lap-current'));
  });

  it.each([
    ['judged rubric', aggregateWithTestQuality({ kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' }), 3, [], 'infrastructure failure', false],
    ['skipped rubric', aggregateWithTestQuality({ kind: 'skipped', rubric: 'testQuality', reason: 'disabled' }), 3, [], 'infrastructure failure', false],
    ['remaining allowance', infrastructureAggregate, 2, [], 'allowance', true],
    ['duplicate decision', infrastructureAggregate, 3, [{ kind: 'reduced-coverage' as const, version: 'v1' as const, feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' }, identity: { rubric: 'testQuality' as const, reason: 'provider-error' as const }, rationale: 'already accepted', operator: 'james', acceptedAt: '2026-08-19T12:00:00.000Z' }], 'already recorded', true],
    ['corrected scope', aggregateWithTestQuality({ kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS', scopeResolutions: [{ candidateId: 'candidate:setup', status: 'resolved', sourceRegion: { path: 'test/a.test.ts', startLine: 2, endLine: 3, contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'setup binding' }, obligationReferences: ['story:S6.2'], associationReason: 'Corrected pinned binding proves this candidate.' }] }), 3, [], 'current.*fault', false],
  ])('refuses %s without storing a reduced-coverage decision', async (_caseName, currentAggregate, mechanicalFaults, records, reason, entersLease) => {
    const persisted = [...records];
    const appendReducedCoverageIfCurrent = vi.fn(async (_input, validate) => {
      expect(await validate(records)).toBe(false);
      return { ok: false as const, kind: 'invalid' as const, message: 'not eligible' };
    });
    const print = vi.fn();
    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(currentAggregate), readMechanicalFaults: async () => mechanicalFaults,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print,
    })).resolves.toBe(1);
    expect(print).toHaveBeenCalledWith(expect.stringMatching(new RegExp(reason, 'i')));
    expect(persisted).toEqual(records);
    if (entersLease) expect(appendReducedCoverageIfCurrent).toHaveBeenCalledOnce();
    else expect(appendReducedCoverageIfCurrent).not.toHaveBeenCalled();
  });

  it('refuses an unknown rubric before store access and a replaced review lap inside the lease', async () => {
    const unknownStore = vi.fn();
    const unknownPrint = vi.fn();
    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'unknown', rationale: 'risk',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(infrastructureAggregate), createStore: unknownStore, print: unknownPrint,
    })).resolves.toBe(1);
    expect(unknownStore).not.toHaveBeenCalled();
    expect(unknownPrint).toHaveBeenCalledWith(expect.stringMatching(/not a known rubric/i));

    const nextLap = joinBuildReviewRubricOutcomes({
      lapId: parseBuildReviewLapId('lap-next')!, snapshotDigest: 'sha256:next', results: {
        testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'offline' },
      },
    });
    let reads = 0;
    const appendReducedCoverageIfCurrent = vi.fn(async (_input, validate) => {
      expect(await validate([])).toBe(false);
      return { ok: false as const, kind: 'invalid' as const, message: 'current reduced-coverage state is invalid' };
    });
    const stalePrint = vi.fn();
    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(++reads === 1 ? infrastructureAggregate : nextLap), readMechanicalFaults: async () => 3,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print: stalePrint,
    })).resolves.toBe(1);
    expect(stalePrint).toHaveBeenCalledWith(expect.stringMatching(/review lap changed/i));
  });

  it('refuses non-interactive and unresolvable operators before aggregate or store access', async () => {
    const readFile = vi.fn(async () => JSON.stringify(aggregate));
    const createStore = vi.fn();
    const appendEvent = vi.fn();
    for (const deps of [
      { isInteractive: false, resolveOperator: () => 'local-operator' },
      { isInteractive: true, resolveOperator: () => undefined },
    ]) {
      await expect(dispatchBuildReviewRecordReducedCoverage({
        kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk',
      }, {
        cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
        readFile, createStore, appendEvent, print: vi.fn(), ...deps,
      })).resolves.toBe(1);
    }

    expect(readFile).not.toHaveBeenCalled();
    expect(createStore).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledTimes(2);
    expect(appendEvent).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', expect.objectContaining({
      type: 'build_review_disposition_refused', reason: 'non-interactive-or-unidentified-operator',
    }));
  });

  it('accepts exactly one unresolved finding for a verified interactive operator and leaves siblings untouched', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const append = vi.fn(async (input) => ({
      ok: true as const,
      record: { version: 'v1' as const, ...input, acceptedAt: '2026-08-14T12:00:00.000Z' },
    }));
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append };
    const output = vi.fn();
    const appendEvent = vi.fn();
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, rationale: 'Known migration risk' }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => store, print: output, appendEvent,
    })).resolves.toBe(0);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ sourceLapId: lapId, finding: identity, rationale: 'Known migration risk', operator: 'local-operator' }));
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/accepted/i));
    expect(appendEvent).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', {
      type: 'build_review_disposition_accepted', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, operator: 'local-operator', ts: expect.any(String),
    });
  });

  it('emits the refusal event for piped, unidentified, invalid-input, and stale acceptance attempts before mutating state', async () => {
    const append = vi.fn();
    const store = { list: vi.fn(), append };
    const appendEvent = vi.fn();
    for (const deps of [
      { isInteractive: false, resolveOperator: () => 'local-operator' },
      { isInteractive: true, resolveOperator: () => undefined },
      { isInteractive: true, resolveOperator: () => 'local-operator', readFile: async () => JSON.stringify(aggregate) },
      { isInteractive: true, resolveOperator: () => 'local-operator', readFile: async () => JSON.stringify(aggregate), lapId: 'not a lap' },
      { isInteractive: true, resolveOperator: () => 'local-operator', readFile: async () => JSON.stringify(aggregate), rationale: ' ' },
    ]) {
      const { lapId = 'lap-stale', rationale = 'risk', ...overrides } = deps;
      await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId, findingId: 'sha256:unknown', rationale }, {
        cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path, createStore: () => store, print: vi.fn(), appendEvent, ...overrides,
      })).resolves.toBe(1);
    }
    expect(append).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledTimes(5);
    expect(appendEvent).toHaveBeenNthCalledWith(1, '/main/.worktrees/review-rubrics', expect.objectContaining({
      type: 'build_review_disposition_refused', feature: 'review-rubrics', ts: expect.any(String),
    }));
  });

  it('refuses malformed state, lock failure, and a replacement lap observed after waiting for the shared store', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const nextLap = { ...aggregate, lapId: parseBuildReviewLapId('lap-next')!, results: { ...aggregate.results, testQuality: { ...aggregate.results.testQuality, lapId: parseBuildReviewLapId('lap-next')! } } };
    const append = vi.fn();
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append };
    let reads = 0;
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, rationale: 'risk' }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(++reads === 1 ? aggregate : nextLap), createStore: () => store, print: vi.fn(),
    })).resolves.toBe(1);
    expect(append).not.toHaveBeenCalled();

    const locked = { list: vi.fn(async () => ({ ok: false as const, kind: 'lock' as const, message: 'occupied' })), append };
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, rationale: 'risk' }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => locked, print: vi.fn(),
    })).resolves.toBe(1);
    expect(append).not.toHaveBeenCalled();
  });

  it('reads the canonical feature worktree and deterministically renders raw, accepted, unresolved, skipped, and infrastructure state', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const print = vi.fn();
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [{ version: 'v1' as const, feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' }, finding: identity, sourceLapId: lapId, summary: 'accepted', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T12:00:00.000Z' }] })), append: vi.fn() };
    const readFile = vi.fn(async (_path: string) => JSON.stringify(aggregate));

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main/.worktrees/review-rubrics', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile, createStore: () => store, print,
    })).resolves.toBe(0);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      '/main/.worktrees/review-rubrics/.pipeline/build-review.json',
    ]);
    expect(store.list).toHaveBeenCalledWith({ version: 'v1', repository: '/main', feature: 'review-rubrics' });
    expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({
      feature: 'review-rubrics', lapId: 'lap-current', rawVerdict: 'FAIL', verdict: 'PASS',
      acceptedFindingIds: [identity.id], unresolvedFindingIds: [], skippedRubrics: ['security', 'implementationQuality'], infrastructureFailureRubrics: [],
      acceptedDispositions: [{
        findingId: identity.id,
        disposition: expect.objectContaining({
          sourceLapId: 'lap-current', summary: 'accepted', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T12:00:00.000Z',
        }),
      }],
    });

    const humanPrint = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      cwd: '/main/.worktrees/review-rubrics', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile, createStore: () => store, print: humanPrint,
    })).resolves.toBe(0);
    expect(humanPrint).toHaveBeenCalledWith(expect.stringContaining(
      `Accepted disposition: ${identity.id} (lap lap-current; operator operator; rationale: risk)`,
    ));
  });

  it('reports an exhausted mechanical fault separately from unresolved findings in machine and human output', async () => {
    const faultOnly = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: {
        testQuality: { kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'offline' },
      },
    });
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(faultOnly), readMechanicalFaults: async () => 3, createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
    };
    const machine = vi.fn();
    const human = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, { ...deps, print: machine })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);

    expect({ machine: JSON.parse(machine.mock.calls[0]![0]), human: human.mock.calls[0]![0] }).toEqual({
      machine: expect.objectContaining({
        verdict: 'FAIL', unresolvedFindingIds: [],
        exhaustedMechanicalFaults: [{ rubric: 'testQuality', cause: 'provider-error', diagnostic: 'offline' }],
      }),
      human: expect.stringMatching(/Blocked by exhausted mechanical faults, not unresolved findings\.[\s\S]*Exhausted mechanical fault: testQuality; cause: provider-error; diagnostic: offline/),
    });
  });

  it('renders the ledger\'s last mechanical fault only when the record is present', async () => {
    const fault = { rubric: 'testQuality' as const, reason: 'malformed-artifact' as const, detail: 'response omitted a verdict', lapId: 'lap-rejected' };
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(infrastructureAggregate), createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      readKickbackGateEntry: async () => ({ mechanicalFaults: 1, lastMechanicalFault: fault }),
    };
    const machine = vi.fn();
    const human = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, { ...deps, print: machine })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);

    const machineOutput = JSON.parse(machine.mock.calls[0]![0]);
    expect(machineOutput.lastMechanicalFault).toEqual(fault);
    expect(Object.keys(machineOutput).sort()).toEqual([
      'acceptedDispositions', 'acceptedFindingIds', 'cases', 'feature', 'infrastructureFailureRubrics', 'lapId', 'lastMechanicalFault',
      'rawVerdict', 'skippedRubrics', 'snapshotDigest', 'suppressedFindingIds', 'unresolvedFindingIds', 'verdict',
    ]);
    expect(human).toHaveBeenCalledWith(expect.stringContaining(
      'Last mechanical fault: testQuality; cause: malformed-artifact; lap: lap-rejected; diagnostic: response omitted a verdict',
    ));
  });

  it('does not label a mixed lap exhausted while allowance remains, and applies recorded reduced coverage to its effective verdict', async () => {
    const print = vi.fn();
    const decision = {
      kind: 'reduced-coverage' as const, version: 'v1' as const,
      feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' },
      identity: { rubric: 'testQuality' as const, reason: 'provider-error' as const },
      rationale: 'approved', operator: 'operator', acceptedAt: '2026-08-20T00:00:00.000Z',
    };
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), readMechanicalFaults: async () => 2,
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        listReducedCoverage: async () => ({ ok: true as const, records: [decision] }),
        append: vi.fn(),
      }),
      print,
    })).resolves.toBe(0);
    expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [expect.any(String)] });
    expect(JSON.parse(print.mock.calls[0]![0]).exhaustedMechanicalFaults).toBeUndefined();
  });

  it('keeps a report without a ledger fault byte-identical to the existing output', async () => {
    const faultFree = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: {
        testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' },
      },
    });
    const machine = vi.fn();
    const human = vi.fn();
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(faultFree), createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      readKickbackGateEntry: async () => ({ mechanicalFaults: 0 }),
    };

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      ...deps, print: machine,
    })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      ...deps, print: human,
    })).resolves.toBe(0);

    expect(machine).toHaveBeenCalledWith(JSON.stringify({
      feature: 'review-rubrics', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot', rawVerdict: 'PASS', verdict: 'PASS',
      acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [], skippedRubrics: ['security', 'implementationQuality'], infrastructureFailureRubrics: [], acceptedDispositions: [],
      cases: [],
    }));
    expect(JSON.parse(machine.mock.calls[0]![0])).not.toHaveProperty('lastMechanicalFault');
    expect(human).toHaveBeenCalledWith([
      'Build review findings: review-rubrics', 'Lap: lap-current', 'Raw verdict: PASS', 'Effective verdict: PASS',
      'Accepted findings: none', 'Operator dispositions: none', 'Autonomous case outcomes: none', 'Unresolved findings: none', 'Advisory build-review findings: none', 'Skipped rubrics: security, implementationQuality', 'Infrastructure failures: none',
    ].join('\n'));
  });

  it('does not publish uncovered scope routing state in machine findings output', async () => {
    const scopeIncomplete = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: {
        testQuality: {
          kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS',
          scopeResolutions: [{
            candidateId: 'candidate:setup', status: 'indeterminate',
            sourceRegion: { path: 'test/a.test.ts', startLine: 2, endLine: 3, contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'setup binding' },
            obligationReferences: ['story:S6.2'], missingEvidenceReason: 'the pinned binding is incomplete',
          }],
        },
      },
    });
    const print = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(scopeIncomplete), createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }), print,
    })).resolves.toBe(0);

    const output = JSON.parse(print.mock.calls[0]![0]);
    expect(output).toMatchObject({ verdict: 'FAIL', scopeIncompleteRubrics: ['testQuality'] });
    expect(output).not.toHaveProperty('uncoveredScopeIncompleteRubrics');
  });

  it('uses the live runner canonical identity for both findings reads and acceptance writes through an alternate main root', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
    const realpath = async (path: string) => path
      .replace('/alternate-main', '/canonical-main');
    const findingsStore = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append: vi.fn() };
    const readFile = vi.fn(async (_path: string) => JSON.stringify(aggregate));
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/alternate-main', resolveMainRoot: async () => '/alternate-main', realpath,
      readFile, createStore: () => findingsStore, print: vi.fn(),
    })).resolves.toBe(0);
    expect(readFile).toHaveBeenCalledWith('/canonical-main/.worktrees/review-rubrics/.pipeline/build-review.json');
    expect(findingsStore.list).toHaveBeenCalledWith({ version: 'v1', repository: '/canonical-main', feature: 'review-rubrics' });

    const append = vi.fn(async (input) => ({ ok: true as const, record: { version: 'v1' as const, ...input, acceptedAt: '2026-08-14T12:00:00.000Z' } }));
    const acceptanceStore = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append };
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, rationale: 'Known migration risk' }, {
      cwd: '/alternate-main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/alternate-main', realpath,
      readFile: async () => JSON.stringify(aggregate), createStore: () => acceptanceStore, print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);
    expect(acceptanceStore.list).toHaveBeenCalledWith({ version: 'v1', repository: '/canonical-main', feature: 'review-rubrics' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      feature: { version: 'v1', repository: '/canonical-main', feature: 'review-rubrics' },
    }));
  });

  it('rejects unavailable or mismatched canonical identities before reading or mutating disposition state', async () => {
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append: vi.fn() };
    const unavailable = { resolveMainRoot: async () => { throw new Error('no main root'); }, realpath: async (path: string) => path };
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', ...unavailable, createStore: () => store, readFile: async () => JSON.stringify(aggregate), print: vi.fn(),
    })).resolves.toBe(1);
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: 'sha256:unknown', rationale: 'risk' }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', ...unavailable, createStore: () => store, readFile: async () => JSON.stringify(aggregate), print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(1);

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path.replace('review-rubrics', 'other-feature'),
      createStore: () => store, readFile: async () => JSON.stringify(aggregate), print: vi.fn(),
    })).resolves.toBe(1);
    expect(store.list).not.toHaveBeenCalled();
    expect(store.append).not.toHaveBeenCalled();
  });

  it('fails closed for absent, malformed, or mismatched current feature state without writing or booting a pipeline', async () => {
    const print = vi.fn();
    const readFile = vi.fn(async () => '{bad json');
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path, readFile, print,
    })).resolves.toBe(1);
    expect(print).toHaveBeenCalledWith(expect.stringMatching(/invalid or unavailable/i));
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('fails closed on malformed state and cannot apply records outside the canonical feature identity', async () => {
    const malformedPrint = vi.fn();
    const malformedStore = { list: vi.fn(async () => ({ ok: false as const, kind: 'invalid' as const, message: 'dispositions are malformed' })), append: vi.fn() };
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => malformedStore, print: malformedPrint,
    })).resolves.toBe(1);
    expect(malformedPrint).toHaveBeenCalledWith(expect.stringMatching(/invalid or unavailable/i));

    const print = vi.fn();
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append: vi.fn() };
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => store, print,
    })).resolves.toBe(0);
    expect(store.list).toHaveBeenCalledWith({ version: 'v1', repository: '/main', feature: 'review-rubrics' });
    expect(JSON.parse(print.mock.calls[0]![0]).acceptedFindingIds).toEqual([]);
  });
});

describe('build-review accept', () => {
  const testQualityFinding = {
    concernKind: 'test-insensitive',
    summary: 'the assertion cannot fail',
    evidenceLocations: ['test/widget.test.ts:12'],
    anchor: {
      rubric: 'testQuality' as const,
      locus: {
        path: 'test/widget.test.ts',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        display: 'widget persists state',
      },
    },
  };
  const testQualityAggregate = joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot',
    results: {
      testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [testQualityFinding], verdict: 'FAIL' },
    },
  });
  const testQualityIdentity = canonicalizeBuildReviewFindingIdentity({
    rubric: 'testQuality', contractVersion: 'v3', concernKind: testQualityFinding.concernKind, anchor: testQualityFinding.anchor,
  })!;

  it('suppresses configured sub-floor findings in findings output and refuses to accept them', async () => {
    const lowConfidenceFinding = { ...testQualityFinding, confidence: 60 };
    const lowConfidenceAggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: {
        testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [lowConfidenceFinding], verdict: 'FAIL' },
      },
    });
    const print = vi.fn();
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append: vi.fn() };
    const config = vi.fn(async () => ({ ok: true as const, config: { build_review: { rubrics: { testQuality: { min_confidence: 70 } } } }, warnings: [] }));
    const shared = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(lowConfidenceAggregate), createStore: () => store,
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state: { ...refutedCaseStore, cases: [] } }) }), loadConfig: config, print,
    };

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, shared)).resolves.toBe(0);
    expect(JSON.parse(print.mock.calls[0]![0] as string)).toMatchObject({
      verdict: 'PASS', unresolvedFindingIds: [], suppressedFindingIds: [testQualityIdentity.id],
    });

    print.mockClear();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: testQualityIdentity.id, rationale: 'Accepted risk' },
      { ...shared, isInteractive: true, resolveOperator: () => 'local-operator', appendEvent: vi.fn() },
    )).resolves.toBe(1);
    expect(config).toHaveBeenNthCalledWith(1, '/main/.worktrees/review-rubrics');
    expect(config).toHaveBeenNthCalledWith(2, '/main/.worktrees/review-rubrics');
    expect(store.append).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledWith(expect.stringContaining('not actionable'));
  });

  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-accept-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator',
      resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(testQualityAggregate),
      createStore: () => new BuildReviewDispositionStore(root),
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state: { ...refutedCaseStore, cases: [] } }) }),
      appendEvent: vi.fn(),
      ...overrides,
    };
  }

  it('accepts a current test-quality finding through the real disposition store and reports it accepted', async () => {
    const print = vi.fn();
    const appendEvent = vi.fn();

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: testQualityIdentity.id, rationale: 'Accepted risk' },
      deps({ print, appendEvent }),
    )).resolves.toBe(0);

    expect(print).toHaveBeenCalledWith(`build-review accept: accepted ${testQualityIdentity.id} for lap lap-current.`);
    expect(appendEvent).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', expect.objectContaining({
      type: 'build_review_disposition_accepted', findingId: testQualityIdentity.id,
    }));

    const findings = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, deps({ print: findings }))).resolves.toBe(0);
    expect(JSON.parse(findings.mock.calls[0]![0] as string)).toMatchObject({
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [testQualityIdentity.id], unresolvedFindingIds: [],
      acceptedDispositions: [{ findingId: testQualityIdentity.id }],
    });
  });

  it('accepts one current custom finding through the existing operator CLI operation', async () => {
    const declaration = {
      version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
      question: 'Does this preserve the portable policy contract?', source: 'project' as const, resources: ['criteria.md'],
    };
    const stamp = {
      rubric: 'portablePolicy', lapId: 'lap-current', declaration,
      policy: { version: 'v1' as const, bundleDigest: `sha256:${'c'.repeat(64)}` },
      candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
      reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'d'.repeat(64)}` },
    };
    const references = {
      sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: `sha256:${'a'.repeat(64)}`, display: 'public boundary' }],
    };
    const judged = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v2', findings: [{
        concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.', severity: 'minor',
        evidenceLocations: ['src/widget.ts:8'], sourceRegions: references.sourceRegions,
      }],
    }, stamp, references)!;
    const customInput = {
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3' as const, findings: [], verdict: 'PASS' as const } },
      customResults: {
        portablePolicy: {
          descriptor: {
            version: 'v1' as const, semanticSkill: 'portable-policy', declaration,
            installation: { source: 'project' as const }, effectivePolicy: stamp.policy,
            reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
          },
          result: judged,
        },
      },
      currentCustomRubrics: ['portablePolicy'],
    } satisfies BuildReviewAggregateInput;
    const customAggregate = joinBuildReviewRubricOutcomes(customInput);
    const removedFromCurrentCatalog = joinBuildReviewRubricOutcomes({
      ...customInput,
      currentCustomRubrics: [],
    });
    const findingId = judged.findings[0]!.identity.id;

    let reads = 0;
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId, rationale: 'Stale portability risk' },
      deps({ readFile: async () => JSON.stringify(++reads === 1 ? customAggregate : removedFromCurrentCatalog) }),
    )).resolves.toBe(1);
    await expect(new BuildReviewDispositionStore(root).list({ version: 'v1', repository: '/main', feature: 'review-rubrics' })).resolves.toMatchObject({
      ok: true, records: [],
    });

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId, rationale: 'Known portability risk' },
      deps({ readFile: async () => JSON.stringify(customAggregate) }),
    )).resolves.toBe(0);

    const stored = await new BuildReviewDispositionStore(root).list({ version: 'v1', repository: '/main', feature: 'review-rubrics' });
    expect(stored).toMatchObject({ ok: true, records: [expect.objectContaining({ finding: expect.objectContaining({ id: findingId }) })] });

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId, rationale: 'Repeated risk' },
      deps({ readFile: async () => JSON.stringify(customAggregate) }),
    )).resolves.toBe(1);
    const afterDuplicate = await new BuildReviewDispositionStore(root).list({ version: 'v1', repository: '/main', feature: 'review-rubrics' });
    expect(afterDuplicate).toMatchObject({ ok: true, records: [expect.anything()] });
  });

  it('records custom reduced coverage with the declaration and reason derived from the current engine state', async () => {
    const declaration = {
      version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
      question: 'Does this preserve the portable policy contract?', source: 'project' as const, resources: ['criteria.md'],
    };
    const customFailure = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3' as const, findings: [], verdict: 'PASS' as const } },
      customResults: {
        portablePolicy: {
          declaration,
          result: { kind: 'infrastructure-failure' as const, rubric: 'portablePolicy', reason: 'policy-load-failed' as const, detail: 'policy could not be loaded' },
        },
      },
      currentCustomRubrics: ['portablePolicy'],
    } satisfies BuildReviewAggregateInput);
    const command = {
      kind: 'record-reduced-coverage' as const, feature: 'review-rubrics', lapId: 'lap-current', rubric: 'portablePolicy', rationale: 'The policy loader is unavailable.',
    };
    const removedFromCurrentCatalog = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: customFailure.results,
      customResults: customFailure.customResults,
      currentCustomRubrics: [],
    });

    await expect(dispatchBuildReviewRecordReducedCoverage(command, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(removedFromCurrentCatalog), readMechanicalFaults: async () => 3,
      createStore: () => new BuildReviewDispositionStore(root), print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(1);
    await expect(new BuildReviewDispositionStore(root).listReducedCoverage({ version: 'v1', repository: '/main', feature: 'review-rubrics' })).resolves.toMatchObject({
      ok: true, records: [],
    });

    await expect(dispatchBuildReviewRecordReducedCoverage(command, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(customFailure), readMechanicalFaults: async () => 3,
      createStore: () => new BuildReviewDispositionStore(root), print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);

    const store = new BuildReviewDispositionStore(root);
    const stored = await store.listReducedCoverage({ version: 'v1', repository: '/main', feature: 'review-rubrics' });
    expect(stored).toMatchObject({ ok: true, records: [expect.objectContaining({ identity: { declaration, reason: 'policy-load-failed' } })] });
    await expect(dispatchBuildReviewRecordReducedCoverage(command, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(customFailure), readMechanicalFaults: async () => 3,
      createStore: () => store, print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(1);
    await expect(store.listReducedCoverage({ version: 'v1', repository: '/main', feature: 'review-rubrics' })).resolves.toMatchObject({
      ok: true, records: [expect.anything()],
    });
  });

  it('refuses a custom reduced-coverage decision when its subject disappears while the effect lease is held', async () => {
    const declaration = {
      version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
      question: 'Does this preserve the portable policy contract?', source: 'project' as const, resources: [],
    };
    const current = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3' as const, findings: [], verdict: 'PASS' as const } },
      customResults: { portablePolicy: { declaration, result: { kind: 'infrastructure-failure' as const, rubric: 'portablePolicy', reason: 'policy-load-failed' as const, detail: 'policy could not be loaded' } } },
      currentCustomRubrics: ['portablePolicy'],
    } satisfies BuildReviewAggregateInput);
    const noLongerCurrent = joinBuildReviewRubricOutcomes({ ...current, currentCustomRubrics: [] });
    let reads = 0;
    const appendReducedCoverageIfCurrent = vi.fn(async (_input, validate) => {
      expect(await validate([])).toBe(false);
      return { ok: false as const, kind: 'invalid' as const, message: 'the reviewed subject changed' };
    });

    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'portablePolicy', rationale: 'The loader is unavailable.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(++reads === 1 ? current : noLongerCurrent), readMechanicalFaults: async () => 3,
      createStore: () => ({ appendReducedCoverageIfCurrent }), print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(1);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledTimes(1);
  });

  it('names the failed check in the refusal and in its event reason', async () => {
    const refusals: Array<{ readonly reason: string; readonly message: string }> = [];
    const collect = () => {
      let reason = '';
      return {
        appendEvent: (_root: string, event: { type: string; reason?: string }) => { reason = event.reason ?? ''; },
        print: (message: string) => refusals.push({ reason, message }),
      };
    };

    const unreadable = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: testQualityIdentity.id, rationale: 'risk' },
      deps({ readFile: async () => 'not json', ...unreadable }),
    )).resolves.toBe(1);

    const staleLap = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-previous', findingId: testQualityIdentity.id, rationale: 'risk' },
      deps({ ...staleLap }),
    )).resolves.toBe(1);

    const unknownFinding = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: 'sha256:unknown', rationale: 'risk' },
      deps({ ...unknownFinding }),
    )).resolves.toBe(1);

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: testQualityIdentity.id, rationale: 'risk' },
      deps({ print: vi.fn() }),
    )).resolves.toBe(0);
    const alreadyAccepted = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: testQualityIdentity.id, rationale: 'risk' },
      deps({ ...alreadyAccepted }),
    )).resolves.toBe(1);

    expect(refusals.map(({ reason }) => reason)).toEqual([
      'aggregate-unreadable', 'requested-lap-not-current', 'finding-not-current', 'disposition-store-invalid',
    ]);
    expect(refusals[0]!.message).toContain('aggregate is missing or malformed');
    expect(refusals[1]!.message).toContain("is not the current lap ('lap-current')");
    expect(refusals[2]!.message).toContain('is not a current judged finding');
    expect(refusals[3]!.message).toContain('the disposition store rejected the acceptance');
    expect(new Set(refusals.map(({ message }) => message)).size).toBe(4);
  });
});

describe('build-review findings with current custom rubrics', () => {
  const feature = { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' };
  const declaration = {
    version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
    question: 'Does this preserve the portable policy contract?', source: 'project' as const, resources: ['criteria.md'],
  };
  const stamp = {
    rubric: 'portablePolicy', lapId: 'lap-current', declaration,
    policy: { version: 'v1' as const, bundleDigest: `sha256:${'c'.repeat(64)}` },
    candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
    reviewedInput: { version: 'v1' as const, contentDigest: `sha256:${'d'.repeat(64)}` },
  };
  const references = {
    sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: `sha256:${'a'.repeat(64)}`, display: 'public boundary' }],
  };
  const passingBuiltin = { testQuality: { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3' as const, findings: [], verdict: 'PASS' as const } };

  function customJudgedAggregate(input: { readonly confidence?: number; readonly severity?: 'critical' | 'major' | 'minor' | 'nit' } = {}) {
    const finding = {
      concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
      evidenceLocations: ['src/widget.ts:8'], sourceRegions: references.sourceRegions,
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    };
    const judged = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v2', findings: [{ ...finding, severity: input.severity ?? 'minor' }],
    }, stamp, references)!;
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: passingBuiltin,
      customResults: {
        portablePolicy: {
          descriptor: {
            version: 'v1' as const, semanticSkill: 'portable-policy', declaration,
            installation: { source: 'project' as const }, effectivePolicy: stamp.policy,
            reviewedInput: stamp.reviewedInput, producer: stamp.candidate,
          },
          result: judged,
        },
      },
      currentCustomRubrics: ['portablePolicy'],
    } satisfies BuildReviewAggregateInput);
    return { aggregate, identity: judged.findings[0]!.identity };
  }

  function findingsDeps(aggregate: unknown, overrides: Record<string, unknown> = {}) {
    return {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(aggregate),
      createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state: { ...refutedCaseStore, cases: [] } }) }),
      readMechanicalFaults: async () => 0,
      ...overrides,
    };
  }

  async function jsonFindings(deps: Record<string, unknown>) {
    const print = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, { ...deps, print })).resolves.toBe(0);
    return JSON.parse(print.mock.calls[0]![0] as string) as Record<string, unknown>;
  }

  it('fails the effective verdict on an unresolved custom finding while built-in rubrics pass', async () => {
    const { aggregate, identity } = customJudgedAggregate({ severity: 'minor' });

    const output = await jsonFindings(findingsDeps(aggregate));

    expect(output).toMatchObject({ verdict: 'FAIL', unresolvedFindingIds: [identity.id], acceptedFindingIds: [] });
    expect(output).not.toHaveProperty('uncoveredInfrastructureFailureRubrics');
    expect(output).not.toHaveProperty('uncoveredScopeIncompleteRubrics');
  });

  it('renders the operator disposition of an accepted custom finding', async () => {
    const { aggregate, identity } = customJudgedAggregate();
    const record = {
      version: 'v1' as const, feature, finding: identity, sourceLapId: 'lap-current',
      operator: 'local-operator', rationale: 'Known portability risk', recordedAt: '2026-09-11T12:00:00.000Z',
    };
    const store = { list: async () => ({ ok: true as const, records: [record] }) };

    const output = await jsonFindings(findingsDeps(aggregate, { createStore: () => store }));

    expect(output).toMatchObject({
      verdict: 'PASS', unresolvedFindingIds: [], acceptedFindingIds: [identity.id],
      acceptedDispositions: [{ findingId: identity.id, disposition: { operator: 'local-operator', rationale: 'Known portability risk' } }],
    });
  });

  it('suppresses a custom finding below the floor its own catalog entry declares', async () => {
    const { aggregate, identity } = customJudgedAggregate({ confidence: 60, severity: 'minor' });
    const loadConfig = async () => ({
      ok: true as const, warnings: [],
      config: { build_review: { custom_rubrics: { portablePolicy: { skill: 'portable-policy', enabled: true, question: declaration.question, min_confidence: 70 } } } },
    });

    const output = await jsonFindings(findingsDeps(aggregate, { loadConfig }));

    expect(output).toMatchObject({ verdict: 'PASS', unresolvedFindingIds: [], suppressedFindingIds: [identity.id] });
  });

  // Covers: task:16, task:rem-prd-audit-r16-1, task:rem-prd-audit-r16-2, task:rem-as-built-r16-3
  it('projects threshold and adjudicated advisory findings with their source metadata and renders their local advisory details', async () => {
    const adjudicated = customJudgedAggregate({ severity: 'critical' });
    const thresholdFinding = {
      concernKind: 'test-insensitive', summary: 'The minor finding is below the configured threshold.', severity: 'minor' as const,
      evidenceLocations: ['test/a.test.ts:1'], anchor: finding.anchor,
    };
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot',
      results: {
        testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v4', findings: [thresholdFinding], verdict: 'FAIL' },
      },
      customResults: adjudicated.aggregate.customResults,
      currentCustomRubrics: ['portablePolicy'],
    });
    const thresholdId = canonicalizeBuildReviewFindingIdentity({ ...thresholdFinding, rubric: 'testQuality', contractVersion: 'v4' })!.id;
    const adjudicatedId = adjudicated.identity.id;
    const state: RemediationCaseStoreState = {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-advisory', domain: 'build_review', disposition: 'advisory', priority: 'low',
        rationale: 'The reviewer downgraded this finding.', confidence: 'high', resolution: 'resolved',
        sources: [{ sourceId: `portablePolicy:${adjudicatedId}`, outcome: 'advisory', recordedAt: '2026-10-23T00:00:00.000Z' }],
        effect: { kind: 'none' }, adjudicatedSeverity: 'nit',
      }],
    };
    const output = await jsonFindings(findingsDeps(aggregate, {
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state }) }),
      loadConfig: async () => ({
        ok: true as const, warnings: [],
        config: { build_review: { custom_rubrics: {
          portablePolicy: { skill: 'portable-policy', enabled: true, question: declaration.question, min_severity: 'minor' },
        }, rubrics: { testQuality: { min_severity: 'major' } } } },
      }),
    }));

    expect(output).toMatchObject({
      advisoryFindings: [
        { id: thresholdId, rubric: 'testQuality', severity: 'minor', threshold: 'major', origin: 'threshold' },
        { id: adjudicatedId, rubric: 'portablePolicy', severity: 'nit', threshold: 'minor', origin: 'adjudicated' },
      ],
    });
    expect(JSON.stringify(output)).not.toContain('The reviewer downgraded this finding.');

    const human = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      ...findingsDeps(aggregate, {
        createCaseStore: () => ({ read: async () => ({ ok: true as const, state }) }),
        loadConfig: async () => ({
          ok: true as const, warnings: [],
          config: { build_review: { custom_rubrics: {
            portablePolicy: { skill: 'portable-policy', enabled: true, question: declaration.question, min_severity: 'minor' },
          }, rubrics: { testQuality: { min_severity: 'major' } } } },
        }),
      }),
      print: human,
    })).resolves.toBe(0);

    expect(human).toHaveBeenCalledWith(expect.stringContaining(
      `Advisory finding: ${thresholdId}; rubric: testQuality; severity: minor; summary: The minor finding is below the configured threshold.`,
    ));
    expect(human).toHaveBeenCalledWith(expect.stringContaining(
      `Advisory finding: ${adjudicatedId}; rubric: portablePolicy; severity: nit; summary: The changed boundary lacks compatibility evidence.; adjudicator rationale: The reviewer downgraded this finding.`,
    ));
  });

  // Covers: task:rem-as-built-rem-as-built-r16-4
  it('reports a carried source attached to an operator-resolved advisory case only as carried', async () => {
    const { aggregate, identity } = customJudgedAggregate({ severity: 'critical' });
    const sourceId = `portablePolicy:${identity.id}`;
    const state: RemediationCaseStoreState = {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-carried-advisory', domain: 'build_review', disposition: 'advisory', priority: 'low',
        rationale: 'This source was already carried by the operator.', confidence: 'high', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'carried', recordedAt: '2026-10-23T00:00:00.000Z' }],
        effect: { kind: 'none' }, adjudicatedSeverity: 'nit',
        operatorResolution: { operator: 'release-operator', rationale: 'The carried risk remains accepted.', resolvedAt: '2026-10-23T01:00:00.000Z' },
      }],
    };
    const loadConfig = async () => ({
      ok: true as const, warnings: [],
      config: { build_review: { custom_rubrics: {
        portablePolicy: { skill: 'portable-policy', enabled: true, question: declaration.question, min_severity: 'minor' },
      } } },
    });

    const output = await jsonFindings(findingsDeps(aggregate, {
      createCaseStore: () => ({ read: async () => ({ ok: true as const, state }) }),
      loadConfig,
    }));

    expect(output).toMatchObject({ carriedSources: [{ sourceId, caseId: 'case-carried-advisory' }] });
    expect(output).not.toHaveProperty('advisoryFindings');

    const human = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, {
      ...findingsDeps(aggregate, {
        createCaseStore: () => ({ read: async () => ({ ok: true as const, state }) }),
        loadConfig,
      }),
      print: human,
    })).resolves.toBe(0);

    const humanOutput = human.mock.calls[0]![0] as string;
    expect(humanOutput).toContain(`Carried source: ${sourceId}; case: case-carried-advisory;`);
    expect(humanOutput).not.toContain(`Advisory finding: ${identity.id};`);
  });

  // Covers: task:16, task:rem-prd-audit-r16-1
  it('reads persisted v3 and custom-v1 findings with no severity without creating advisories', async () => {
    const builtin = {
      concernKind: 'test-insensitive', summary: 'The legacy finding has no severity.', evidenceLocations: ['test/a.test.ts:1'],
      anchor: finding.anchor,
    };
    const custom = customJudgedAggregate({ severity: 'minor' }).aggregate;
    const persisted = structuredClone(joinBuildReviewRubricOutcomes({
      ...custom,
      results: {
        testQuality: { kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [builtin], verdict: 'FAIL' },
      },
    }));
    const customResult = persisted.customResults!.portablePolicy!.result;
    if (customResult.kind !== 'judged') throw new Error('expected a persisted custom judged result');
    delete (customResult.findings[0] as { severity?: unknown }).severity;
    const aggregate = parseBuildReviewAggregate(persisted)!;

    const output = await jsonFindings(findingsDeps(aggregate));

    expect([output.verdict, Object.hasOwn(output, 'advisoryFindingIds'), Object.hasOwn(output, 'advisoryFindings')]).toEqual(['FAIL', false, false]);
  });

  it('reports an exhausted custom infrastructure failure and fails the effective verdict', async () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: passingBuiltin,
      customResults: {
        portablePolicy: {
          declaration,
          result: { kind: 'infrastructure-failure' as const, rubric: 'portablePolicy', reason: 'policy-load-failed' as const, detail: 'policy could not be loaded' },
        },
      },
      currentCustomRubrics: ['portablePolicy'],
    } satisfies BuildReviewAggregateInput);

    const output = await jsonFindings(findingsDeps(aggregate, { readMechanicalFaults: async () => 3 }));

    expect(output).toMatchObject({
      verdict: 'FAIL',
      exhaustedMechanicalFaults: [{ rubric: 'portablePolicy', cause: 'policy-load-failed', diagnostic: 'policy could not be loaded' }],
    });
    await expect(jsonFindings(findingsDeps(aggregate, { readMechanicalFaults: async () => 2 }))).resolves.not.toHaveProperty('exhaustedMechanicalFaults');
  });
});

describe('build-review resolve-case', () => {
  const feature = { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' };

  async function openCaseStore(root: string, child?: ChildId) {
    const caseStore = new RemediationCaseStore(root, feature, { child });
    await caseStore.mutate(async (state) => ({
      value: undefined,
      nextState: {
        ...state,
        cases: [{
          id: 'case-open', domain: 'build_review', disposition: 'act', priority: 'high',
          rationale: 'Missing behavioral coverage.', confidence: 'high', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: '2026-10-22T12:00:00.000Z' }],
          effect: { id: 'effect-open', kind: 'action', status: 'reserved' },
        }],
      },
    }));
    return caseStore;
  }

  function command(child?: string) {
    return {
      kind: 'resolve-case' as const, feature: 'review-rubrics', caseId: 'case-open', rationale: 'Accepted for this release.',
      ...(child === undefined ? {} : { child }),
    };
  }

  function deps(caseStore: RemediationCaseStore, overrides: Record<string, unknown> = {}) {
    return {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator',
      resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      createCaseStore: () => caseStore, print: vi.fn(), now: () => new Date('2026-10-22T13:00:00.000Z'),
      ...overrides,
    };
  }

  it('resolves an open remediation case for a verified interactive operator', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-resolve-case-'));
    const caseStore = await openCaseStore(root);
    const print = vi.fn();
    const eventPath = join(root, '.pipeline', 'events.jsonl');
    await writeFile(eventPath, '{"type":"existing"}\n');

    try {
      const result = await dispatchBuildReviewResolveCase(command(), deps(caseStore, { print }));
      const stored = await caseStore.read();

      expect({ result, stored, events: await readFile(eventPath, 'utf8'), output: print.mock.calls }).toMatchObject({
        result: 0,
        stored: {
          ok: true,
          state: {
            cases: [{
              id: 'case-open', resolution: 'resolved',
              operatorResolution: {
                operator: 'local-operator', rationale: 'Accepted for this release.', resolvedAt: '2026-10-22T13:00:00.000Z',
              },
              sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: '2026-10-22T12:00:00.000Z' }],
              effect: { id: 'effect-open', kind: 'action', status: 'failed', diagnostic: 'Resolved by operator.' },
            }],
            outbox: [{
              eventId: expect.any(String),
              occurredAt: '2026-10-22T13:00:00.000Z',
              event: { type: 'remediation_case_operator_resolved', eventId: expect.any(String), feature: 'review-rubrics', caseId: 'case-open', sourceIds: ['testQuality:finding-1'] },
            }],
          },
        },
        events: '{"type":"existing"}\n',
        output: [['build-review resolve-case: resolved case-open.']],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes only the requested child case store', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-resolve-case-child-'));
    await openCaseStore(root);
    const child = await openCaseStore(root, parseChildId(1)!);
    const flatBefore = await readFile(remediationCaseStorePath(root), 'utf8');

    try {
      await expect(dispatchBuildReviewResolveCase(command('1'), deps(child, {
        createCaseStore: (_worktree: string, _feature: unknown, selectedChild?: number) => {
          expect(selectedChild).toBe(1);
          return child;
        },
      }))).resolves.toBe(0);

      expect({
        flat: await readFile(remediationCaseStorePath(root), 'utf8'),
        child: await child.read(),
      }).toMatchObject({
        flat: flatBefore,
        child: { ok: true, state: { cases: [{ resolution: 'resolved' }] } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses invalid operator requests without changing the case store', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-resolve-case-refusal-'));
    const caseStore = await openCaseStore(root);
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const print = vi.fn();

    try {
      const results = await Promise.all([
        dispatchBuildReviewResolveCase(command(), deps(caseStore, { isInteractive: false, print })),
        dispatchBuildReviewResolveCase(command(), deps(caseStore, { resolveOperator: () => undefined, print })),
        dispatchBuildReviewResolveCase({ ...command(), rationale: '   ' }, deps(caseStore, { print })),
        dispatchBuildReviewResolveCase({ ...command(), caseId: 'unknown-case' }, deps(caseStore, { print })),
        dispatchBuildReviewResolveCase(command(), deps(new RemediationCaseStore(root, { ...feature, feature: 'other-feature' }), { print })),
      ]);

      expect({ results, after: await readFile(remediationCaseStorePath(root), 'utf8'), messages: print.mock.calls.flat() }).toMatchObject({
        results: [1, 1, 1, 1, 1], after: before,
        messages: expect.arrayContaining([
          expect.stringContaining('interactive terminal'), expect.stringContaining('non-empty rationale'),
          expect.stringContaining('unknown case'), expect.stringContaining('feature mismatch'),
        ]),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an already resolved case and a lease timeout without changing the store', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, 'build-review-resolve-case-locked-'));
    const caseStore = await openCaseStore(root);
    const print = vi.fn();

    try {
      await expect(dispatchBuildReviewResolveCase(command(), deps(caseStore, { print }))).resolves.toBe(0);
      const resolved = await readFile(remediationCaseStorePath(root), 'utf8');
      const lock: ConductStateLease = {
        acquire: async () => ({ ok: false, kind: 'timeout', message: 'case store remains held' }),
      };
      const lockedStore = new RemediationCaseStore(root, feature, { lock });
      const outcomes = await Promise.all([
        dispatchBuildReviewResolveCase(command(), deps(caseStore, { print })),
        dispatchBuildReviewResolveCase({ ...command(), caseId: 'other-case' }, deps(lockedStore, { print })),
      ]);

      expect({ outcomes, after: await readFile(remediationCaseStorePath(root), 'utf8'), messages: print.mock.calls.flat() }).toMatchObject({
        outcomes: [1, 1], after: resolved,
        messages: expect.arrayContaining([expect.stringContaining('already resolved'), expect.stringContaining('lock-timeout')]),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
