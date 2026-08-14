import { describe, expect, it, vi } from 'vitest';

import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import { dispatchBuildReviewAccept, dispatchBuildReviewFindings } from '../../src/engine/build-review-cli.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const finding = { concernKind: 'outside plan', anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'outside-plan' } };
const aggregate = joinBuildReviewRubricOutcomes({
  lapId, snapshotDigest: 'sha256:snapshot',
  results: {
    tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1' as never, findings: [], verdict: 'PASS' },
    scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1' as never, findings: [finding], verdict: 'FAIL' },
    rootCause: { kind: 'judged', rubric: 'rootCause', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v1' as never, findings: [], verdict: 'PASS' },
    completeness: { kind: 'skipped', rubric: 'completeness', reason: 'disabled' },
    wiring: { kind: 'infrastructure-failure', rubric: 'wiring', reason: 'provider-error', detail: 'offline' },
  },
});

describe('build-review findings CLI', () => {
  it('accepts exactly one unresolved finding for a verified interactive operator and leaves siblings untouched', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v1' })!;
    const append = vi.fn(async (input) => ({
      ok: true as const,
      record: { version: 'v1' as const, ...input, acceptedAt: '2026-08-14T12:00:00.000Z' },
    }));
    const store = { list: vi.fn(async () => ({ ok: true as const, records: [] })), append };
    const output = vi.fn();
    await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-current', findingId: identity.id, rationale: 'Known migration risk' }, {
      cwd: '/main', isInteractive: true, resolveOperator: () => 'local-operator', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile: async () => JSON.stringify(aggregate), createStore: () => store, print: output,
    })).resolves.toBe(0);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ sourceLapId: lapId, finding: identity, rationale: 'Known migration risk', operator: 'local-operator' }));
    expect(output).toHaveBeenCalledWith(expect.stringMatching(/accepted/i));
  });

  it('refuses piped, unidentified, stale, or unknown acceptance before mutating state', async () => {
    const append = vi.fn();
    const store = { list: vi.fn(), append };
    for (const deps of [
      { isInteractive: false, resolveOperator: () => 'local-operator' },
      { isInteractive: true, resolveOperator: () => undefined },
      { isInteractive: true, resolveOperator: () => 'local-operator', readFile: async () => JSON.stringify(aggregate) },
    ]) {
      await expect(dispatchBuildReviewAccept({ kind: 'accept', feature: 'review-rubrics', lapId: 'lap-stale', findingId: 'sha256:unknown', rationale: 'risk' }, {
        cwd: '/main', resolveMainRoot: async () => '/main', realpath: async (path) => path, createStore: () => store, print: vi.fn(), ...deps,
      })).resolves.toBe(1);
    }
    expect(append).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
  });

  it('reads the canonical feature worktree and deterministically renders raw, accepted, unresolved, skipped, and infrastructure state', async () => {
    const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'scope', contractVersion: 'v1' })!;
    const print = vi.fn();
    const readFile = vi.fn(async (path: string) => path.endsWith('build-review.json')
      ? JSON.stringify(aggregate)
      : JSON.stringify({ version: 'v1', records: [{ version: 'v1', feature: { version: 'v1', repository: 'repo', feature: 'review-rubrics' }, finding: identity, sourceLapId: lapId, summary: 'accepted', rationale: 'risk', operator: 'operator', acceptedAt: '2026-08-14T12:00:00.000Z' }] }));

    await expect(dispatchBuildReviewFindings({ kind: 'findings', feature: 'review-rubrics', format: 'json' }, {
      cwd: '/main/.worktrees/review-rubrics', resolveMainRoot: async () => '/main', realpath: async (path) => path,
      readFile, print,
    })).resolves.toBe(0);
    expect(readFile.mock.calls.map(([path]) => path)).toEqual([
      '/main/.worktrees/review-rubrics/.pipeline/build-review.json',
      '/main/.worktrees/review-rubrics/.pipeline/build-review-dispositions.json',
    ]);
    expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({
      feature: 'review-rubrics', lapId: 'lap-current', rawVerdict: 'FAIL', verdict: 'FAIL',
      acceptedFindingIds: [identity.id], unresolvedFindingIds: [], skippedRubrics: ['completeness'], infrastructureFailureRubrics: ['wiring'],
    });
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
});
