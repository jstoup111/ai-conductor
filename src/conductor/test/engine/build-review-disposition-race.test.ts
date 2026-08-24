import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { readRegradeCount } from '../../src/engine/build-review-disposition.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { setupStaleTrackingRefFixture, type StaleTrackingFixture } from '../fixtures/git-repo.js';
import { Conductor } from '../test-conductor.js';

// Disposition-race guard (2026-08-15 incident, #1696/#1611): an operator
// `build-review accept` landed while rework was being composed from the raw
// aggregate, and the kickback ordered removal of exactly the accepted
// surface. Every exit from the conductor's raw-FAIL block must re-read the
// disposition store and route on the EFFECTIVE verdict — the property is
// rubric-agnostic, so it survives the retirement of every rubric but
// test-quality unchanged.
describe('engine/conductor — build_review kickback disposition-race guard', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function effective(overrides: { accepted: string[]; unresolved: string[] }) {
    return {
      ok: true as const,
      feature: { version: 'v1' as const, repository: '/repo', feature: 'feature' },
      effective: {
        rawVerdict: 'FAIL' as const,
        verdict: overrides.unresolved.length === 0 ? ('PASS' as const) : ('FAIL' as const),
        acceptedFindingIds: overrides.accepted,
        unresolvedFindingIds: overrides.unresolved,
        skippedRubrics: [],
        infrastructureFailureRubrics: [],
      },
    };
  }

  async function fixture(
    resolver: ReturnType<typeof vi.fn>,
    opts?: {
      kickbackLedger?: Record<string, unknown>;
      staleMirage?: 'invalidated' | 'halt';
      seedNoOpEscalation?: boolean;
      seedPerGateLimit?: boolean;
      /** Stop the run with a sentinel once rework is dispatched. */
      stopOnBuild?: boolean;
    },
  ) {
    dir = await mkdtemp(join(tmpdir(), 'build-review-disposition-race-'));
    // Stale-mirage cases use a real local git fixture: its deliberately stale
    // tracking ref makes the merged-only path a deterministic stale mirage
    // without contacting a third party. The other routing seams need no git
    // boundary, keeping their fixtures narrow.
    const gitFixture: StaleTrackingFixture | undefined = opts?.staleMirage
      ? await setupStaleTrackingRefFixture(dir)
      : undefined;
    const projectRoot = gitFixture?.repo ?? dir;
    const treeHash = null;
    const statePath = join(projectRoot, '.pipeline', 'state.json');
    // Keep the fixture in the same feature session so an explicitly seeded
    // kickback ledger is not cleared at Conductor startup.
    const state: Record<string, unknown> = { complexity_tier: 'M', run_started_at: 1 };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(
      join(projectRoot, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );
    const kickbackLedger = opts?.kickbackLedger ?? (opts?.seedNoOpEscalation
      ? {
          version: 1,
          gates: {
            build_review: {
              count: 2, cumulative: 2, treeHash, lastReason: 'same',
              priorVerdict: false, resolvedBefore: 1,
            },
          },
        }
      : opts?.seedPerGateLimit
        ? {
            version: 1,
            gates: {
              build_review: {
                count: 2, cumulative: 2, treeHash, lastReason: 'prior',
                priorVerdict: true, resolvedBefore: 1,
              },
            },
          }
        : undefined);
    if (kickbackLedger) {
      await writeFile(
        join(projectRoot, '.pipeline', 'kickback-ledger.json'),
        JSON.stringify(kickbackLedger),
      );
    }
    if (opts?.staleMirage === 'halt') {
      await writeFile(
        join(projectRoot, '.pipeline', 'build-review-regrade.json'),
        JSON.stringify({ count: 1 }),
      );
    }

    const dispatched: StepName[] = [];
    let buildReviewMergeBase: string | undefined;
    let buildReviewRuns = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        if (step === 'build' && opts?.stopOnBuild) throw new Error('stop after rework dispatch');
        if (step === 'build_review') {
          buildReviewRuns += 1;
          if (opts?.staleMirage && buildReviewRuns === 1) {
            buildReviewMergeBase = gitFixture!.staleTrackingSha;
          }
          await writeFile(
            join(projectRoot, '.pipeline', 'build-review.json'),
            JSON.stringify(buildReviewRuns === 1
              ? {
                  verdict: 'FAIL',
                  reasons: [opts?.staleMirage
                    ? `diff touches ${gitFixture!.mergedOnlyPath} which is out of scope`
                    : 'same'],
                  rubric: { testQuality: true },
                }
              : { verdict: 'PASS', rubric: { testQuality: false } }),
          );
          return {
            success: true,
            ...(opts?.staleMirage ? {
              baseFreshness: {
                mergeBase: gitFixture!.staleTrackingSha,
                trackingRefSha: gitFixture!.staleTrackingSha,
                remoteHeadSha: gitFixture!.freshRemoteSha,
                fresh: false,
              },
            } : {}),
          };
        }
        return { success: true };
      },
    };

    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: string; to: string }> = [];
    const invalidatedDispositions: ConductorEvent[] = [];
    const staleMirageRegrades: ConductorEvent[] = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    events.on('build_review_disposition_version_invalidated', (event) => {
      invalidatedDispositions.push(event);
    });
    events.on('build_review_stale_mirage_regrade', (event) => {
      staleMirageRegrades.push(event);
    });

    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      config: { kickback_escalation: { enabled: false } },
      buildReviewEffectiveResolver: resolver,
    } as never);

    await conductor.run().catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('stop after')) throw error;
    });
    return {
      dispatched, kickbacks, invalidatedDispositions, staleMirageRegrades,
      buildReviewRuns: () => buildReviewRuns,
      projectRoot, treeHash, buildReviewMergeBase,
    };
  }

  it('drops the kickback and re-lands build_review when every finding is accepted at routing time', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted-test-quality-finding'], unresolved: [] }));

    const { dispatched, kickbacks, buildReviewRuns, projectRoot } = await fixture(resolver);

    expect(resolver).toHaveBeenCalled();
    // The raw FAIL never routed rework: no build dispatch, no kickback event.
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    // build_review re-ran and settled from the disposition-aware join.
    expect(buildReviewRuns()).toBe(2);
    // The kickback budget was not consumed by the dropped raw FAIL.
    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/kickback-ledger.json'), 'utf8'))).toEqual({ version: 1, gates: {} });
  });

  it('lets the raw-FAIL resolver report a non-binding disposition on the event spine', async () => {
    const resolver = vi.fn(async (_projectRoot, _aggregate, deps) => {
      await deps.emit({
        type: 'build_review_disposition_version_invalidated',
        feature: 'feature', findingId: 'sha256:superseded', rubric: 'testQuality', contractVersion: 'v1',
      });
      return effective({ accepted: ['sha256:accepted-test-quality-finding'], unresolved: [] });
    });

    const { invalidatedDispositions } = await fixture(resolver);

    expect(invalidatedDispositions).toEqual([{
      type: 'build_review_disposition_version_invalidated',
      feature: 'feature', findingId: 'sha256:superseded', rubric: 'testQuality', contractVersion: 'v1',
    }]);
  });

  it('keeps the kickback when unresolved findings remain despite a partial acceptance', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks } = await fixture(resolver, { stopOnBuild: true });

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });

  it('keeps the kickback when the disposition store is unavailable (fail-open to raw routing)', async () => {
    const resolver = vi.fn(async () => ({ ok: false as const, reason: 'build-review disposition state is unavailable' }));

    const { dispatched, kickbacks } = await fixture(resolver, { stopOnBuild: true });

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });

  it('keeps an unresolved finding on the existing cumulative-cap path, preserving its cap reason and HALT class', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks, projectRoot } = await fixture(resolver, {
      kickbackLedger: {
        version: 1,
        gates: {
          build_review: {
            count: 1,
            cumulative: 5,
            treeHash: 'previous-tree',
            lastReason: 'previous failure',
            priorVerdict: true,
            resolvedBefore: 0,
          },
        },
      },
    });

    expect(dispatched).toEqual(['build_review']);
    expect(kickbacks).toEqual([]);
    expect(await readFile(join(projectRoot, '.pipeline/HALT'), 'utf-8')).toContain(
      'build_review cumulative kickback cap exceeded (cumulative 6, cap 5): same',
    );
    expect(await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/kickback-ledger.json'), 'utf-8'))).toMatchObject({
      gates: { build_review: { count: 1, cumulative: 6 } },
    });
  });

  // ── Stale-mirage disposition wiring (unresolved findings) ────────────────
  // The scope-FAIL disposition guard is keyed on flagged paths, not on a
  // rubric: a build_review FAIL graded against a stale base is invalidated and
  // regraded before any rework routes, and a second detection halts.

  it('invalidates a stale-mirage FAIL before routing: no rework, verdict removed, regrade event emitted, build_review re-runs', async () => {
    const resolver = vi.fn(async () => effective({ accepted: [], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks, buildReviewRuns, staleMirageRegrades, projectRoot, buildReviewMergeBase } = await fixture(
      resolver,
      { staleMirage: 'invalidated', stopOnBuild: true },
    );

    expect(buildReviewMergeBase).toBeTruthy();
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    expect(buildReviewRuns()).toBe(2);
    expect(staleMirageRegrades).toEqual([
      expect.objectContaining({ type: 'build_review_stale_mirage_regrade', mergeBase: buildReviewMergeBase, regradeCount: 1 }),
    ]);
    // The regrade PASSed, so the run finished without a HALT and the
    // invalidated verdict never reached the kickback ledger.
    await expect(readFile(join(projectRoot, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(projectRoot, '.pipeline/kickback-ledger.json'), 'utf8')).rejects.toThrow();
    expect(await readRegradeCount(projectRoot)).toBe(1);
  });

  it('halts needs-human on a second stale-mirage detection, naming the graded/fresh base shas, flagged paths, and regrade count', async () => {
    const resolver = vi.fn(async () => effective({ accepted: [], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks, buildReviewRuns, projectRoot, buildReviewMergeBase } = await fixture(
      resolver,
      { staleMirage: 'halt', stopOnBuild: true },
    );

    expect(dispatched).toEqual(['build_review']);
    expect(kickbacks).toEqual([]);
    expect(buildReviewRuns()).toBe(1);
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('second stale-mirage');
    expect(halt).toContain(`gradedBaseSha: ${buildReviewMergeBase}`);
    expect(halt).toMatch(/freshBaseSha: [0-9a-f]{40}/);
    expect(halt).toContain('flaggedPaths: ');
    expect(halt).toContain('regradeCount: ');
    expect(await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8')).toBe('needs-human');
  });

  it('routes a genuine (non-stale-mirage) FAIL to build rework, never the stale-mirage HALT', async () => {
    const resolver = vi.fn(async () => effective({ accepted: [], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks, projectRoot } = await fixture(resolver, { stopOnBuild: true });

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
    // The only HALT is the sentinel that stopped the rework dispatch — never
    // the stale-mirage disposition HALT, and no regrade was consumed.
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8').catch(() => '');
    expect(halt).not.toContain('second stale-mirage');
    expect(await readRegradeCount(projectRoot)).toBe(0);
  });

  // ── Effective PASS overrides every raw-FAIL exit ──────────────────────────

  async function expectEffectivePassToReenter(options?: Parameters<typeof fixture>[1]) {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: [] }));
    const { dispatched, kickbacks, buildReviewRuns, projectRoot, treeHash, buildReviewMergeBase } = await fixture(resolver, options);
    expect(resolver).toHaveBeenCalled();
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    expect(buildReviewRuns()).toBe(2);
    await expect(readFile(join(projectRoot, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
    return { projectRoot, treeHash, buildReviewMergeBase };
  }

  it('re-enters build_review instead of the stale-mirage disposition HALT when an effective PASS overrides a second stale mirage', async () => {
    const { buildReviewMergeBase } = await expectEffectivePassToReenter({ staleMirage: 'halt' });
    expect(buildReviewMergeBase).toBeTruthy();
  });

  it('re-enters build_review instead of invalidating a stale-mirage verdict when the effective verdict is PASS', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: [] }));
    const { dispatched, kickbacks, buildReviewRuns, staleMirageRegrades, buildReviewMergeBase } = await fixture(
      resolver,
      { staleMirage: 'invalidated' },
    );

    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    expect(buildReviewRuns()).toBe(2);
    // The effective-PASS guard must stop the observable regrade transition.
    expect(staleMirageRegrades).toEqual([]);
    expect(buildReviewMergeBase).toBeTruthy();
  });

  it('re-enters build_review instead of the kickback-to-build no-op HALT when the effective verdict is PASS', async () => {
    // The D2 baseline must exactly match the tree and resolved task movement
    // observed at re-entry; otherwise it is classified as productive work.
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: [] }));
    const { buildReviewRuns, projectRoot } = await fixture(resolver, { seedNoOpEscalation: true });

    expect(buildReviewRuns()).toBe(2);
    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/kickback-ledger.json'), 'utf8'))).toMatchObject({
      gates: {
        build_review: {
          treeHash: null,
          resolvedBefore: 1,
          priorVerdict: true,
        },
      },
    });
    await expect(readFile(join(projectRoot, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
  });

  it('re-enters build_review instead of the cumulative-cap HALT when the effective verdict is PASS, restoring the ledger', async () => {
    const seeded = {
      count: 1, cumulative: 5, treeHash: 'prior', lastReason: 'prior', priorVerdict: true, resolvedBefore: 0,
    };
    const { projectRoot } = await expectEffectivePassToReenter({
      kickbackLedger: { version: 1, gates: { build_review: seeded } },
    });
    // The budget consumed for the dropped raw FAIL was written back.
    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/kickback-ledger.json'), 'utf8'))).toMatchObject({
      gates: { build_review: { count: 1, cumulative: 5 } },
    });
  });

  it('re-enters build_review instead of the per-gate unresolved HALT when the effective verdict is PASS', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: [] }));
    const { buildReviewRuns, projectRoot } = await fixture(resolver, { seedPerGateLimit: true });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(buildReviewRuns()).toBe(2);
    await expect(readFile(join(projectRoot, '.pipeline/HALT'), 'utf8')).rejects.toThrow();
  });
});
