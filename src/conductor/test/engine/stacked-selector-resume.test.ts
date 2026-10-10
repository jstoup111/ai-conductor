// Covers: task:10.2
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseChildId } from '../../src/engine/child-context.js';
import { readConductStateOverlay } from '../../src/engine/conduct-state-store.js';
import { Conductor, findResumeIndex, resolveRunnableResumeEntry } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { selectNextGate } from '../../src/engine/selector.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let root: string;

async function git(args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

function doneThrough(stopAt: StepName): ConductState {
  const state: ConductState = { complexity_tier: 'M' };
  for (const step of ALL_STEPS) {
    if (step.name === stopAt) break;
    state[step.name] = 'done';
  }
  return state;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stacked-selector-resume-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'selector@example.test']);
  await git(['config', 'user.name', 'Selector Test']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack']);
  await writeFile(join(root, '.git', 'info', 'exclude'), '.pipeline/\n');
  await writeCoverageBindingEnvelope(root, {
    version: 1,
    slug: 'demo',
    runId: 'selector-resume',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);

  const tip = (await git(['rev-parse', 'HEAD'])).trim();
  await git(['branch', 'feat/c1/demo', tip]);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', tip, '']);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('stacked selector and resume overlays', () => {
  it('selects the active child region, not flat region progress', async () => {
    const child = parseChildId(2)!;
    const flat = { ...doneThrough('manual_test'), feature_desc: 'demo' };
    await writeState(join(root, '.pipeline', 'conduct-state.json'), flat);
    await writeState(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), {
      acceptance_specs: 'done',
      build: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
    });

    const initial = await readConductStateOverlay(root, child);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(selectNextGate({
      steps: ALL_STEPS,
      state: initial.value,
      verdicts: {},
      regionStart: 'plan',
    })).toMatchObject({ kind: 'run', step: 'build' });

    await writeState(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), {
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    });
    const complete = await readConductStateOverlay(root, child);
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(selectNextGate({
      steps: ALL_STEPS,
      state: complete.value,
      verdicts: {},
      regionStart: 'plan',
    })).toMatchObject({ kind: 'run', step: 'manual_test' });
  });

  it('resumes and clamps using the active child overlay', async () => {
    const child = parseChildId(2)!;
    const flat = {
      ...doneThrough('manual_test'),
      feature_desc: 'demo',
      // doneThrough('manual_test') stops at build_review. On child entry the
      // routed child state deliberately replaces this flat breadcrumb.
      last_step: 'build_review',
    } as ConductState;
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    await writeState(statePath, flat);
    await writeState(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), {
      acceptance_specs: 'done',
      build: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
    });
    // The flat verdict is deliberately stale. The child PASS must prevent the
    // resume clamp from pulling the candidate back to acceptance_specs.
    await writeVerdict(root, 'acceptance_specs', { satisfied: false, checkedAt: 1 });
    await writeVerdict(root, 'acceptance_specs', { satisfied: true, checkedAt: 1 }, child);

    const overlay = await readConductStateOverlay(root, child);
    expect(overlay.ok).toBe(true);
    if (!overlay.ok) return;
    const buildIndex = ALL_STEPS.findIndex((step) => step.name === 'build');
    expect(findResumeIndex(overlay.value, ALL_STEPS)).toBe(buildIndex);
    expect(resolveRunnableResumeEntry(ALL_STEPS, overlay.value, buildIndex)).toBe(buildIndex);

    const dispatched: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          throw new Error('stop after resume selection');
        },
      },
    });

    await conductor.run();
    expect(dispatched[0]).toBe('build');
  });
});
