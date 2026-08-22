/**
 * Acceptance RED for #1759.
 *
 * A stale cached judgement crosses the real coordinator and event-persistence
 * boundaries. Provider work is represented by a deterministic fake; the
 * assertion is the operator-visible event ledger, not a cache helper result.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  coordinateBuildReviewRubrics,
  type BuildReviewCoordinationInput,
} from '../../src/engine/build-review-coordinator.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import type { BuildReviewEngineIdentity } from '../../src/engine/build-review-engine-identity.js';
import type { BuildReviewFrozenInputs } from '../../src/engine/build-review-inputs.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ResolvedBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

function config(): ResolvedBuildReviewConfig {
  const enabled = {
    enabled: true,
    llm_provider: 'claude' as const,
    model: 'sonnet',
    effort: 'medium' as const,
    model_fallback_ladder: ['sonnet'],
    max_retries: 1,
    escalate: false,
  };
  const disabled = { ...enabled, enabled: false };
  return {
    enabled: true,
    perTaskFloor: false,
    scopeContainmentEnforced: false,
    maxParallel: 1,
    rubrics: {
      tautology: disabled,
      scope: enabled,
      rootCause: disabled,
      completeness: disabled,
    },
  };
}

function inputs(): BuildReviewFrozenInputs {
  const sourceContent = {
    diff: 'diff --git a/src/cache.ts b/src/cache.ts',
    planBody: '# Plan\n',
    repairContext: [],
    removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
  };
  const contentDigest = `sha256:${createHash('sha256').update(JSON.stringify(sourceContent)).digest('hex')}`;
  return {
    ...sourceContent,
    mergeBase: 'base',
    baseRef: 'origin/main',
    baseKind: 'remote',
    trackingRefSha: 'base',
    remoteHeadSha: 'base',
    fresh: true,
    acceptedWidenings: [],
    testSuiteProof: { provenanceHeadSha: 'head', outcome: 'PASS' } as never,
    sourceSnapshot: {
      digest: 'sha256:snapshot',
      contentDigest,
      baseRef: 'origin/main',
      mergeBase: 'base',
      headSha: 'head',
      ...sourceContent,
      acceptedWidenings: [],
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('acceptance: build_review cache identity follows the running engine', () => {
  it('settles an unresolved installed rubric skill root as cache-read-failed without cache reuse or writes', async () => {
    const currentIdentity = {
      engineStamp: '31b5c81beaec',
      skillDigest: `sha256:${'b'.repeat(64)}`,
    } as BuildReviewEngineIdentity;
    const readCache = vi.fn(async () => undefined);
    const writeCache = vi.fn(async () => undefined);
    const dispatchModel = vi.fn(async (_branch, projection) => ({
      findings: [], lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
    }));

    const result = await coordinateBuildReviewRubrics({
      config: config(),
      inputs: inputs(),
      lapId: parseBuildReviewLapId('lap-unavailable-installed-root')!,
      engineIdentity: {
        tautology: { kind: 'ready', identity: currentIdentity },
        scope: { kind: 'unavailable', path: '<unresolved claude skill root>/skills/build-review-scope/SKILL.md' },
        rootCause: { kind: 'ready', identity: currentIdentity },
        completeness: { kind: 'ready', identity: currentIdentity },
      },
      preflight: vi.fn(),
      readCache,
      dispatchModel,
      writeArtifact: (async (artifact) => ({ version: 1, ...artifact })) as BuildReviewCoordinationInput['writeArtifact'],
      writeCache,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      branches: expect.arrayContaining([
        expect.objectContaining({
          kind: 'infrastructure-failure', rubric: 'scope', reason: 'cache-read-failed',
          detail: expect.stringContaining('build-review-scope/SKILL.md'),
        }),
      ]),
    });
    expect(readCache).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(dispatchModel).not.toHaveBeenCalled();
  });

  it('re-judges a stale cached rubric and persists its engine-version discard before dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-engine-identity-'));
    roots.push(root);
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    const dispatchModel = vi.fn(async (_branch, projection) => ({
      findings: [],
      lapId: projection.lapId,
      snapshotDigest: projection.snapshotDigest,
    }));
    const writeCache = vi.fn(async () => undefined);
    const currentIdentity = {
      engineStamp: '31b5c81beaec',
      skillDigest: `sha256:${'b'.repeat(64)}`,
    };

    try {
      const result = await coordinateBuildReviewRubrics({
        config: config(),
        inputs: inputs(),
        lapId: parseBuildReviewLapId('lap-after-engine-change')!,
        engineIdentity: {
          tautology: { kind: 'ready', identity: currentIdentity },
          scope: { kind: 'ready', identity: currentIdentity },
          rootCause: { kind: 'ready', identity: currentIdentity },
          completeness: { kind: 'ready', identity: currentIdentity },
        },
        preflight: vi.fn(),
        readCache: (async (branch, projection, policyFingerprint) => branch.rubric === 'scope' ? ({
          version: 1,
          rubric: 'scope',
          contractVersion: 'v3',
          projectionVersion: 'v2',
          projectionDigest: projection.digest,
          policyFingerprint,
          engineIdentity: {
            engineStamp: 'aaaaaaaaaaaa',
            skillDigest: currentIdentity.skillDigest,
          },
          result: {
            kind: 'judged',
            rubric: 'scope',
            contractVersion: 'v3',
            lapId: parseBuildReviewLapId('cached-lap')!,
            snapshotDigest: 'sha256:cached-snapshot',
            findings: [],
            verdict: 'PASS',
          },
        }) : undefined) as BuildReviewCoordinationInput['readCache'],
        dispatchModel,
        writeArtifact: (async (artifact) => ({ version: 1, ...artifact })) as BuildReviewCoordinationInput['writeArtifact'],
        writeCache,
        emit: (async (event) => events.emit(event)) as BuildReviewCoordinationInput['emit'],
      } as never satisfies BuildReviewCoordinationInput);

      const records = (await readFile(eventsPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const discardedIndex = records.findIndex((event) => event.type === 'build_review_cache_discarded');
      const startedIndex = records.findIndex((event) => event.type === 'build_review_rubric_started');

      expect(discardedIndex, 'the stale cache discard must be persisted').toBeGreaterThanOrEqual(0);
      expect(records[discardedIndex]).toMatchObject({
        type: 'build_review_cache_discarded',
        rubric: 'scope',
        lapId: 'lap-after-engine-change',
        reason: 'engine-version-mismatch',
        cachedEngineStamp: 'aaaaaaaaaaaa',
        currentEngineStamp: '31b5c81beaec',
      });
      expect(discardedIndex).toBeLessThan(startedIndex);
      expect(result.kind).toBe('ready');
      expect(result.kind === 'ready' ? result.branches : []).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'dispatched', rubric: 'scope' }),
      ]));
      expect(dispatchModel).toHaveBeenCalledTimes(1);
      expect(writeCache).toHaveBeenCalledWith(expect.objectContaining({
        rubric: 'scope',
        engineIdentity: currentIdentity,
      }));
    } finally {
      persister.stop();
    }
  });
});
