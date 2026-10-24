// Covers: task:9, task:207
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyGreenAcceptance: vi.fn(),
  selfHealAcceptanceRed: vi.fn(),
  drainRoutingOutboxes: vi.fn(async () => ({ kind: 'drained' as const })),
}));

vi.mock('../../../src/engine/routing/host-region-entry.js', () => ({
  enterHostRegion: vi.fn(),
  verifyGreenAcceptance: (...args: unknown[]) => mocks.verifyGreenAcceptance(...args),
}));
vi.mock('../../../src/engine/acceptance-red-runner.js', () => ({
  selfHealAcceptanceRed: (...args: unknown[]) => mocks.selfHealAcceptanceRed(...args),
}));
vi.mock('../../../src/engine/routing/route-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/route-record-store.js')>();
  return {
    ...actual,
    drainRoutingOutboxes: () => mocks.drainRoutingOutboxes(),
  };
});

import { Conductor } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { StepRunner } from '../../../src/engine/step-runner-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => {
  mocks.verifyGreenAcceptance.mockReset();
  mocks.selfHealAcceptanceRed.mockReset();
  mocks.drainRoutingOutboxes.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function routedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'conductor-routed-verify-green-'));
  roots.push(root);
  const childDir = join(root, '.pipeline', 'children', '1');
  await mkdir(childDir, { recursive: true });
  const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    ...parentState,
    feature_desc: 'demo',
  }));
  await writeFile(join(childDir, 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
  }));
  return { root };
}

function routedConductor(root: string, events: ConductorEventEmitter, runner: StepRunner) {
  const cursor = {
    kind: 'repair-pending' as const,
    child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
    branch: 'feat/daemon-demo', repairChildren: [child],
    routedRepair: { child, roundId },
  };
  return new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo',
    fromStep: 'acceptance_specs',
    mode: 'auto', daemon: true, verifyArtifacts: true,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
    events,
    stepRunner: runner,
    acceptanceRedExec: vi.fn(),
    childRegionLifecycle: {
      resolveActiveChild: async () => cursor,
      enterHostRegion: async () => ({ kind: 'resume', pinnedBase: 'a'.repeat(40) }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }) as never,
    },
  });
}

describe('Conductor routed acceptance verify-green path', () => {
  it('uses the routed exit exactly once instead of advancing or closing the host child region', async () => {
    const { root } = await routedFixture();
    await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    }));
    const advanceChildRegion = vi.fn();
    const requestRoutedExit = vi.fn(async () => ({ kind: 'no-commit-done' as const }));
    const resolveActiveChild = vi.fn()
      // The routed receipt ledger probes the cursor before BUILD entry.
      .mockResolvedValueOnce({
        kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo',
      })
      .mockResolvedValueOnce({
        kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo',
      })
      .mockResolvedValueOnce({
        kind: 'repair-pending', child, position: child, isLeaf: false, branch: 'feat/c1/demo',
        repairChildren: [child], routedRepair: { child, roundId },
      })
      .mockResolvedValueOnce({ kind: 'no-child' });
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      fromStep: 'build_review',
      mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(),
      stepRunner: runner,
      acceptanceRedExec: vi.fn(),
      childRegionLifecycle: {
        resolveActiveChild,
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
        advanceChildRegion,
        requestRoutedExit,
      },
    });

    await conductor.run();

    expect(requestRoutedExit).toHaveBeenCalledTimes(1);
    expect(requestRoutedExit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'demo', roundId, host: child }));
    // advanceChildRegion is the sole path that calls closeChild, so proving it
    // is untouched proves the routed exit cannot close this host directly.
    expect(advanceChildRegion).not.toHaveBeenCalled();
    expect(mocks.drainRoutingOutboxes).toHaveBeenCalledOnce();
  });

  it('settles a refused verify-green without self-healing RED, dispatching, or reporting success', async () => {
    const { root } = await routedFixture();
    mocks.verifyGreenAcceptance.mockResolvedValue({ kind: 'refused', reason: 'routed acceptance specs are not green' });
    const events = new ConductorEventEmitter();
    const receipts: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => { receipts.push(event as unknown as Record<string, unknown>); });
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };

    await routedConductor(root, events, runner).run();

    expect(mocks.verifyGreenAcceptance).toHaveBeenCalledTimes(1);
    expect(mocks.selfHealAcceptanceRed).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalledWith('acceptance_specs', expect.anything());
    expect(receipts).not.toContainEqual(expect.objectContaining({ state: 'satisfied', mode: 'verify-green' }));
    expect((await readFile(join(root, '.pipeline', 'HALT'), 'utf8')).trim()).toBe('routed acceptance specs are not green');
  });

  it('runs verify-green from acceptance_specs, never self-heals RED, and emits its distinct receipt', async () => {
    const { root } = await routedFixture();
    mocks.verifyGreenAcceptance.mockResolvedValue({ kind: 'verified', headSha: 'a'.repeat(40) });
    const events = new ConductorEventEmitter();
    const receipts: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => { receipts.push(event as unknown as Record<string, unknown>); });
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };
    const conductor = routedConductor(root, events, runner);

    await conductor.run();

    expect(mocks.verifyGreenAcceptance).toHaveBeenCalledWith(expect.objectContaining({
      worktree: root, slug: 'demo', roundId, host: child,
    }));
    expect(mocks.selfHealAcceptanceRed).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalledWith('acceptance_specs', expect.anything());
    expect(receipts).toContainEqual(expect.objectContaining({
      type: 'acceptance_red', state: 'satisfied', step: 'acceptance_specs', mode: 'verify-green',
    }));
    expect(receipts.find((receipt) => receipt.mode === 'verify-green')).not.toHaveProperty('viaException');
  });
});
