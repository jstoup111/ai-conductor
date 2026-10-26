// Covers: task:9, task:207
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyGreenAcceptance: vi.fn(),
  selfHealAcceptanceRed: vi.fn(),
  drainRoutingOutboxes: vi.fn(async () => ({ kind: 'drained' as const })),
  reconcileRounds: undefined as undefined | (() => Promise<unknown>),
  consumeLowestQueued: undefined as undefined | (() => Promise<unknown>),
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
vi.mock('../../../src/engine/routing/round-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-admission.js')>();
  return {
    ...actual,
    reconcileRounds: (...args: Parameters<typeof actual.reconcileRounds>) =>
      mocks.reconcileRounds === undefined ? actual.reconcileRounds(...args) : mocks.reconcileRounds(),
  };
});
vi.mock('../../../src/engine/routing/revalidation-queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/revalidation-queue.js')>();
  return {
    ...actual,
    consumeLowestQueued: (...args: Parameters<typeof actual.consumeLowestQueued>) =>
      mocks.consumeLowestQueued === undefined ? actual.consumeLowestQueued(...args) : mocks.consumeLowestQueued(),
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
  mocks.reconcileRounds = undefined;
  mocks.consumeLowestQueued = undefined;
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

function routedConductor(root: string, events: ConductorEventEmitter, runner: StepRunner, host = child) {
  const cursor = {
    kind: 'repair-pending' as const,
    child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
    branch: 'feat/daemon-demo', repairChildren: [host],
    routedRepair: { child: host, roundId },
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
        // A routed leaf still owns a marker and must take the routed exit;
        // the ordinary non-leaf closure guard must not bypass it.
        kind: 'repair-pending', child, position: child, isLeaf: true, branch: 'feat/daemon-demo',
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

  it('keeps the HALT a refused routed exit wrote instead of replacing it with a generic refusal', async () => {
    const { root } = await routedFixture();
    await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    }));
    const restackHalt = 'restack refused (cascade-cap) child 1\noriginating child 1 reached 3/3 cascades\n';
    const requestRoutedExit = vi.fn(async () => {
      await writeFile(join(root, '.pipeline', 'HALT'), restackHalt);
      return { kind: 'halted' as const, detail: 'routed exit host 1: halted' };
    });
    const active = { kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' } as const;
    const resolveActiveChild = vi.fn()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce({
        kind: 'repair-pending', child, position: child, isLeaf: true, branch: 'feat/daemon-demo',
        repairChildren: [child], routedRepair: { child, roundId },
      });
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
        advanceChildRegion: vi.fn(),
        requestRoutedExit,
      },
    });

    await conductor.run();

    expect(requestRoutedExit).toHaveBeenCalledOnce();
    expect(await readFile(join(root, '.pipeline', 'HALT'), 'utf8')).toBe(restackHalt);
  });

  // Covers: task:rem-prd-audit-rem-vg5-s6-1
  it('enters r2 after r1 closes deferred, without dispatching whole-feature audit or completing', async () => {
    const { root } = await routedFixture();
    await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    }));
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
    }));
    // r1's leaf host has just exited. Reconciliation closes r1 but must
    // report deferred while r2 remains open for child 2.
    mocks.reconcileRounds = async () => ({ kind: 'deferred' });
    mocks.consumeLowestQueued = async () => ({ kind: 'none' });
    const requestRoutedExit = vi.fn(async () => ({ kind: 'no-commit-done' as const }));
    const nextHost = parseChildId(2)!;
    const nextRound = parseRoundId('r2')!;
    const enteredHosts: number[] = [];
    const resolveActiveChild = vi.fn()
      .mockResolvedValueOnce({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' })
      .mockResolvedValueOnce({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' })
      .mockResolvedValueOnce({
        kind: 'repair-pending', child, position: child, isLeaf: true, branch: 'feat/daemon-demo',
        repairChildren: [child], routedRepair: { child, roundId },
      })
      .mockImplementationOnce(async () => {
        enteredHosts.push(nextHost);
        return {
          kind: 'repair-pending', child: nextHost, position: nextHost, isLeaf: true, branch: 'feat/daemon-demo',
          repairChildren: [nextHost], routedRepair: { child: nextHost, roundId: nextRound },
        };
      });
    const dispatched: string[] = [];
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build_review', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          if (step === 'build_review') return { success: true };
          throw new Error('stop after next routed host selection');
        },
      },
      acceptanceRedExec: vi.fn(),
      childRegionLifecycle: {
        resolveActiveChild,
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
        requestRoutedExit,
      },
    });

    await conductor.run();

    expect(requestRoutedExit).toHaveBeenCalledOnce();
    // The fourth lookup is the next routed host selected after the deferred
    // reconciliation; the prior implementation jumped directly to prd_audit.
    expect(resolveActiveChild.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(enteredHosts).toEqual([nextHost]);
    expect(dispatched).not.toContain('prd_audit');
    await expect(readFile(join(root, '.pipeline', 'DONE'), 'utf8')).rejects.toThrow();
  });

  // Covers: task:rem-prd-audit-rem-vg5-s6-1
  it('enters the admitted revalidation host from a deferred reconciliation before prd_audit', async () => {
    const { root } = await routedFixture();
    await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    }));
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
    }));
    const nextHost = parseChildId(2)!;
    const nextRound = parseRoundId('r2')!;
    const enteredHosts: number[] = [];
    mocks.reconcileRounds = async () => ({ kind: 'deferred' });
    // The r1 close reveals a queued revalidation. Its atomic admission opens
    // r2, so selecting prd_audit here would skip durable routed work.
    const consumeLowestQueued = vi.fn(async () => ({ kind: 'admitted' as const, roundId: nextRound, host: nextHost }));
    mocks.consumeLowestQueued = consumeLowestQueued;
    const requestRoutedExit = vi.fn(async () => ({ kind: 'no-commit-done' as const }));
    const resolveActiveChild = vi.fn()
      .mockResolvedValueOnce({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' })
      .mockResolvedValueOnce({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' })
      .mockResolvedValueOnce({
        kind: 'repair-pending', child, position: child, isLeaf: true, branch: 'feat/daemon-demo',
        repairChildren: [child], routedRepair: { child, roundId },
      })
      .mockImplementationOnce(async () => {
        enteredHosts.push(nextHost);
        return {
          kind: 'repair-pending', child: nextHost, position: nextHost, isLeaf: true, branch: 'feat/daemon-demo',
          repairChildren: [nextHost], revalidating: { child: nextHost, generation: 2 },
        };
      });
    const dispatched: string[] = [];
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build_review', mode: 'auto', daemon: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          if (step === 'build_review') return { success: true };
          throw new Error('stop after queued revalidation host entry');
        },
      },
      acceptanceRedExec: vi.fn(),
      childRegionLifecycle: {
        resolveActiveChild,
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
        requestRoutedExit,
      },
    });

    await conductor.run();

    expect(consumeLowestQueued).toHaveBeenCalledOnce();
    expect(enteredHosts).toEqual([nextHost]);
    expect(dispatched).not.toContain('prd_audit');
    await expect(readFile(join(root, '.pipeline', 'DONE'), 'utf8')).rejects.toThrow();
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

  it('dispatches the leaf host through ordinary acceptance_specs instead of verify-green', async () => {
    const { root } = await routedFixture();
    const leaf = parseChildId(2)!;
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
    }));
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };

    await routedConductor(root, new ConductorEventEmitter(), runner, leaf).run();

    // The leaf never closes, so it has no close-time RED ref for verify-green
    // to compare against; it proves itself through the ordinary step.
    expect(mocks.verifyGreenAcceptance).not.toHaveBeenCalled();
    expect(runner.run.mock.calls.map((call) => (call as unknown[])[0])).toContain('acceptance_specs');
  });

  it('expects a verify-green record at completion for a routed child host but not for the leaf host', async () => {
    const { root } = await routedFixture();
    // completionCtx only derives the routed expectation with a resolvable HEAD.
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base');
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };
    const contextFor = (host: ReturnType<typeof parseChildId> & {}) =>
      (routedConductor(root, new ConductorEventEmitter(), runner, host) as unknown as {
        completionCtx: (state: Record<string, unknown>) => Promise<{ routedVerifyGreen?: unknown }>;
      }).completionCtx({ feature_desc: 'demo' });

    await expect(contextFor(child)).resolves.toMatchObject({ routedVerifyGreen: { roundId, host: child } });
    // The leaf never closes and never runs verify-green, so its ordinary
    // acceptance_specs completion predicate applies.
    expect((await contextFor(parseChildId(2)!)).routedVerifyGreen).toBeUndefined();
  });
});
