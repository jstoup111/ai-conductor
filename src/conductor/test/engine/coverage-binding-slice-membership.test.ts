// Covers: task:12
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import {
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const slicedPlan = (task4Slice = 1, remediation = false, secondTitle = 'Publication') => [
  '# Plan',
  '',
  '## Slices',
  '',
  '| Slice | Title | Tasks |',
  '| --- | --- | --- |',
  `| 1 | Foundation | 1, 2${task4Slice === 1 ? ', 4' : ''} |`,
  `| 2 | ${secondTitle} | 3${task4Slice === 2 ? ', 4' : ''} |`,
  '',
  '### Task 1: Foundation',
  '**Dependencies:** none',
  '',
  '### Task 2: Foundation',
  '**Dependencies:** none',
  '',
  '### Task 3: Publication',
  '**Dependencies:** none',
  '',
  '### Task 4: Movable work',
  '**Dependencies:** none',
  ...(remediation ? ['', '### Task rem-build-review-2: Repair', '**Dependencies:** none'] : []),
].join('\n');

const unslicedPlan = () => [
  '# Plan',
  '',
  '### Task 1: Work',
  '**Dependencies:** none',
].join('\n');

function memoryEnvelopeFilesystem(files: Record<string, string> = {}) {
  const writes: CoverageBindingEnvelope[] = [];
  const filesystem: CoverageBindingEnvelopeFilesystem = {
    readFile: async (path) => {
      if (!(path in files)) throw new Error('missing');
      return files[path]!;
    },
    mkdir: async () => undefined,
    writeFile: async (path, contents) => { files[path] = contents; },
    rename: async (from, to) => {
      const envelope = parseCoverageBindingEnvelope(JSON.parse(files[from]!));
      if (envelope) writes.push(envelope);
      files[to] = files[from]!;
      delete files[from];
    },
  };
  return { files, filesystem, writes };
}

async function run(plan: string, files: Record<string, string> = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-slice-membership-'));
  const planPath = join(projectDir, 'plan.md');
  await mkdir(join(projectDir, '.docs', 'coherence'), { recursive: true });
  await writeFile(planPath, plan);
  const envelope = memoryEnvelopeFilesystem(files);
  const events: unknown[] = [];
  const eventEmitter = new ConductorEventEmitter();
  eventEmitter.on('plan_slices_changed', (event) => { events.push(event); });
  const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: vi.fn() };
  const runner = new DefaultStepRunner(provider, 'coverage-binding-slice-membership', projectDir, {
    featureDesc: 'coverage-binding-slice-membership',
    planPath,
    config: { coverage_binding: { judge: { enabled: false } } },
    coverageBindingFilesystem: envelope.filesystem,
    events: eventEmitter,
  });
  return { projectDir, envelope, events, runner };
}

describe('coverage-binding slice membership', () => {
  it('records validated membership, excludes remediation ids, and reports only meaningful changes', async () => {
    const first = await run(slicedPlan());
    try {
      await expect(first.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(first.envelope.writes.at(-1)?.sliceMembership).toEqual({
        taskSlices: { '1': 1, '2': 1, '3': 2, '4': 1 },
        titles: ['Foundation', 'Publication'],
      });
      expect(first.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([]);

      const previous = first.envelope.files[coverageBindingEnvelopePath(first.projectDir)]!;
      const moved = await run(slicedPlan(2), { [coverageBindingEnvelopePath(first.projectDir).replace(first.projectDir, '')]: previous });
      try {
        // The injected filesystem is keyed by the runner's temporary project root.
        moved.envelope.files[coverageBindingEnvelopePath(moved.projectDir)] = previous;
        await expect(moved.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(moved.envelope.writes.at(-1)?.sliceMembership?.taskSlices['4']).toBe(2);
        expect(moved.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([{
          type: 'plan_slices_changed', step: 'coverage_binding',
          moved: [{ taskId: '4', from: 1, to: 2 }], added: [], removed: [], manifest: 'unchanged',
        }]);
      } finally {
        await rm(moved.projectDir, { recursive: true, force: true });
      }

      const unchanged = await run(slicedPlan(1), { [coverageBindingEnvelopePath(first.projectDir).replace(first.projectDir, '')]: previous });
      try {
        unchanged.envelope.files[coverageBindingEnvelopePath(unchanged.projectDir)] = previous;
        await expect(unchanged.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(unchanged.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([]);
      } finally {
        await rm(unchanged.projectDir, { recursive: true, force: true });
      }

      const retitled = await run(slicedPlan(1, false, 'Release'));
      try {
        retitled.envelope.files[coverageBindingEnvelopePath(retitled.projectDir)] = previous;
        await expect(retitled.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(retitled.envelope.writes.at(-1)?.sliceMembership?.titles).toEqual(['Foundation', 'Release']);
        expect(retitled.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([{
          type: 'plan_slices_changed', step: 'coverage_binding', moved: [], added: [], removed: [], manifest: 'unchanged',
        }]);
      } finally {
        await rm(retitled.projectDir, { recursive: true, force: true });
      }

      const remediationOnly = await run(slicedPlan(1, true));
      try {
        remediationOnly.envelope.files[coverageBindingEnvelopePath(remediationOnly.projectDir)] = previous;
        await expect(remediationOnly.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(remediationOnly.envelope.writes.at(-1)?.sliceMembership?.taskSlices).not.toHaveProperty('rem-build-review-2');
        expect(remediationOnly.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([]);
      } finally {
        await rm(remediationOnly.projectDir, { recursive: true, force: true });
      }

      const dropped = await run(unslicedPlan());
      try {
        dropped.envelope.files[coverageBindingEnvelopePath(dropped.projectDir)] = previous;
        await expect(dropped.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(dropped.envelope.writes.at(-1)?.sliceMembership).toBeUndefined();
        expect(dropped.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([{
          type: 'plan_slices_changed', step: 'coverage_binding', moved: [], added: [], removed: [], manifest: 'dropped',
        }]);
      } finally {
        await rm(dropped.projectDir, { recursive: true, force: true });
      }
    } finally {
      await rm(first.projectDir, { recursive: true, force: true });
    }
  });

  it('does not treat absent membership as a change baseline and retains disabled behavior for unsliced plans', async () => {
    const { projectDir, envelope, events, runner } = await run(unslicedPlan());
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true, output: 'coverage_binding judge disabled' });
      expect(envelope.writes.at(-1)).toMatchObject({ status: 'disabled' });
      expect(envelope.writes.at(-1)?.sliceMembership).toBeUndefined();
      expect(events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('treats an unsliced predecessor as the baseline for a newly sliced manifest', async () => {
    const initial = await run(unslicedPlan());
    try {
      await expect(initial.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      const subsequent = await run(slicedPlan());
      try {
        subsequent.envelope.files[coverageBindingEnvelopePath(subsequent.projectDir)] = initial.envelope.files[coverageBindingEnvelopePath(initial.projectDir)]!;
        await expect(subsequent.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
        expect(subsequent.events.filter((event) => (event as { type?: string }).type === 'plan_slices_changed')).toEqual([]);
      } finally {
        await rm(subsequent.projectDir, { recursive: true, force: true });
      }
    } finally {
      await rm(initial.projectDir, { recursive: true, force: true });
    }
  });
});
