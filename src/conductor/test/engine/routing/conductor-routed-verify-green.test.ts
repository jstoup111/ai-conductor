// Covers: task:207
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyGreenAcceptance: vi.fn(),
  selfHealAcceptanceRed: vi.fn(),
}));

vi.mock('../../../src/engine/routing/host-region-entry.js', () => ({
  enterHostRegion: vi.fn(),
  verifyGreenAcceptance: (...args: unknown[]) => mocks.verifyGreenAcceptance(...args),
}));
vi.mock('../../../src/engine/acceptance-red-runner.js', () => ({
  selfHealAcceptanceRed: (...args: unknown[]) => mocks.selfHealAcceptanceRed(...args),
}));

import { Conductor } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => {
  mocks.verifyGreenAcceptance.mockReset();
  mocks.selfHealAcceptanceRed.mockReset();
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

describe('Conductor routed acceptance verify-green path', () => {
  it('runs verify-green from acceptance_specs, never self-heals RED, and emits its distinct receipt', async () => {
    const { root } = await routedFixture();
    mocks.verifyGreenAcceptance.mockResolvedValue({ kind: 'verified', headSha: 'a'.repeat(40) });
    const events = new ConductorEventEmitter();
    const receipts: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => { receipts.push(event as unknown as Record<string, unknown>); });
    const cursor = {
      kind: 'repair-pending' as const,
      child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [child],
      routedRepair: { child, roundId },
    };
    const runner = { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) };
    const conductor = new Conductor({
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
