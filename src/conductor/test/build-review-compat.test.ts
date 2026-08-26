import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkStepCompletion } from '../src/engine/artifacts.js';
import { joinBuildReviewRubricOutcomes } from '../src/engine/build-review-aggregate.js';
import {
  cacheEntryPath,
  readBuildReviewCacheEntry,
  type BuildReviewCacheFilesystem,
} from '../src/engine/build-review-cache.js';
import { resolveEffectiveBuildReviewVerdict } from '../src/engine/build-review-effective.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const lapId = 'lap-compat' as never;
const snapshotDigest = 'sha256:compat';

function aggregate() {
  const result = {
    kind: 'judged' as const,
    rubric: 'testQuality' as const,
    lapId,
    snapshotDigest,
    contractVersion: 'v3' as never,
    findings: [],
    verdict: 'PASS' as const,
  };
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest,
    results: {
      testQuality: result,
    },
  });
}

describe('retired build-review state compatibility', () => {
  it('ignores a persisted scope disposition while resolving the current lap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-compat-main-'));
    const worktree = join(root, '.worktrees', 'feature');
    dirs.push(root);
    await mkdir(join(worktree, '.pipeline'), { recursive: true });

    const feature = { version: 'v1' as const, repository: root, feature: 'feature' };
    const finding = {
      id: 'sha256:legacy', canonicalJson: '{}',
      canonicalPayload: { rubric: 'scope' },
    };
    await writeFile(join(worktree, '.pipeline', 'build-review-dispositions.json'), JSON.stringify({
      version: 'v1',
      records: [{
        version: 'v1', feature, finding, sourceLapId: lapId, summary: 'legacy scope finding',
        rationale: 'accepted before retirement', operator: 'operator', acceptedAt: '2026-08-22T00:00:00.000Z',
      }],
    }));
    await expect(resolveEffectiveBuildReviewVerdict(worktree, aggregate(), {
      resolveMainRoot: async () => root,
      realpath: async (path) => path,
    })).resolves.toMatchObject({ ok: true });
  });

  it('treats a retired rootCause lap verdict as a cache miss', async () => {
    const root = '/feature';
    const path = cacheEntryPath(root, 'rootCause' as never);
    const fs: BuildReviewCacheFilesystem = {
      readFile: async () => JSON.stringify({
        version: 1,
        rubric: 'rootCause',
        contractVersion: 'v3',
        projectionVersion: 'v2',
        projectionDigest: 'sha256:projection',
        policyFingerprint: 'sha256:policy',
        result: {
          kind: 'judged', rubric: 'rootCause', lapId, snapshotDigest,
          contractVersion: 'v3', findings: [], verdict: 'PASS',
        },
      }),
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
    };

    await expect(readBuildReviewCacheEntry(root, 'rootCause' as never, fs)).resolves.toBeUndefined();
    expect(path).toBe('/feature/.pipeline/build-review/cache/rootCause.json');
  });

  it('still blocks completion when a recorded rem-* heading was removed from the plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-removal-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [
        { id: '1', status: 'completed' },
        { id: 'rem-build-review-1', status: 'completed' },
      ],
    }));
    await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
      appendedRemediationTaskIds: ['rem-build-review-1'],
    }));
    await writeFile(join(root, 'plan.md'), '### Task 1: Existing task\n');

    await expect(checkStepCompletion(root, 'build', { projectRoot: root, planPath: join(root, 'plan.md') })).resolves.toMatchObject({
      done: false,
      reason: expect.stringMatching(/removed from plan/i),
    });
  });
});
