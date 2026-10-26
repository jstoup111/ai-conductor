// Covers: task:16, task:50, task:56
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const child = parseChildId(1)!;
const leaf = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'no-op-guard-placement-'));
  roots.push(root);
  const childDir = join(root, '.pipeline', 'children', String(child));
  await mkdir(childDir, { recursive: true });
  const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ ...parentState, feature_desc: 'demo' }));
  await writeFile(join(childDir, 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
  }));
  return root;
}

function routedConductor(root: string, enterHostRegion: NonNullable<ConstructorParameters<typeof Conductor>[0]['childRegionLifecycle']>['enterHostRegion']) {
  const runner = { run: vi.fn(async () => ({ success: true })) };
  const enterChildRegion = vi.fn(async () => ({ kind: 'completed' as const }));
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo',
    fromStep: 'build',
    verifyArtifacts: false,
    events: new ConductorEventEmitter(),
    stepRunner: runner,
    config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'repair-pending' as const, child: leaf, position: leaf, isLeaf: true,
        branch: 'feat/daemon-demo', repairChildren: [child], routedRepair: { child, roundId },
      }),
      enterHostRegion,
      enterChildRegion,
    },
  });
  return { conductor, runner, enterChildRegion };
}

describe('routed host no-op guard placement', () => {
  it('writes the derived-already-complete outcome through the halt marker without treating it as a child refusal', async () => {
    const root = await fixture();
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      async () => ({ kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' }) as never,
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'routed host 1 entry derived already complete: every routed task is already evidence-complete\n' +
      'Outcome: derived-already-complete\n',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('keeps ordinary host-entry halts on the child-refusal path', async () => {
    const root = await fixture();
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      async () => ({ kind: 'halted', detail: 'frozen block rem-prd-audit-T1 conflicts' }) as never,
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'child BUILD region refused: routed host 1 entry halted: frozen block rem-prd-audit-T1 conflicts\n',
    );
  });

  // Covers: task:16
  it('halts needs-human without a provider dispatch when operator round entry is undeclared', async () => {
    const root = await fixture();
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      async () => ({
        kind: 'refused',
        detail: 'operator-round-undeclared: landing r1 on child 1 is awaiting ai-conductor stack land --done or ai-conductor stack land --abandon',
      }) as never,
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'child BUILD region refused: routed host 1 entry refused: ' +
      'operator-round-undeclared: landing r1 on child 1 is awaiting ai-conductor stack land --done or ai-conductor stack land --abandon\n',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });
});
