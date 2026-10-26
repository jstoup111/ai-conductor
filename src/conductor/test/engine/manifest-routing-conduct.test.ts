// Covers: task:rem-prd-audit-11
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConductState, Track } from '../../src/types/index.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { resolveReviewInputs } from '../../src/engine/rebase.js';
import { resolveRemediationTaskChild } from '../../src/engine/routing/owner-derivation.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(artifacts: readonly { kind: string; path: string }[]): string {
  return JSON.stringify({ schemaVersion: 1, slug: 'f', artifacts });
}

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'manifest-routing-conduct-'));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([path, text]) => {
    const destination = join(root, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, text);
  }));
  return root;
}

function conductor(root: string): Conductor {
  return new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: { run: vi.fn() },
    events: new ConductorEventEmitter(),
    stateStore: {
      apply: vi.fn().mockResolvedValue({ kind: 'applied' }),
      applyBatch: vi.fn().mockResolvedValue({ kind: 'applied' }),
      replace: vi.fn().mockResolvedValue({ kind: 'applied' }),
    },
  });
}

function resolveTrack(instance: Conductor, state: ConductState): Promise<Track> {
  return (instance as unknown as { resolveTrack(state: ConductState): Promise<Track> }).resolveTrack(state);
}

const plan = '### Task 1: Slice\n**Slice:** 1\n';
const stories = '## Story 1: An outcome\n\n### Happy path\n- Given x, when y, then z.\n';

describe('manifest routing — conduct and BUILD readers', () => {
  it('preserves the legacy track, review-input, and remediation-plan results when a manifest is absent or registers legacy paths', async () => {
    const root = await tree({
      '.pipeline/engine-state.json': JSON.stringify({ feature_desc: 'f' }),
      '.pipeline/conduct-state.json': JSON.stringify({ feature_desc: 'f' }),
      '.docs/plans/f.md': `${plan}\n**Stories:** .docs/stories/f.md\n`,
      '.docs/stories/f.md': stories,
      '.docs/track/f.md': 'Track: technical\n',
      '.docs/coherence/f.md': '| criterion | evidence |\n',
      '.docs/specs/f.md': '# PRD\n',
    });
    const state: ConductState = { feature_desc: 'f' };
    await expect(resolveTrack(conductor(root), state)).resolves.toBe('technical');
    await expect(resolveReviewInputs(root, ['.docs/plans/f.md'], true)).resolves.toEqual(expect.arrayContaining([
      '.docs/plans/f.md', '.docs/coherence/f.md', '.docs/stories/f.md', '.docs/specs/f.md',
    ]));
    await expect(resolveRemediationTaskChild(root, 'rem-build_review-1', undefined, 'f'))
      .resolves.toEqual({ kind: 'unreadable' });

    await mkdir(join(root, '.docs', 'f'), { recursive: true });
    await writeFile(join(root, '.docs', 'f', 'manifest.json'), manifest([
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'stories', path: '.docs/stories/f.md' },
      { kind: 'track', path: '.docs/track/f.md' },
      { kind: 'coherence', path: '.docs/coherence/f.md' },
      { kind: 'prd', path: '.docs/specs/f.md' },
    ]));
    await expect(resolveTrack(conductor(root), { feature_desc: 'f' })).resolves.toBe('technical');
    await expect(resolveReviewInputs(root, ['.docs/plans/f.md'], true)).resolves.toEqual(expect.arrayContaining([
      '.docs/plans/f.md', '.docs/coherence/f.md', '.docs/stories/f.md', '.docs/specs/f.md',
    ]));
  });

  it('uses relocated track, coherence, PRD, and plan artifacts and treats omitted manifest kinds as absent', async () => {
    const root = await tree({
      '.pipeline/engine-state.json': JSON.stringify({ feature_desc: 'f' }),
      '.pipeline/conduct-state.json': JSON.stringify({ feature_desc: 'f' }),
      '.docs/f/manifest.json': manifest([
        { kind: 'plan', path: '.docs/f/plan.md' },
        { kind: 'stories', path: '.docs/f/stories.md' },
        { kind: 'track', path: '.docs/f/track.md' },
        { kind: 'coherence', path: '.docs/f/coherence.md' },
        { kind: 'prd', path: '.docs/f/prd.md' },
      ]),
      '.docs/f/plan.md': `${plan}\n**Stories:** .docs/stories/foreign.md\n`,
      '.docs/f/stories.md': stories,
      '.docs/f/track.md': 'Track: technical\n',
      '.docs/f/coherence.md': '| criterion | relocated |\n',
      '.docs/f/prd.md': '# Relocated PRD\n',
      '.docs/plans/f.md': 'legacy plan',
      '.docs/track/f.md': 'Track: product\n',
      '.docs/coherence/f.md': '| legacy |\n',
      '.docs/specs/f.md': '# Legacy PRD\n',
    });
    await expect(resolveTrack(conductor(root), { feature_desc: 'f' })).resolves.toBe('technical');
    await expect(resolveReviewInputs(root, ['.docs/f/plan.md'], true)).resolves.toEqual(expect.arrayContaining([
      '.docs/f/plan.md', '.docs/f/coherence.md', '.docs/f/stories.md', '.docs/f/prd.md',
    ]));
    await expect(resolveRemediationTaskChild(root, 'rem-build_review-1', undefined, 'f'))
      .resolves.toEqual({ kind: 'unreadable' });

    await writeFile(join(root, '.docs', 'f', 'manifest.json'), manifest([
      { kind: 'plan', path: '.docs/f/plan.md' },
    ]));
    await expect(resolveTrack(conductor(root), { feature_desc: 'f' })).resolves.toBe('product');
  });

  it('fails closed on malformed manifests instead of reading legacy track or remediation-plan inputs', async () => {
    const root = await tree({
      '.pipeline/engine-state.json': JSON.stringify({ activePlanPath: '.docs/plans/g.md' }),
      '.docs/f/manifest.json': '{not json',
      '.docs/plans/f.md': plan,
      '.docs/plans/g.md': plan,
      '.docs/stories/g.md': `${stories}\n### Negative paths\n- Given x, when y fails, then z is rejected.\n`,
      '.docs/track/f.md': 'Track: technical\n',
      'test/cover.ts': 'covered\n',
      '.pipeline/acceptance-specs-red.json': JSON.stringify({
        outcome: 'disposition-only',
        dispositions: [{
          criterion: 'Story 1 happy: Given x, when y, then z.',
          disposition: 'existing-sufficient-test',
          citation: 'test/cover.ts:1',
        }],
      }),
    });
    await expect(resolveTrack(conductor(root), { feature_desc: 'f' }))
      .rejects.toThrow('.docs/f/manifest.json');
    await expect(resolveRemediationTaskChild(root, 'rem-build_review-1', undefined, 'f'))
      .rejects.toThrow('.docs/f/manifest.json');
    await expect(checkStepCompletion(root, 'acceptance_specs', {
      planPath: join(root, '.docs/plans/f.md'),
    })).rejects.toThrow('.docs/f/manifest.json');
  });
});
