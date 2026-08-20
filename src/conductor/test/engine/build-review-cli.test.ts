import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewRubricResult } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
import { dispatchBuildReviewAccept, dispatchBuildReviewFindings, dispatchBuildReviewRecordReducedCoverage } from '../../src/engine/build-review-cli.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const finding = { concernKind: 'out-of-plan-change', summary: 'src/a.ts is outside the plan', evidenceLocations: ['src/a.ts:1'], anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'not-authorized-by-plan' } };
const aggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:snapshot',
  results: {
    tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
    scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [finding], verdict: 'FAIL' },
    rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'offline' },
    completeness: { kind: 'skipped', rubric: 'completeness', reason: 'disabled' },
  },
});

function aggregateWithRootCause(result: BuildReviewRubricResult) {
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot', results: { ...aggregate.results, rootCause: result },
  });
}

describe('build-review findings CLI', () => {
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
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'rootCause', rationale: 'Provider is unavailable.',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), readMechanicalFaults: async () => 3, createStore: () => store, print: vi.fn(), appendEvent: vi.fn(),
    })).resolves.toBe(0);

    expect(appendReducedCoverageIfCurrent).toHaveBeenCalledWith({
      feature: { version: 'v1', repository: '/main', feature: 'review-rubrics' }, rubric: 'rootCause', reason: 'provider-error',
      rationale: 'Provider is unavailable.', operator: 'local-operator',
    }, expect.any(Function));
  });

  it.each([
    ['judged rubric', aggregateWithRootCause({ kind: 'judged', rubric: 'rootCause', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' }), 3, [], 'infrastructure failure', false],
    ['skipped rubric', aggregateWithRootCause({ kind: 'skipped', rubric: 'rootCause', reason: 'disabled' }), 3, [], 'infrastructure failure', false],
    ['remaining allowance', aggregate, 2, [], 'allowance', true],
    ['duplicate decision', aggregate, 3, [{ kind: 'reduced-coverage' as const, version: 'v1' as const, feature: { version: 'v1' as const, repository: '/main', feature: 'review-rubrics' }, identity: { rubric: 'rootCause' as const, reason: 'provider-error' as const }, rationale: 'already accepted', operator: 'james', acceptedAt: '2026-08-19T12:00:00.000Z' }], 'already recorded', true],
  ])('refuses %s without storing a reduced-coverage decision', async (_caseName, currentAggregate, mechanicalFaults, records, reason, entersLease) => {
    const persisted = [...records];
    const appendReducedCoverageIfCurrent = vi.fn(async (_input, validate) => {
      expect(await validate(records)).toBe(false);
      return { ok: false as const, kind: 'invalid' as const, message: 'not eligible' };
    });
    const print = vi.fn();
    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'rootCause', rationale: 'risk',
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
      createStore: unknownStore, print: unknownPrint,
    })).resolves.toBe(1);
    expect(unknownStore).not.toHaveBeenCalled();
    expect(unknownPrint).toHaveBeenCalledWith(expect.stringMatching(/not a known rubric/i));

    const nextLap = joinBuildReviewRubricOutcomes({
      lapId: parseBuildReviewLapId('lap-next')!, snapshotDigest: 'sha256:next', results: {
        tautology: { kind: 'judged', rubric: 'tautology', lapId: parseBuildReviewLapId('lap-next')!, snapshotDigest: 'sha256:next', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId: parseBuildReviewLapId('lap-next')!, snapshotDigest: 'sha256:next', contractVersion: 'v2' as never, findings: [finding], verdict: 'FAIL' },
        rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'offline' },
        completeness: { kind: 'skipped', rubric: 'completeness', reason: 'disabled' },
      },
    });
    let reads = 0;
    const appendReducedCoverageIfCurrent = vi.fn(async (_input, validate) => {
      expect(await validate([])).toBe(false);
      return { ok: false as const, kind: 'invalid' as const, message: 'current reduced-coverage state is invalid' };
    });
    const stalePrint = vi.fn();
    await expect(dispatchBuildReviewRecordReducedCoverage({
      kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'rootCause', rationale: 'risk',
    }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(++reads === 1 ? aggregate : nextLap), readMechanicalFaults: async () => 3,
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
        kind: 'record-reduced-coverage', feature: 'review-rubrics', lapId: 'lap-current', rubric: 'rootCause', rationale: 'risk',
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
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v2' })!;
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
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v2' })!;
    const nextLap = { ...aggregate, lapId: parseBuildReviewLapId('lap-next')!, results: { ...aggregate.results, scope: { ...aggregate.results.scope, lapId: parseBuildReviewLapId('lap-next')! } } };
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
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v2' })!;
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
      feature: 'review-rubrics', lapId: 'lap-current', rawVerdict: 'FAIL', verdict: 'FAIL',
      acceptedFindingIds: [identity.id], unresolvedFindingIds: [], skippedRubrics: ['completeness'], infrastructureFailureRubrics: ['rootCause'],
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
        tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'offline' },
        completeness: { kind: 'judged', rubric: 'completeness', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
      },
    });
    const deps = {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(faultOnly), createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }),
    };
    const machine = vi.fn();
    const human = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, { ...deps, print: machine })).resolves.toBe(0);
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);

    expect({ machine: JSON.parse(machine.mock.calls[0]![0]), human: human.mock.calls[0]![0] }).toEqual({
      machine: expect.objectContaining({
        verdict: 'FAIL', unresolvedFindingIds: [],
        exhaustedMechanicalFaults: [{ rubric: 'rootCause', cause: 'provider-error', diagnostic: 'offline' }],
      }),
      human: expect.stringMatching(/Blocked by exhausted mechanical faults, not unresolved findings\.[\s\S]*Exhausted mechanical fault: rootCause; cause: provider-error; diagnostic: offline/),
    });
  });

  it('keeps a fault-free report byte-identical to the existing output', async () => {
    const faultFree = joinBuildReviewRubricOutcomes({
      lapId, snapshotDigest: 'sha256:snapshot', results: {
        tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        rootCause: { kind: 'judged', rubric: 'rootCause', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        completeness: { kind: 'judged', rubric: 'completeness', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
      },
    });
    const print = vi.fn();

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(faultFree), createStore: () => ({ list: async () => ({ ok: true as const, records: [] }), append: vi.fn() }), print,
    })).resolves.toBe(0);

    expect(print).toHaveBeenCalledWith(JSON.stringify({
      feature: 'review-rubrics', lapId: 'lap-current', snapshotDigest: 'sha256:snapshot', rawVerdict: 'PASS', verdict: 'PASS',
      acceptedFindingIds: [], unresolvedFindingIds: [], skippedRubrics: [], infrastructureFailureRubrics: [], acceptedDispositions: [],
    }));
  });

  it('uses the live runner canonical identity for both findings reads and acceptance writes through an alternate main root', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v2' })!;
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

describe('build-review accept on every rubric', () => {
  const tautologyFinding = {
    concernKind: 'assertion-insensitive-to-production',
    summary: 'the assertion cannot fail',
    evidenceLocations: ['test/widget.test.ts:12'],
    anchor: {
      rubric: 'tautology' as const,
      exercisedBehavior: 'persists state',
      violationKind: 'assertion-insensitive-to-production',
      changedTest: {
        path: 'test/widget.test.ts',
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        display: 'widget persists state',
      },
    },
  };
  const tautologyAggregate = joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot',
    results: {
      tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [tautologyFinding], verdict: 'FAIL' },
      scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' },
      rootCause: { kind: 'judged', rubric: 'rootCause', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' },
      completeness: { kind: 'judged', rubric: 'completeness', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v3', findings: [], verdict: 'PASS' },
    },
  });
  const tautologyIdentity = canonicalizeBuildReviewFindingIdentity({
    rubric: 'tautology', contractVersion: 'v3', concernKind: tautologyFinding.concernKind, anchor: tautologyFinding.anchor,
  })!;

  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-review-accept-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator',
      resolveMainRoot: async () => '/main', realpath: async (path: string) => path,
      readFile: async () => JSON.stringify(tautologyAggregate),
      createStore: () => new BuildReviewDispositionStore(root),
      appendEvent: vi.fn(),
      ...overrides,
    };
  }

  // Regression for #1769: only `scope` findings could be accepted, because the
  // store re-validated the engine's canonical payload with the grader-facing
  // anchor parser.
  it('accepts a current tautology finding through the real disposition store and reports it accepted', async () => {
    const print = vi.fn();
    const appendEvent = vi.fn();

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: tautologyIdentity.id, rationale: 'Accepted risk' },
      deps({ print, appendEvent }),
    )).resolves.toBe(0);

    expect(print).toHaveBeenCalledWith(`build-review accept: accepted ${tautologyIdentity.id} for lap lap-current.`);
    expect(appendEvent).toHaveBeenCalledWith('/main/.worktrees/review-rubrics', expect.objectContaining({
      type: 'build_review_disposition_accepted', findingId: tautologyIdentity.id,
    }));

    const findings = vi.fn();
    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, deps({ print: findings }))).resolves.toBe(0);
    expect(JSON.parse(findings.mock.calls[0]![0] as string)).toMatchObject({
      rawVerdict: 'FAIL', verdict: 'PASS', acceptedFindingIds: [tautologyIdentity.id], unresolvedFindingIds: [],
      acceptedDispositions: [{ findingId: tautologyIdentity.id }],
    });
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
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: tautologyIdentity.id, rationale: 'risk' },
      deps({ readFile: async () => 'not json', ...unreadable }),
    )).resolves.toBe(1);

    const staleLap = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-previous', findingId: tautologyIdentity.id, rationale: 'risk' },
      deps({ ...staleLap }),
    )).resolves.toBe(1);

    const unknownFinding = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: 'sha256:unknown', rationale: 'risk' },
      deps({ ...unknownFinding }),
    )).resolves.toBe(1);

    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: tautologyIdentity.id, rationale: 'risk' },
      deps({ print: vi.fn() }),
    )).resolves.toBe(0);
    const alreadyAccepted = collect();
    await expect(dispatchBuildReviewAccept(
      { kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: tautologyIdentity.id, rationale: 'risk' },
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
