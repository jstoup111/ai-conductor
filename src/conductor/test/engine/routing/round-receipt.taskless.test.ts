// Covers: tasks:33,65,200
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor, type StepRunner } from '../../../src/engine/conductor.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { chargeTasklessAtAdmission } from '../../../src/engine/routing/round-receipt.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture({ route = true }: { readonly route?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-taskless-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), [
    '### Task T1: First authored task',
    '',
    '### Task T2: Second authored task',
    '',
  ].join('\n'));
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  if (route) {
    const made = await createRouteRecord(root, 'demo', {
      roundId, sealedAuthored: 1, kind: 'audit',
      items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'taskless', fallback: [] }],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    }, { git });
    if (made.kind !== 'created') throw new Error(`record creation failed: ${made.kind}`);
  }
  return { root, git };
}

async function admit(root: string, git: ReturnType<typeof makeGitRunner>) {
  const stored = await readRouteRecord(root, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error(`record reread failed: ${stored.kind}`);
  expect((await admitRound(root, 'demo', stored.record, child, { git, persist: async () => 'persisted' })).kind).toBe('admitted');
}

describe('taskless routed admission receipts', () => {
  it.each([
    ['manual_test', { taskless: { manual_test: 1 } }],
    ['custom-step', { echo: { 'lint-docs': 1 } }],
  ])('seals the authored denominator for first-round %s admission', async (kind, receipt) => {
    const subject = await fixture({ route: false });
    await mkdir(join(subject.root, '.pipeline', 'children', '1'), { recursive: true });
    await writeSliceTopologyFixture(subject.root, {
      slug: 'demo',
      sliceMembership: { taskSlices: { T1: 1, T2: 1 }, titles: ['First'] },
    });
    const conductor = new Conductor({
      projectRoot: subject.root,
      stateFilePath: join(subject.root, '.pipeline', 'conduct-state.json'),
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async () => ({ success: true }),
        dispatchResidueRoutingJudgement: async (prompt) => {
          const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
          return {
            success: true,
            output: JSON.stringify({ version: 'v1', items: [{ itemId, child: 1, candidates: [1], rationale: 'fixture' }] }),
          };
        },
      } satisfies StepRunner,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: {
        resolveActiveChild: async () => ({ kind: 'active', child, position: 1, isLeaf: true, branch: 'feat/demo' }) as never,
      },
    });

    const state = { feature_desc: 'demo' };
    const admission = kind === 'manual_test'
      ? (conductor as any).admitRoutedManualTestKickback(state, 'manual-test evidence')
      : (conductor as any).admitRoutedCustomStepKickback(state, 'lint-docs', 1);
    await expect(admission).resolves.toEqual({ kind: 'admitted' });

    await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({
      kind: 'record',
      record: { sealedAuthored: 2, receipt },
    });
  });

  it('persists a complete unsettled manual_test charge before admitting the routed FAIL', async () => {
    const subject = await fixture();
    expect(await chargeTasklessAtAdmission({ projectRoot: subject.root, slug: 'demo', roundId, gate: 'manual_test', routing, git: subject.git })).toEqual({ kind: 'charged', count: 1 });
    expect(await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).toMatchObject({
      kind: 'record', record: { sealedAuthored: 1, receipt: { ...emptyUnsettledReceipt(), taskless: { manual_test: 1 } } },
    });
    await admit(subject.root, subject.git);
  });

  it('persists a complete unsettled lint-docs echo before admitting the routed custom-step FAIL', async () => {
    const subject = await fixture();
    const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
    if (stored.kind !== 'record') throw new Error(`record reread failed: ${stored.kind}`);
    const receipt = { ...emptyUnsettledReceipt(), ...stored.record.receipt, echo: { ...stored.record.receipt.echo, 'lint-docs': 2 } };
    expect((await writeRouteRecord(subject.root, stored, { ...stored.record, receipt }, { git: subject.git })).kind).toBe('updated');
    expect(await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).toMatchObject({
      kind: 'record', record: { sealedAuthored: 1, receipt: { ...emptyUnsettledReceipt(), echo: { 'lint-docs': 2 } } },
    });
    await admit(subject.root, subject.git);
  });
});
