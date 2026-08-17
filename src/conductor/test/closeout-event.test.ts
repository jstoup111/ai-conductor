import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readBuildWindows } from '../src/engine/build-tail-rollup.js';
import { joinBuildReviewRubricOutcomes } from '../src/engine/build-review-aggregate.js';
import { dispatchBuildReviewAccept } from '../src/engine/build-review-cli.js';
import { appendCloseoutEvent } from '../src/engine/closeout-events.js';
import { parseBuildReviewLapId } from '../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../src/engine/build-review-finding-identity.js';
import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { EventPersister } from '../src/engine/event-persister.js';
import type { ConductorEvent } from '../src/types/events.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('ConductorEvent union includes pipeline closeout events', () => {
  it('accepts a closeout event with its obligation timing', () => {
    const event: ConductorEvent = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 1_720_000_000_000,
      endedAt: 1_720_000_001_500,
      ts: 1_720_000_001_500,
    };

    expect(event.type).toBe('pipeline_closeout');
  });

  it('tails the accepted build-review CLI disposition once without duplicating its merged-ledger occurrence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'external-disposition-event-'));
    temporaryDirectories.push(projectRoot);
    const feature = 'review-rubrics';
    const worktree = join(projectRoot, '.worktrees', feature);
    const pipelineDir = join(worktree, '.pipeline');
    const engineLedger = join(worktree, '.pipeline', 'events.jsonl');
    const lapId = parseBuildReviewLapId('lap-current')!;
    const finding = {
      concernKind: 'out-of-plan-change',
      summary: 'src/a.ts is outside the plan',
      evidenceLocations: ['src/a.ts:1'],
      anchor: { rubric: 'scope' as const, path: 'src/a.ts', relation: 'out-of-plan-change' },
    };
    const identity = canonicalizeBuildReviewFindingIdentity({
      ...finding,
      rubric: 'scope',
      contractVersion: 'v2',
    })!;
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: 'sha256:snapshot',
      results: {
        tautology: { kind: 'judged', rubric: 'tautology', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' },
        scope: { kind: 'judged', rubric: 'scope', lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [finding], verdict: 'FAIL' },
        rootCause: { kind: 'infrastructure-failure', rubric: 'rootCause', reason: 'provider-error', detail: 'offline' },
        completeness: { kind: 'skipped', rubric: 'completeness', reason: 'disabled' },
      },
    });
    const engineRecords = [
      { type: 'step_started', step: 'build', index: 0, ts: '1970-01-01T00:00:00.010Z' },
      { type: 'step_completed', step: 'build', status: 'done', ts: '1970-01-01T00:00:00.030Z' },
    ];
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(engineLedger, `${engineRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    await writeFile(join(pipelineDir, 'build-review.json'), JSON.stringify(aggregate), 'utf8');

    await expect(dispatchBuildReviewAccept({
      kind: 'accept', feature, lapId, findingId: identity.id, rationale: 'Known migration risk',
    }, {
      cwd: projectRoot,
      isInteractive: true,
      resolveOperator: () => 'local-operator',
      resolveMainRoot: async () => projectRoot,
      realpath: async (path) => path,
      resolveRepository: () => 'repository',
      createStore: () => ({
        list: async () => ({ ok: true as const, records: [] }),
        append: async (input) => ({ ok: true as const, record: { version: 'v1' as const, ...input, acceptedAt: '2026-08-14T12:00:00.000Z' } }),
      }),
      // Keep the production CLI → closeout writer seam, while placing the
      // occurrence inside the synthetic build interval for merged-ledger
      // attribution.
      appendEvent: (eventWorktree, event) => appendCloseoutEvent(eventWorktree, {
        ...event,
        ts: '1970-01-01T00:00:00.020Z',
      }),
      print: () => {},
    })).resolves.toBe(0);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(engineLedger, events);
    const received: ConductorEvent[] = [];
    events.on('build_review_disposition_accepted', (event) => {
      received.push(event);
    });
    const tail = new CloseoutEventTail({ projectRoot: worktree, events });

    persister.start();
    try {
      await tail.poll();
    } finally {
      persister.stop();
    }

    expect(received).toEqual([expect.objectContaining({
      type: 'build_review_disposition_accepted',
      feature,
      lapId,
      findingId: identity.id,
      operator: 'local-operator',
      ts: '1970-01-01T00:00:00.020Z',
    })]);
    expect((await readFile(engineLedger, 'utf8')).trim().split('\n')).toHaveLength(2);
    await expect(readBuildWindows(worktree)).resolves.toMatchObject({
      state: 'measured',
      windows: [{
        events: expect.arrayContaining([expect.objectContaining({
          type: 'build_review_disposition_accepted', feature, lapId, findingId: identity.id, operator: 'local-operator', ts: 20,
        })]),
      }],
    });
    const windows = await readBuildWindows(worktree);
    expect(windows).toMatchObject({ state: 'measured' });
    if (windows.state === 'measured') {
      expect(windows.windows[0].events.filter((event) =>
        event.type === 'build_review_disposition_accepted',
      )).toEqual([expect.objectContaining({
        type: 'build_review_disposition_accepted', feature, lapId, findingId: identity.id, operator: 'local-operator', ts: 20,
      })]);
    }
  });
});
