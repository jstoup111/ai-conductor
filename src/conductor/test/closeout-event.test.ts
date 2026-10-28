import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { joinBuildReviewRubricOutcomes } from '../src/engine/build-review-aggregate.js';
import { dispatchBuildReviewAccept, type BuildReviewAcceptDeps } from '../src/engine/build-review-cli.js';
import { parseBuildReviewLapId } from '../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../src/engine/build-review-finding-identity.js';
import { appendCloseoutEvent } from '../src/engine/closeout-events.js';
import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { readMergedFeatureEvents } from '../src/engine/build-tail-rollup.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function writeAcceptanceThroughCli(root: string): Promise<{ findingId: string; worktree: string }> {
  const feature = 'feature';
  const worktree = join(root, '.worktrees', feature);
  await mkdir(worktree, { recursive: true });
  const lapId = parseBuildReviewLapId('lap-1')!;
  const finding = {
    concernKind: 'test-insensitive' as const,
    summary: 'The changed test does not observe its behavior.',
    evidenceLocations: ['test/example.test.ts:1'],
    anchor: { rubric: 'testQuality' as const, locus: { path: 'test/example.test.ts', contentHash: `sha256:${'a'.repeat(64)}`, display: 'fixture test' } },
  };
  const identity = canonicalizeBuildReviewFindingIdentity({ ...finding, rubric: 'testQuality', contractVersion: 'v3' })!;
  const aggregate = joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest: 'sha256:snapshot',
    results: {
      testQuality: {
        kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot',
        contractVersion: 'v3' as const, findings: [finding], verdict: 'FAIL' as const,
      },
    },
  });
  const store: ReturnType<NonNullable<BuildReviewAcceptDeps['createStore']>> = {
    list: async () => ({ ok: true as const, records: [] }),
    append: async (input) => ({
      ok: true as const,
      record: { ...input, version: 'v1' as const, acceptedAt: '2026-10-14T00:00:00.000Z' },
    }),
  };
  await expect(dispatchBuildReviewAccept({
    kind: 'accept', feature, lapId: 'lap-1', findingId: identity.id, rationale: 'Known fixture risk.',
  }, {
    cwd: root,
    resolveMainRoot: async () => root,
    readFile: async () => JSON.stringify(aggregate),
    createStore: () => store,
    loadConfig: async () => ({ ok: true as const, config: {}, warnings: [] }),
    isInteractive: true,
    resolveOperator: () => 'fixture-operator',
    appendEvent: appendCloseoutEvent,
    print: () => {},
  })).resolves.toBe(0);
  return { findingId: identity.id, worktree };
}

it('re-emits a build-review disposition written by dispatchBuildReviewAccept when a tail starts later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-disposition-')); directories.push(root);
  const { findingId, worktree } = await writeAcceptanceThroughCli(root);
  const events = new ConductorEventEmitter(); const received: unknown[] = [];
  events.on('build_review_disposition_accepted', (event) => { received.push(event); });
  await new CloseoutEventTail({ projectRoot: worktree, events }).drain();
  expect(received).toEqual([expect.objectContaining({
    type: 'build_review_disposition_accepted', feature: 'feature', lapId: 'lap-1', findingId, operator: 'fixture-operator',
  })]);
});

it('merges a disposition written by dispatchBuildReviewAccept between bracketing engine events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'external-disposition-')); directories.push(root);
  const { findingId, worktree } = await writeAcceptanceThroughCli(root);
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline/events.jsonl'), [
    { type: 'step_started', step: 'build', index: 1, ts: '2020-10-01T00:00:01.000Z' },
    { type: 'step_completed', step: 'build', status: 'done', ts: '2030-10-01T00:00:03.000Z' },
  ].map((event) => JSON.stringify(event)).join('\n'));
  await expect(readMergedFeatureEvents(worktree)).resolves.toEqual([
    expect.objectContaining({ type: 'step_started', ts: Date.parse('2020-10-01T00:00:01.000Z') }),
    expect.objectContaining({ type: 'build_review_disposition_accepted', findingId }),
    expect.objectContaining({ type: 'step_completed', ts: Date.parse('2030-10-01T00:00:03.000Z') }),
  ]);
});
