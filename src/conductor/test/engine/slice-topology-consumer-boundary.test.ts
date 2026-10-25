// Covers: task:16
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveChild } from '../../src/engine/child-cursor.js';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine');

const IMPORTERS = [
  'artifacts.ts', 'child-cursor.ts', 'child-lifecycle.ts', 'conductor.ts',
  'daemon-dashboard.ts', 'daemon-observe-cli.ts', 'finish-publication-production.ts',
  'reseal-cli.ts', 'routing/owner-derivation.ts', 'routing/round-router.ts',
  'step-runners.ts', 'task-cli.ts', 'task-membership-check-cli.ts', 'task-progress.ts',
];

/*
 * `owner-derivation` and `round-router` receive `SliceTopologyMembership` as
 * a type-only input.  They are deliberately not topology readers: an invalid
 * plan has to be refused before either routing helper can run.  The remaining
 * entries are topology readers and must inspect the loader result rather than
 * manufacture an unsliced fallback.
 */
const READER_ENTRY_POINTS: Readonly<Record<string, readonly string[]>> = {
  'artifacts.ts': ['checkStepCompletion'],
  'child-cursor.ts': ['resolveActiveChild'],
  'child-lifecycle.ts': ['startChild', 'moveLeaf'],
  'conductor.ts': ['Conductor'],
  'daemon-dashboard.ts': ['scanInheritedState'],
  'daemon-observe-cli.ts': ['runDaemonStatus'],
  'finish-publication-production.ts': ['readyStackChildren', 'assembleStack'],
  'reseal-cli.ts': ['dispatchResealCommand'],
  'step-runners.ts': ['DefaultStepRunner'],
  'task-cli.ts': ['dispatchTaskCommand'],
  'task-membership-check-cli.ts': ['runTaskMembershipCheck'],
  'task-progress.ts': ['resolveChildTaskScope'],
};

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

  it('keeps a malformed two-child plan as plan-invalid at every consumer boundary, never a flat topology', async () => {
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

    const sources = new Map((await Promise.all(IMPORTERS.map(async (path) => [
      path,
      await readFile(join(engineRoot, path), 'utf8'),
    ] as const))));

    for (const [importer, entryPoints] of Object.entries(READER_ENTRY_POINTS)) {
      const source = sources.get(importer)!;
      for (const entryPoint of entryPoints) {
        expect(source, `${importer} must retain ${entryPoint}`).toContain(entryPoint);
      }
      // Every runtime reader must branch on the sealed loader result.  This is
      // the point that carries `plan-invalid` through its own public boundary;
      // `kind: 'unsliced'` is not an error recovery representation.
      expect(source, `${importer} must inspect the unavailable topology`).toMatch(/topology\??\.(?:kind|cause)/);
    }

    // Routing helpers cannot read a plan (the import is type-only), so their
    // entry points require the sealed membership handed to them by a reader.
    // This prevents a malformed plan from reaching routing as flat input.
    for (const [importer, entryPoint] of [
      ['routing/owner-derivation.ts', 'deriveTaskBoundOwner'],
      ['routing/round-router.ts', 'routeAdmittedRound'],
    ] as const) {
      const source = sources.get(importer)!;
      expect(source, `${importer} entry point`).toContain(`function ${entryPoint}`);
      expect(source, `${importer} consumes sealed membership`).toContain('sliceMembership');
      expect(source, `${importer} cannot synthesize flat topology`).not.toContain("kind: 'unsliced'");
    }
  });
});
