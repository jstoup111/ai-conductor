import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import * as kickbackLedger from '../../src/engine/kickback-ledger.js';
import { reverifyOrInvalidateRebaseGate, type RebaseOutcome } from '../../src/engine/rebase.js';
import type { RestackCause } from '../../src/engine/restack/restack-types.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent } from '../../src/types/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeKickbackLedger } from '../kickback-ledger-test-support.js';

vi.mock('../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/kickback-ledger.js')>();
  return { ...actual, creditKickbackGateLaps: vi.fn(actual.creditKickbackGateLaps) };
});

describe('advanceTail legacy rebase refund is cause-scoped (sweep)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-sweep-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    vi.mocked(kickbackLedger.creditKickbackGateLaps).mockClear();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function legacyRefundAfter(cause: RestackCause) {
    const statePath = join(dir, 'conduct-state.json');
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
    state.complexity_tier = 'S';
    await writeState(statePath, state);
    await writeKickbackLedger(dir, {
      version: 1,
      gates: { build_review: { count: 1, cumulative: 4, treeHash: '0123456789abcdef0123456789abcdef01234567', lastReason: 'prior', priorVerdict: false, resolvedBefore: 2 } },
    });
    // The production rebase kickback writer records the originating operation's cause.
    await reverifyOrInvalidateRebaseGate(dir, 'build_review', undefined, 'restack invalidated this gate', true, undefined, cause);
    const record = await readVerdict(dir, 'build_review');

    const events = new ConductorEventEmitter();
    const kickbacks: Array<Extract<ConductorEvent, { type: 'kickback' }>> = [];
    events.on('kickback', (event) => { if (event.type === 'kickback') kickbacks.push(event); });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events,
      verifyArtifacts: true,
      config: { build_review: { enabled: true } },
    } as never);
    const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/feature.ts'], featureSurface: ['src/feature.ts'] };
    (conductor as unknown as { lastRebaseOutcome: RebaseOutcome }).lastRebaseOutcome = outcome;
    await (conductor as unknown as {
      advanceTail: (
        step: typeof ALL_STEPS[number], state: ConductState, stuckGate: Map<StepName, number>,
        steps: typeof ALL_STEPS, indexOf: (name: StepName) => number,
      ) => Promise<number | null | 'halt'>;
    }).advanceTail(
      ALL_STEPS.find((step) => step.name === 'rebase')!, state, new Map(), ALL_STEPS,
      (name) => ALL_STEPS.findIndex((step) => step.name === name),
    );
    return { record, kickbacks, ledger: await kickbackLedger.readKickbackLedger(dir) };
  }

  // Covers: task:21
  it('credits no laps from the legacy rebase-step refund for a feature-repair kickback, which carries its cause', async () => {
    const repair = await legacyRefundAfter('feature-repair');
    expect(repair.record).toMatchObject({ satisfied: false, kickback: { from: 'rebase', cause: 'feature-repair' } });
    expect(vi.mocked(kickbackLedger.creditKickbackGateLaps)).not.toHaveBeenCalled();
    expect(repair.ledger.gates.build_review?.cumulative).toBe(4);
    expect(repair.kickbacks).toContainEqual(expect.objectContaining({ from: 'rebase', to: 'build_review' }));
    expect(repair.kickbacks.some((event) => event.convergenceCredit !== undefined)).toBe(false);

    // The same path still refunds a base-refresh kickback, so the spy observes the refund path.
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const refresh = await legacyRefundAfter('base-refresh');
    expect(refresh.record).toMatchObject({ kickback: { from: 'rebase', cause: 'base-refresh' } });
    expect(vi.mocked(kickbackLedger.creditKickbackGateLaps)).toHaveBeenCalledTimes(1);
    expect(refresh.ledger.gates.build_review?.cumulative).toBe(0);
  });
});
