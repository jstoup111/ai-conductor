import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { Conductor } from '../test-conductor.js';

// Disposition-race guard (2026-08-15 incident): an operator `build-review
// accept` landed at 20:12:19 while the /remediate planner (dispatched
// 20:10:36) was composing rework from the raw aggregate; the 20:13 kickback
// ordered removal of exactly the accepted surface. The conductor must re-read
// the disposition store and use the EFFECTIVE verdict at routing time.
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
      completenessFailure?: boolean;
      remediateRefusal?: boolean;
    },
  ) {
    dir = await mkdtemp(join(tmpdir(), 'build-review-disposition-race-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    // Keep the fixture in the same feature session so an explicitly seeded
    // kickback ledger is not cleared at Conductor startup.
    const state: Record<string, unknown> = { complexity_tier: 'M', run_started_at: 1 };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );
    if (opts?.kickbackLedger) {
      await writeFile(
        join(dir, '.pipeline', 'kickback-ledger.json'),
        JSON.stringify(opts.kickbackLedger),
      );
    }

    const dispatched: StepName[] = [];
    let buildReviewRuns = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatched.push(step);
        if (step === 'build_review') {
          buildReviewRuns += 1;
          await writeFile(
            join(dir!, '.pipeline', 'build-review.json'),
            JSON.stringify(buildReviewRuns === 1
              ? {
                  verdict: 'FAIL',
                  reasons: [opts?.completenessFailure
                    ? 'completeness: accepted plan finding'
                    : 'scope: unplanned audit-trail surface'],
                  rubric: {
                    tautology: false,
                    scope: !opts?.completenessFailure,
                    rootCause: false,
                    completeness: opts?.completenessFailure ?? false,
                  },
                }
              : {
                  verdict: 'PASS',
                  rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
                }),
          );
        }
        if (step === 'remediate' && opts?.remediateRefusal) {
          await writeFile(
            join(dir!, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [{
                id: 'accepted-completeness-finding',
                disposition: 'halt',
                category: 'product-scope',
                rationale: 'Planner refuses to choose a rework target.',
                tasks: [],
              }],
            }),
          );
        }
        return { success: true };
      },
    };

    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: string; to: string }> = [];
    const invalidatedDispositions: ConductorEvent[] = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
    });
    events.on('build_review_disposition_version_invalidated', (event) => {
      invalidatedDispositions.push(event);
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      buildReviewEffectiveResolver: resolver,
    });

    await conductor.run();
    return { dispatched, kickbacks, invalidatedDispositions, buildReviewRuns: () => buildReviewRuns };
  }

  it('drops the kickback and re-lands build_review when every finding is accepted at routing time', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted-scope-finding'], unresolved: [] }));

    const { dispatched, kickbacks, buildReviewRuns } = await fixture(resolver);

    expect(resolver).toHaveBeenCalled();
    // The raw FAIL never routed rework: no build dispatch, no kickback event.
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    // build_review re-ran and settled from the disposition-aware join.
    expect(buildReviewRuns()).toBe(2);
  });

  it('re-lands build_review instead of halting when an accepted completeness finding meets a remediate refusal', async () => {
    const resolver = vi.fn(async () => effective({
      accepted: ['sha256:accepted-completeness-finding'],
      unresolved: [],
    }));

    const { dispatched, kickbacks, buildReviewRuns } = await fixture(resolver, {
      completenessFailure: true,
      remediateRefusal: true,
    });

    expect(dispatched).toContain('remediate');
    expect(dispatched).not.toContain('build');
    expect(kickbacks).toEqual([]);
    expect(buildReviewRuns()).toBe(2);
    await expect(readFile(join(dir!, '.pipeline/HALT'), 'utf-8')).rejects.toThrow();
  });

  it('lets the raw-FAIL resolver report a non-binding disposition on the event spine', async () => {
    const resolver = vi.fn(async (_projectRoot, _aggregate, deps) => {
      await deps.emit({
        type: 'build_review_disposition_version_invalidated',
        feature: 'feature', findingId: 'sha256:superseded', rubric: 'scope', contractVersion: 'v1',
      });
      return effective({ accepted: ['sha256:accepted-scope-finding'], unresolved: [] });
    });

    const { invalidatedDispositions } = await fixture(resolver);

    expect(invalidatedDispositions).toEqual([{
      type: 'build_review_disposition_version_invalidated',
      feature: 'feature', findingId: 'sha256:superseded', rubric: 'scope', contractVersion: 'v1',
    }]);
  });

  it('keeps the kickback when unresolved findings remain despite a partial acceptance', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks } = await fixture(resolver);

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });

  it('keeps the kickback when the disposition store is unavailable (fail-open to raw routing)', async () => {
    const resolver = vi.fn(async () => ({ ok: false as const, reason: 'build-review disposition state is unavailable' }));

    const { dispatched, kickbacks } = await fixture(resolver);

    expect(kickbacks).toEqual([{ from: 'build_review', to: 'build' }]);
    expect(dispatched).toContain('build');
  });

  it('keeps an unresolved finding on the existing cumulative-cap path, preserving its cap reason and HALT class', async () => {
    const resolver = vi.fn(async () => effective({ accepted: ['sha256:accepted'], unresolved: ['sha256:still-open'] }));

    const { dispatched, kickbacks } = await fixture(resolver, {
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
    expect(await readFile(join(dir!, '.pipeline/HALT'), 'utf-8')).toContain(
      'build_review cumulative kickback cap exceeded (cumulative 6, cap 5): scope: unplanned audit-trail surface',
    );
    expect(await readFile(join(dir!, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human');
    expect(JSON.parse(await readFile(join(dir!, '.pipeline/kickback-ledger.json'), 'utf-8'))).toMatchObject({
      gates: { build_review: { count: 1, cumulative: 6 } },
    });
  });

  it('keeps the raw-FAIL HALT reasons distinct, classified, and exhaustively guarded at their exit sites', async () => {
    const source = await readFile(new URL('../../src/engine/conductor.ts', import.meta.url), 'utf-8');
    const rawFailStart = source.indexOf('// build_review kickback (daemon only, Task 13)');
    const rawFailEnd = source.indexOf('// Task 8: Stall remediation', rawFailStart);
    expect(rawFailStart).toBeGreaterThanOrEqual(0);
    expect(rawFailEnd).toBeGreaterThan(rawFailStart);
    const rawFailBlock = source.slice(rawFailStart, rawFailEnd);

    for (const reason of [
      'build_review scope-FAIL disposition HALT:',
      'build_review kickback-to-build no-op:',
      'build_review cumulative kickback cap exceeded',
      'build_review completeness FAIL needs a human:',
      'build_review FAIL unresolved after',
    ]) {
      expect(rawFailBlock).toContain(reason);
    }
    expect((rawFailBlock.match(/writeHaltMarker\([^\n]+, 'needs-human'\)/g) ?? [])).toHaveLength(5);

    // Task 11 derived ten terminal outcomes after the effective-PASS helper.
    // Their fifteen concrete control primitives cover stale-mirage
    // halt/regrade, no-op halt, budget consume, cumulative halt,
    // remediate-refusal halt, merged-PR return, ordinary route, and per-gate
    // halt. A new raw-FAIL exit changes this count and must add an adjacent
    // effective-verdict decision instead of silently bypassing dispositions.
    const helperEnd = rawFailBlock.indexOf('// Task 8 (build-review-grades-plan-vs-diff-against-a-stale-o):');
    const exitRegion = rawFailBlock.slice(helperEnd);
    const terminalActions = exitRegion.match(
      /await this\.writeHaltMarker|i = i - 1|await consumeKickbackBudget|await emitTracked\(|return;/g,
    ) ?? [];
    expect(terminalActions).toHaveLength(15);
    expect((exitRegion.match(/if \(await reenterBuildReviewIfEffectivePass\(\)\) continue;/g) ?? [])).toHaveLength(7);
  });
});
