// Covers: #3408
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function doneBefore(stopAt: StepName): ConductState {
  const state: ConductState = { feature_desc: 'demo', complexity_tier: 'L' };
  for (const step of ALL_STEPS) {
    if (step.name === stopAt) break;
    state[step.name] = 'done';
  }
  return state;
}

/** A stacked feature mid-BUILD on child 1 whose coverage binding a reseal voided. */
async function fixture(envelope: 'voided' | 'absent') {
  const repo = await mkdtemp(join(tmpdir(), 'stacked-resume-coverage-void-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'coverage-void@example.test']);
  await git(['config', 'user.name', 'Coverage void']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await git(['add', '.gitignore', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/daemon-demo']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  if (envelope === 'voided') {
    await writeCoverageBindingEnvelope(repo, {
      version: 1, slug: 'demo', runId: 'run-1', status: 'invalidated', entries: [],
      sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
      storyOwnership: { S1: 1, S2: 2 },
      predecessor: { status: 'done', recordedDigests: false },
    }, envelopeFilesystem);
  }
  const statePath = join(repo, '.pipeline', 'conduct-state.json');
  await writeState(statePath, { ...doneBefore('coverage_binding'), coverage_binding: 'stale' });
  return { repo, statePath };
}

async function resume(repo: string, statePath: string): Promise<StepName[]> {
  const dispatched: StepName[] = [];
  const conductor = new Conductor({
    projectRoot: repo,
    stateFilePath: statePath,
    featureSlug: 'demo',
    resume: true,
    verifyArtifacts: false,
    events: new ConductorEventEmitter(),
    stepRunner: {
      run: async (step) => {
        dispatched.push(step);
        return { success: false, operatorParkedBeforeDispatch: true };
      },
    },
  });
  await conductor.run();
  return dispatched;
}

describe('stacked resume after a DECIDE change voids coverage binding', () => {
  it('re-dispatches coverage_binding without a child-cursor halt', async () => {
    const { repo, statePath } = await fixture('voided');

    const dispatched = await resume(repo, statePath);

    expect(dispatched[0]).toBe('coverage_binding');
    await expect(access(join(repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still fails closed when the envelope is absent rather than voided', async () => {
    const { repo, statePath } = await fixture('absent');

    const dispatched = await resume(repo, statePath);

    expect(dispatched).toEqual([]);
  });

  it('rewind names the halt-clear recovery instead of a bare envelope-missing refusal', async () => {
    const { repo } = await fixture('voided');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => { errors.push(String(message)); });

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, repo)).resolves.toBe(1);

    expect(errors.join('\n')).toContain('coverage binding was voided by a DECIDE change');
    expect(errors.join('\n')).not.toContain('active child resolution refused');
  });
});
