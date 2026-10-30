// Covers: task:16, task:31
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveChild } from '../../src/engine/child-cursor.js';
import { startChild } from '../../src/engine/child-lifecycle.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { resolveChildTaskScope } from '../../src/engine/task-progress.js';
import { runTaskMembershipCheck } from '../../src/engine/task-membership-check-cli.js';
import { detectTaskCommand, dispatchTaskCommand } from '../../src/engine/task-cli.js';
import { deriveTaskBoundOwner } from '../../src/engine/routing/owner-derivation.js';
import { routeAdmittedRound } from '../../src/engine/routing/round-router.js';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine');

const IMPORTERS = [
  'artifacts.ts', 'child-cursor.ts', 'child-lifecycle.ts', 'conductor.ts',
  'daemon-dashboard.ts', 'daemon-observe-cli.ts', 'finish-publication-production.ts',
  'reseal-cli.ts', 'routing/operator-round.ts', 'routing/owner-derivation.ts', 'routing/round-router.ts',
  'stack-commit-guard-cli.ts', 'stack-land-cli.ts', 'stack-owners-cli.ts', 'stack-rounds-cli.ts', 'step-runners.ts', 'task-cli.ts', 'task-membership-check-cli.ts', 'task-progress.ts',
];

/*
 * `owner-derivation` and `round-router` receive `SliceTopologyMembership` as
 * a type-only input.  They are deliberately not topology readers: an invalid
 * plan has to be refused before either routing helper can run.  The remaining
 * entries are topology readers and must inspect the loader result rather than
 * manufacture an unsliced fallback.
 */
let projectRoot: string;

async function malformedTwoChildPlan(): Promise<void> {
  await Promise.all([
    mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true }),
    mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true }),
  ]);
  // Two declared child tasks make this a stack-shaped input; the deliberately
  // short second row makes the Slices table invalid rather than flat.
  await writeFile(join(projectRoot, '.docs', 'plans', 'demo.md'), [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', '## Slices', '',
    '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | Foundation | 1 |', '| 2 | Delivery |', '',
    '### Task 1: Foundation', '**Story:** Story 1', '**Dependencies:** none', '',
    '### Task 2: Delivery', '**Story:** Story 2', '**Dependencies:** 1', '',
  ].join('\n'));
  await writeFile(join(projectRoot, '.docs', 'stories', 'demo.md'), '# Stories\n\n## Story 1: Foundation\n\n## Story 2: Delivery\n');
}

describe('slice-topology consumer boundary', () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'slice-topology-consumer-boundary-'));
    await malformedTwoChildPlan();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps sealed-plan topology behind its explicit production readers', async () => {
    const paths = (await readdir(engineRoot, { recursive: true })).filter((path) => path.endsWith('.ts'));
    const importers = (await Promise.all(paths.map(async (path) => ({
      path,
      source: await readFile(join(engineRoot, path), 'utf8'),
    })))).filter(({ source }) => /from\s*['"][^'"]*slice-topology\.js['"]/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(importers).toEqual(IMPORTERS);
  });

  it('keeps a malformed two-child plan as plan-invalid at its runtime consumer boundaries, never a flat topology', async () => {
    const topology = await loadSliceTopology(projectRoot, 'demo');
    expect(topology).toMatchObject({ kind: 'unavailable', cause: 'plan-invalid' });
    if (topology.kind !== 'unavailable') throw new Error('fixture must remain malformed');

    // The cursor is the first live consumer reached by resume. Durable child
    // state makes the failure unambiguously stacked, so `no-child` (the flat
    // result) would be a regression.
    await mkdir(join(projectRoot, '.pipeline', 'children', '1'), { recursive: true });
    await expect(resolveActiveChild(projectRoot, 'demo')).resolves.toMatchObject({
      kind: 'topology-unavailable', cause: 'plan-invalid',
    });

    // These public reader boundaries each load the sealed topology themselves.
    // A malformed stack-shaped plan must be refused with its typed cause, never
    // flattened into a no-child or unsliced fallback.
    await expect(startChild(projectRoot, 'demo', parseChildId(1)!, new ConductorEventEmitter()))
      .resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining('plan-invalid') });
    await expect(resolveChildTaskScope(projectRoot, parseChildId(1)!))
      .resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining('plan-invalid') });

    const messagePath = join(projectRoot, 'COMMIT_EDITMSG');
    await writeFile(messagePath, 'fix: malformed stack\n\nTask: 1\n');
    const membershipOutput: string[] = [];
    await expect(runTaskMembershipCheck({
      projectRoot,
      commitMessagePath: messagePath,
      symbolicRef: async () => 'feat/c1/demo',
      print: (line) => membershipOutput.push(line),
    })).resolves.toBe(1);
    expect(membershipOutput.join('\n')).toContain('plan-invalid');

    const taskErrors: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => { taskErrors.push(line); };
    try {
      await expect(dispatchTaskCommand(
        detectTaskCommand(['node', 'conduct', 'task', 'status', '--child', '1'])!,
        projectRoot,
      )).resolves.toBe(1);
    } finally {
      console.error = originalError;
    }
    expect(taskErrors.join('\n')).toContain('plan-invalid');

    // Routing is deliberately type-only. Give it the no-membership value a
    // reader retains when topology is unavailable; neither helper may invent
    // an unsliced/flat owner from it.
    const unavailableMembership = { taskSlices: {}, titles: [] };
    expect(deriveTaskBoundOwner({
      taskIds: ['1'], sliceMembership: unavailableMembership, planText: '', appendedChildren: {}, declaredPositions: [],
    })).toMatchObject({ kind: 'halt', detail: expect.stringContaining('cannot derive an owner') });
    await expect(routeAdmittedRound({
      admitted: [{ id: 'malformed', provenance: { kind: 'task-bound' }, ownerTaskIds: ['1'], citedPaths: [], gateSource: 'build_review', gap: { criterion: 'C', rationale: 'r' } } as never],
      sliceMembership: unavailableMembership,
      planText: '', appendedChildren: {}, declaredPositions: [], leafTip: 'unused', roundId: 'r1' as never,
      git: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    })).resolves.toMatchObject({ kind: 'halt', detail: expect.stringContaining('cannot derive an owner') });
  });
});
