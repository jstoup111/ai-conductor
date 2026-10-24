// Covers: task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1, task:rem-as-built-rem-prd-audit-rem-vg6-asbuilt-47c9-1
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readVerdict, writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { closureRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, HarnessConfig, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: async () => undefined,
  writeFile,
  rename,
};

afterEach(async () => { await removeAll(cleanup); });

async function writeBlob(git: GitRunner, value: unknown): Promise<string> {
  return (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) })).stdout.trim();
}

async function fixture(): Promise<{ readonly subject: SweepRepository; readonly statePath: string; readonly config: HarnessConfig }> {
  const subject = await createSweepRepository('conductor-routed-leaf-return-', cleanup);
  await subject.write('.ai-conductor/config.yml', [
    'stacked_prs:',
    '  enabled: true',
    '  max_slices: 2',
    '  route_whole_feature_fixes: true',
    'steps:',
    '  post_region_check:',
    '    after: build_review',
    '    skill: custom/SKILL.md',
    '    enforcement: gating',
    '',
  ].join('\n'));
  await subject.write('custom/SKILL.md', '---\nname: custom\n---\n');
  await subject.write('.docs/plans/demo.md', '# Demo plan\n');
  await subject.git(['add', '.ai-conductor/config.yml', 'custom/SKILL.md', '.docs/plans/demo.md']);
  await subject.git(['commit', '-qm', 'configure routed test']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await subject.commit('closed child', 'child.txt', 'child\n');
  await subject.git(['update-ref', closureRefFor('demo', host), closed]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo, [1, 2]);

  const git = makeGitRunner(subject.repo);
  const tree = (await git(['rev-parse', `${closed}^{tree}`])).stdout.trim();
  const record: RouteRecord = {
    roundId,
    kind: 'audit',
    phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
    allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
    hosts: { [host]: 'repairing' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    entry: { host, pinnedBase: closed, tree: tree as never },
  };
  await git(['update-ref', routeRecordRefFor('demo', roundId), await writeBlob(git, record)]);
  await git(['update-ref', repairMarkerRefFor('demo'), await writeBlob(git, { host, roundId })]);

  const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
  const root = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  for (const step of ['acceptance_specs', 'build'] as const) root[step] = 'pending';
  Object.assign(root, {
    feature_desc: 'demo',
    complexity_tier: 'M',
    prd_audit: 'done',
    architecture_review_as_built: 'done',
    manual_test: 'done',
    post_region_check: 'done',
  });
  await writeState(statePath, root);
  await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', host), {
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  });
  for (const gate of ['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[]) {
    await writeVerdict(subject.repo, gate, { satisfied: true, reason: 'stale passing verdict', checkedAt: 1 });
  }

  return {
    subject,
    statePath,
    config: {
      stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true },
      steps: { post_region_check: { after: 'build_review', skill: 'custom/SKILL.md', enforcement: 'gating' } },
    },
  };
}

describe('Conductor routed final leaf return (real local Git)', () => {
  it('returns to whole-feature validation with the root state store and baseline reloaded', async () => {
    const { subject, statePath, config } = await fixture();
    const dispatched: StepName[] = [];
    let leafState: ConductState | undefined;
    let leafSnapshot: ConductState | undefined;
    let persistedRootState: ConductState | undefined;
    let leafVerdicts: Record<string, boolean | undefined> | undefined;
    let parkAfterValidationGroup = false;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'build_review',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events,
      operatorParkBoundary: async () => parkAfterValidationGroup,
      stepRunner: {
        run: async (step, state) => {
          dispatched.push(step);
          if (step === 'manual_test') {
            leafState = { ...state };
            leafSnapshot = {
              ...(conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot,
            };
            const stores = conductor as unknown as {
              stateStore: { read(): Promise<{ ok: true; value: ConductState }> };
              rootStateStore: unknown;
              commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
            };
            expect((conductor as unknown as { activeRegionChild?: number }).activeRegionChild).toBeUndefined();
            expect(stores.stateStore).toBe(stores.rootStateStore);
            persistedRootState = (await stores.stateStore.read()).value;
            leafVerdicts = Object.fromEntries(await Promise.all(
              (['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[])
                .map(async (gate) => [gate, (await readVerdict(subject.repo, gate))?.satisfied] as const),
            ));
            await stores.commitStateChanges(state, 'record first post-return state change', { routed_return_probe: 'recorded' });
            return { success: true };
          }
          if (step === 'architecture_review_as_built') parkAfterValidationGroup = true;
          return { success: true };
        },
      },
    });

    try {
      await conductor.run();
    } finally {
      persister.stop();
    }

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('leaf conduct state is unreadable');
    expect(dispatched[0]).toBe('build_review');
    expect(dispatched).toContain('manual_test');
    expect(dispatched).toContain('prd_audit');
    expect(dispatched).toContain('architecture_review_as_built');
    expect(leafState).toEqual(persistedRootState);
    expect(leafSnapshot).toEqual(persistedRootState);
    const stores = conductor as unknown as {
      stateStore: { read(): Promise<{ ok: true; value: ConductState }> };
      rootStateStore: unknown;
      commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
    };
    expect(stores.stateStore).toBe(stores.rootStateStore);

    for (const gate of ['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[]) {
      expect(leafState?.[gate]).toBe('pending');
      expect(persistedRootState?.[gate]).toBe('pending');
      expect(leafVerdicts?.[gate]).toBe(false);
    }
    expect(leafState?.acceptance_specs).toBe('pending');
    expect(onDisk.value.routed_return_probe).toBe('recorded');
  });
});
