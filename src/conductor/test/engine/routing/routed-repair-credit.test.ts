// Covers: task:74
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { kickbackLedgerPathFor, readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { consumeRoutedRepairCredit, grantRoutedRepairCredit } from '../../../src/engine/routing/round-receipt.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { writeState } from '../../../src/engine/state.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { StepRunner } from '../../../src/engine/conductor.js';
import { joinBuildReviewRubricOutcomes } from '../../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../../src/engine/build-review-domain.js';
import { Conductor } from '../../test-conductor.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'routed-repair-credit-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  return root;
}

function failingBuildReviewAggregate() {
  const lapId = parseBuildReviewLapId('routed-credit-lap')!;
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest: 'sha256:routed-credit',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:routed-credit',
        contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'test-insensitive', summary: 'routed review failure', evidenceLocations: ['test/fixture.test.ts:1'],
          anchor: {
            rubric: 'testQuality',
            locus: {
              path: 'test/fixture.test.ts',
              contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              display: 'fixture test',
            },
          },
        }],
      },
    },
  });
}

async function cumulativeCapFixture(credit: 'available' | 'consumed') {
  const root = await fixture();
  const statePath = join(root, '.pipeline', 'conduct-state.json');
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  Object.assign(state, { feature_desc: 'demo', complexity_tier: 'M', run_started_at: 1 });
  await writeState(statePath, state);
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'pending',
  }));
  await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
    version: 1,
    gates: {
      build_review: {
        count: 1, cumulative: 5, treeHash: null, lastReason: 'prior failure', priorVerdict: true, resolvedBefore: 0,
      },
    },
    routedRepairCredit: credit === 'available' ? { roundId: 'r1' } : { roundId: 'r1', consumed: true },
  }));
  const dispatched: StepName[] = [];
  const runner: StepRunner = {
    run: vi.fn(async (step: StepName) => {
      dispatched.push(step);
      if (step === 'build_review') {
        await writeFile(
          join(root, '.pipeline', 'children', '1', 'build-review.json'),
          JSON.stringify(failingBuildReviewAggregate()),
        );
        return { success: true };
      }
      if (step === 'build') throw new Error('stop after routed credit consumption');
      return { success: true };
    }),
  };
  const cursor = {
    kind: 'active' as const,
    child,
    position: child,
    isLeaf: false,
    branch: 'feat/c1/demo',
    routedRepair: { child, roundId },
  };
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: statePath,
    featureSlug: 'demo',
    fromStep: 'build_review',
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
    config: { stacked_prs: { enabled: true }, kickback_escalation: { enabled: false } },
    childRegionLifecycle: {
      resolveActiveChild: async () => cursor,
      enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }),
    },
  } as never);
  return { root, conductor, dispatched };
}

describe('routed repair credit', () => {
  it('grants and consumes exactly one per-child credit for its routing round', async () => {
    const root = await fixture();
    await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
      version: 1,
      gates: {
        build_review: {
          count: 1, cumulative: 5, laps: 3, treeHash: null, lastReason: 'prior failure', priorVerdict: true, resolvedBefore: 0,
          effectiveLimit: 5, effectiveLapCap: 2,
        },
      },
      convergenceCreditReceipts: { 'base-refresh': { gate: 'build_review' } },
    }));
    const before = await readKickbackLedger(root, child);

    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toEqual({ kind: 'granted' });
    const granted = await readKickbackLedger(root, child);
    expect(granted).toMatchObject({
      routedRepairCredit: { roundId: 'r1' },
    });
    expect(granted.gates).toEqual(before.gates);
    expect(granted.convergenceCreditReceipts).toEqual(before.convergenceCreditReceipts);
    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toEqual({ kind: 'already-granted' });
    await expect(consumeRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toBe(true);
    await expect(consumeRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toBe(false);
    await expect(readKickbackLedger(root, child)).resolves.toMatchObject({
      routedRepairCredit: { roundId: 'r1', consumed: true },
    });
  });

  it('fails closed when the persisted routed repair credit is malformed', async () => {
    const root = await fixture();
    await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
      version: 1,
      gates: {},
      routedRepairCredit: { roundId: 'not-a-round' },
    }));
    const before = await readFile(kickbackLedgerPathFor(root, child), 'utf8');

    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).rejects.toThrow('unreadable');
    await expect(readFile(kickbackLedgerPathFor(root, child), 'utf8')).resolves.toBe(before);
  });

  it('lets the first routed build-review failure beyond the cumulative cap re-enter BUILD', async () => {
    const subject = await cumulativeCapFixture('available');

    await subject.conductor.run();
    expect(subject.dispatched).toEqual(['build_review', 'build']);
    await expect(readFile(join(subject.root, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain(
      'build_review cumulative kickback cap exceeded',
    );
    await expect(readKickbackLedger(subject.root, child)).resolves.toMatchObject({
      gates: { build_review: { cumulative: 6 } },
      routedRepairCredit: { roundId: 'r1', consumed: true },
    });
  });

  it('halts needs-human and names the child after the routed credit is spent', async () => {
    const subject = await cumulativeCapFixture('consumed');

    await subject.conductor.run();
    expect(subject.dispatched).toEqual(['build_review']);
    await expect(readFile(join(subject.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('for child 1');
  });
});
