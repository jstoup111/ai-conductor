// Covers: task:6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { parseChildId, type ChildId } from '../../src/engine/child-context.js';
import { coordinateBuildReviewRubrics } from '../../src/engine/build-review-coordinator.js';
import { settledBuildReviewHunks } from '../../src/engine/build-review-review-frontier.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('../../src/engine/build-review-coordinator.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-coordinator.js')>(),
  coordinateBuildReviewRubrics: vi.fn(),
}));

vi.mock('../../src/engine/build-review-review-frontier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-review-review-frontier.js')>();
  return { ...actual, settledBuildReviewHunks: vi.fn(actual.settledBuildReviewHunks) };
});

const IMPLEMENTATION_QUALITY = 'implementationQuality' as const;
const DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  '@@ -1 +1 @@',
  '-export const example = false;',
  '+export const example = true;',
].join('\n');
const engineIdentity = {
  engineStamp: 'scope-runner-fixture',
  skillDigests: { implementationQuality: { kind: 'resolved' as const, digest: 'sha256:scope-runner-policy' } },
};

describe('build_review lap scope runner', () => {
  let projectDir: string;
  let events: ConductorEvent[];
  let emitter: ConductorEventEmitter;
  let runner: DefaultStepRunner;
  let config: ReturnType<typeof resolveBuildReviewConfig>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'build-review-lap-scope-runner-'));
    events = [];
    emitter = new ConductorEventEmitter();
    emitter.on('build_review_review_scope', (event) => events.push(event));
    config = resolveBuildReviewConfig({
      build_review: {
        enabled: true,
        rubrics: {
          testQuality: { enabled: false },
          security: { enabled: false },
          implementationQuality: { enabled: true },
        },
      },
    } as HarnessConfig, CLAUDE_MODEL_POLICY);
    const provider: LLMProvider = { invoke: vi.fn() };
    runner = new DefaultStepRunner(provider, 'scope-runner', projectDir, {
      config,
      events: emitter,
      buildReviewEffectiveResolver: async () => ({
        ok: true as const,
        feature: { version: 'v1' as const, repository: projectDir, feature: 'scope-runner' },
        effective: {
          rawVerdict: 'PASS' as const, verdict: 'PASS' as const,
          acceptedFindingIds: [], unresolvedFindingIds: [], suppressedFindingIds: [],
          skippedRubrics: [], infrastructureFailureRubrics: [], uncoveredInfrastructureFailureRubrics: [],
          uncoveredScopeIncompleteRubrics: [],
        },
      }),
    });
    vi.spyOn(runner as never, 'resolveBuildReviewEngineIdentity').mockResolvedValue(engineIdentity as never);
    vi.spyOn(runner as never, 'resolvedAppliedBuildReviewActSourceIds').mockResolvedValue(new Set());
    vi.spyOn(runner as never, 'liveBuildReviewActSourceIds').mockResolvedValue({
      unappliedLiveSourceIds: new Set(), appliedLiveSourceIds: new Set(),
    });
    vi.mocked(coordinateBuildReviewRubrics).mockReset();
    vi.mocked(settledBuildReviewHunks).mockClear();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function installJudgedDispatch(): void {
    vi.mocked(coordinateBuildReviewRubrics).mockImplementation(async (input) => {
      const scope = input.reviewScopes?.[IMPLEMENTATION_QUALITY]!;
      const result = {
        kind: 'judged' as const,
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        contractVersion: 'v4' as const,
        findings: [],
        verdict: 'PASS' as const,
      };
      await input.writeArtifact({
        rubric: IMPLEMENTATION_QUALITY,
        lapId: input.lapId,
        snapshotDigest: input.inputs.sourceSnapshot.digest,
        result,
        provenance: { kind: 'fresh' },
        reviewScope: scope,
      });
      return {
        kind: 'ready',
        branches: [
          { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
          { kind: 'skipped', rubric: 'security', reason: 'disabled' },
          { kind: 'dispatched', rubric: IMPLEMENTATION_QUALITY, result },
        ],
      } as never;
    });
  }

  function installInfrastructureFailure(): void {
    vi.mocked(coordinateBuildReviewRubrics).mockResolvedValue({
      kind: 'ready',
      branches: [
        { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
        { kind: 'skipped', rubric: 'security', reason: 'disabled' },
        { kind: 'infrastructure-failure', rubric: IMPLEMENTATION_QUALITY, reason: 'provider-error', detail: 'fixture outage' },
      ],
    } as never);
  }

  async function run(headSha: string, mergeBase = 'a'.repeat(40), child?: ChildId): Promise<void> {
    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({
        sourceSnapshot: { digest: `sha256:${headSha}`, mergeBase, headSha, diff: DIFF },
      }, config, 'M', 'plan.md', undefined, undefined, child)).resolves.toMatchObject({ success: true });
  }

  function artifactPath(headSha: string, child?: ChildId): string {
    return child === undefined
      ? join(projectDir, '.pipeline', 'build-review', `lap-${headSha}`, `${IMPLEMENTATION_QUALITY}.json`)
      : join(projectDir, '.pipeline', 'children', String(child), 'build-review', `lap-${headSha}`, `${IMPLEMENTATION_QUALITY}.json`);
  }

  async function artifact(headSha: string, child?: ChildId): Promise<any> {
    return JSON.parse(await readFile(artifactPath(headSha, child), 'utf8'));
  }

  it('records and announces a full first lap followed by a delta lap', async () => {
    installJudgedDispatch();
    const firstHead = '1'.repeat(40);
    const secondHead = '2'.repeat(40);

    await run(firstHead);
    await run(secondHead);

    expect((await artifact(firstHead)).reviewScope).toMatchObject({ mode: 'full', reason: 'first-lap', sequence: 1 });
    expect((await artifact(secondHead)).reviewScope).toMatchObject({
      mode: 'delta', reason: 'delta', sequence: 2, predecessorLapId: `lap-${firstHead}`,
    });
    expect(events).toEqual([
      expect.objectContaining({ type: 'build_review_review_scope', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${firstHead}`, mode: 'full', reason: 'first-lap' }),
      expect.objectContaining({ type: 'build_review_review_scope', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${secondHead}`, mode: 'delta', reason: 'delta' }),
    ]);
  });

  it('uses a full scope when a restacked child has a new merge base', async () => {
    installJudgedDispatch();
    const child = parseChildId(1)!;
    await run('3'.repeat(40), 'a'.repeat(40), child);
    // The restack's feature-repair kickback presents the child runner with a
    // new merge base; child-local artifacts must not borrow root-lap scope.
    await run('4'.repeat(40), 'b'.repeat(40), child);

    expect((await artifact('4'.repeat(40), child)).reviewScope).toMatchObject({
      mode: 'full', reason: 'merge-base-changed', sequence: 2, mergeBase: 'b'.repeat(40),
    });
  });

  it('records an unreadable prior scope once without altering the corrupt artifact', async () => {
    installJudgedDispatch();
    const corruptHead = '5'.repeat(40);
    const corruptPath = artifactPath(corruptHead);
    await mkdir(join(projectDir, '.pipeline', 'build-review', `lap-${corruptHead}`), { recursive: true });
    const corrupt = JSON.stringify({
      version: 2, rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${corruptHead}`, snapshotDigest: `sha256:${corruptHead}`,
      result: { kind: 'judged', rubric: IMPLEMENTATION_QUALITY, lapId: `lap-${corruptHead}`, snapshotDigest: `sha256:${corruptHead}`, contractVersion: 'v4', findings: [], verdict: 'PASS' },
      provenance: { kind: 'fresh' }, reviewScope: { mode: 'unknown' },
    });
    await writeFile(corruptPath, corrupt, 'utf8');

    await run('6'.repeat(40));

    expect(await readFile(corruptPath, 'utf8')).toBe(corrupt);
    expect((await artifact('6'.repeat(40))).reviewScope).toMatchObject({
      mode: 'full', reason: 'record-unreadable', unreadableLapIds: [`lap-${corruptHead}`],
    });
  });

  it('rewrites the current-lap hunk evidence unchanged for a disposition-only rejoin', async () => {
    installJudgedDispatch();
    const head = '7'.repeat(40);
    await run(head);
    const firstScope = (await artifact(head)).reviewScope;

    await run(head);

    const replayScope = (await artifact(head)).reviewScope;
    expect(replayScope).toEqual(firstScope);
    expect(replayScope).toMatchObject({
      sequence: 1, mode: 'full', reason: 'first-lap',
      reviewedHunks: firstScope.reviewedHunks,
      deltaHunks: firstScope.deltaHunks,
    });
  });

  it('rewrites the current-lap hunk evidence unchanged after a mechanical-fault rejoin', async () => {
    const head = 'b'.repeat(40);
    installJudgedDispatch();
    await run(head);
    const firstScope = (await artifact(head)).reviewScope;

    installInfrastructureFailure();
    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({ sourceSnapshot: {
        digest: `sha256:${head}`, mergeBase: 'a'.repeat(40), headSha: head, diff: DIFF,
      } }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: false, currentLapMechanicalFault: true });

    installJudgedDispatch();
    await run(head);

    expect((await artifact(head)).reviewScope).toMatchObject({
      sequence: firstScope.sequence,
      reviewedHunks: firstScope.reviewedHunks,
      deltaHunks: firstScope.deltaHunks,
    });
  });

  it('does not persist a scope or settle hunks when a custom dispatch ends in infrastructure failure', async () => {
    const failedHead = '8'.repeat(40);
    installInfrastructureFailure();

    await expect((runner as never as { runRubricBuildReviewInner: (...args: unknown[]) => Promise<unknown> })
      .runRubricBuildReviewInner({ sourceSnapshot: {
        digest: `sha256:${failedHead}`, mergeBase: 'a'.repeat(40), headSha: failedHead, diff: DIFF,
      } }, config, 'M', 'plan.md')).resolves.toMatchObject({ success: false, currentLapMechanicalFault: true });
    await expect(readFile(artifactPath(failedHead), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    installJudgedDispatch();
    vi.mocked(settledBuildReviewHunks).mockClear();
    await run('9'.repeat(40));
    expect(vi.mocked(settledBuildReviewHunks)).toHaveBeenCalledOnce();
    expect(vi.mocked(settledBuildReviewHunks).mock.calls[0]![0].laps).toEqual([]);
    expect(vi.mocked(settledBuildReviewHunks).mock.results[0]!.value).toEqual([]);
    expect((await artifact('9'.repeat(40))).reviewScope).toMatchObject({
      mode: 'full', reason: 'first-lap', sequence: 1,
    });
  });
});
