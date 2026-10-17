// Covers: task:20
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { deriveTaskBoundOwner, resolveRemediationTaskChild } from '../../../src/engine/routing/owner-derivation.js';

const envelope: Pick<CoverageBindingEnvelope, 'sliceMembership'> = {
  sliceMembership: {
    taskSlices: { T1: 1, T2: 2, T3: 3 },
    titles: ['First', 'Second', 'Third'],
  },
};

const remTaskId = 'rem-prd-audit-T1';
const remPlan = [
  `### Task ${remTaskId}: Repair audit finding`,
  '**Child:** 1',
].join('\n');

describe('deriveTaskBoundOwner', () => {
  it('recovers rem membership from the feature-slug plan when sibling plans also exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owner-derivation-'));
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({ feature_desc: 'demo' }));
      await writeFile(join(root, '.docs', 'plans', 'demo.md'), remPlan);
      await writeFile(join(root, '.docs', 'plans', 'another-feature.md'), `### Task ${remTaskId}\n**Child:** 2\n`);
      await expect(resolveRemediationTaskChild(root, remTaskId, undefined)).resolves.toEqual({ kind: 'resolved', child: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers committed rem membership from a caller-proven slug after engine-state loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'owner-derivation-'));
    try {
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      await writeFile(join(root, '.docs', 'plans', 'demo.md'), remPlan);
      await writeFile(join(root, '.docs', 'plans', 'another-feature.md'), `### Task ${remTaskId}\n**Child:** 2\n`);
      await expect(resolveRemediationTaskChild(root, remTaskId, undefined, 'demo'))
        .resolves.toEqual({ kind: 'resolved', child: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives an authored task owner from the sealed task slice', () => {
    expect(deriveTaskBoundOwner({
      taskIds: ['T1'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'task-slice' });
  });

  it('prefers a remediation task committed Child line over the cached membership', () => {
    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: remPlan,
      appendedChildren: { [remTaskId]: 2 }, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'rem-child-line' });
  });

  it('uses cached remediation membership when the committed Child line is absent', () => {
    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: `### Task ${remTaskId}: Repair audit finding`,
      appendedChildren: { [remTaskId]: 1 }, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 1, reason: 'rem-cache' });
  });

  it('uses the earliest owner for work bound to several tasks', () => {
    expect(deriveTaskBoundOwner({
      taskIds: ['T2', 'T3'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toEqual({ kind: 'owned', owner: 2, reason: 'multi-task-earliest' });
  });

  it('does not accept a judgement dependency', () => {
    deriveTaskBoundOwner({
      taskIds: ['T1'], envelope, planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
      // @ts-expect-error Task-bound owner derivation is mechanical.
      judge: () => 1,
    });
  });

  it('halts instead of guessing for a missing or undeclared task owner', () => {
    expect(deriveTaskBoundOwner({
      taskIds: ['T2'],
      envelope: { sliceMembership: { taskSlices: { T1: 1 }, titles: ['First'] } },
      planText: '', appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toMatchObject({ kind: 'halt', taskId: 'T2', detail: expect.stringContaining('T2') });

    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope,
      planText: `### Task ${remTaskId}: Repair audit finding\n**Child:** 7`,
      appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toMatchObject({ kind: 'halt', taskId: remTaskId, detail: expect.stringContaining('7') });

    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: `### Task ${remTaskId}: Repair audit finding`,
      appendedChildren: {}, declaredPositions: [1, 2, 3],
    })).toMatchObject({ kind: 'halt', taskId: remTaskId });
  });

  it('rejects an undeclared cached remediation child too', () => {
    expect(deriveTaskBoundOwner({
      taskIds: [remTaskId], envelope, planText: `### Task ${remTaskId}: Repair audit finding`,
      appendedChildren: { [remTaskId]: 7 }, declaredPositions: [1, 2, 3],
    })).toMatchObject({ kind: 'halt', taskId: remTaskId, detail: expect.stringContaining('7') });
  });
});
