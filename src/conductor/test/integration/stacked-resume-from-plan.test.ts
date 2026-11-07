// Covers: task:10
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { createProtectedArtifactSeal, resealProtectedArtifactSeal, type ProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const planPath = '.docs/plans/demo.md';
const storyPath = '.docs/stories/demo.md';
const adrPath = '.docs/decisions/adr-demo.md';

function plan(tasks: { one: string; two: string }, prose = ''): string {
  return [
    '# Implementation Plan: demo', '', `**Stories:** ${storyPath}`, '', prose,
    '## Slices', '', '| Slice | Title | Tasks |', '| --- | --- | --- |',
    `| 1 | Closed | ${tasks.one} |`, `| 2 | Leaf | ${tasks.two} |`, '',
    ...[...tasks.one.split(', '), ...tasks.two.split(', ')].map((id) => [
      `### Task ${id}: Task ${id}`, `**Story:** Story ${Number(id) <= 3 ? 1 : 2}`, '**Dependencies:** none', '',
    ].join('\n')),
  ].join('\n');
}

function resumeState(): ConductState {
  const state: ConductState = { feature_desc: 'demo', complexity_tier: 'M' };
  for (const step of ALL_STEPS) state[step.name] = 'done';
  return state;
}

async function fixture(): Promise<{
  root: string;
  repo: string;
  git: (...args: string[]) => Promise<string>;
  amend(paths: Readonly<Record<string, string>>): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'stacked-resume-from-plan-'));
  roots.push(root);
  const repo = join(root, '.worktrees', 'demo');
  await mkdir(repo, { recursive: true });
  const git = async (...args: string[]) => (await execFile('git', args, { cwd: repo })).stdout.trim();
  const commit = async (message: string) => { await git('add', '.'); await git('commit', '-qm', message); };

  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'stacked-resume@example.test');
  await git('config', 'user.name', 'Stacked Resume');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.docs', 'stories'), { recursive: true });
  await mkdir(join(repo, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await writeFile(join(repo, planPath), plan({ one: '1, 2, 3', two: '4, 5, 6' }));
  await writeFile(join(repo, storyPath), '## Story 1: Closed\n\n## Story 2: Leaf\n');
  await writeFile(join(repo, adrPath), '# ADR\n\nInitial decision.\n');
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await commit('seed stacked topology');

  const base = await git('rev-parse', 'HEAD');
  await git('branch', 'feat/c1/demo', base);
  await git('update-ref', 'refs/conductor/demo/closed/c1', base);
  await git('checkout', '-qb', 'feat/daemon-demo');
  await writeFile(join(repo, 'leaf-branch.txt'), 'leaf branch\n');
  await commit('leaf branch');

  await writeFile(join(repo, 'positions.json'), '[1,2]');
  const positionsBlob = await git('hash-object', '-w', 'positions.json');
  await git('update-ref', 'refs/conductor/demo/positions', positionsBlob);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeState(join(repo, '.pipeline', 'conduct-state.json'), resumeState());
  await writeState(join(repo, '.pipeline', 'children', '2', 'conduct-state.json'), {
    acceptance_specs: 'done', build: 'pending', test_suite: 'done', build_review: 'done',
  });
  await createProtectedArtifactSeal({ projectRoot: repo, baselineCommit: await git('rev-parse', 'HEAD') });

  return {
    root, repo, git,
    amend: async (paths) => {
      for (const [path, content] of Object.entries(paths)) {
        await mkdir(dirname(join(repo, path)), { recursive: true });
        await writeFile(join(repo, path), content);
      }
      await git('add', ...Object.keys(paths));
      await git('commit', '-qm', 'operator amendment');
      const seal = JSON.parse(await readFile(join(repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as ProtectedArtifactSeal;
      await resealProtectedArtifactSeal({
        projectRoot: repo, seal, toCommit: await git('rev-parse', 'HEAD'), trigger: 'operator-reseal',
        paths: Object.keys(paths), reason: 'Approve the amended decision.', featureDesc: 'demo', baseBranch: 'main',
      });
    },
  };
}

async function resume(repo: string, options: { featureSlug?: string; events?: ConductorEventEmitter } = {}) {
  const calls: StepName[] = [];
  const runner: StepRunner = { run: async (step) => { calls.push(step); return { success: true }; } };
  const events = options.events ?? new ConductorEventEmitter();
  const conductor = new Conductor({
    projectRoot: repo, stateFilePath: join(repo, '.pipeline', 'conduct-state.json'), featureSlug: options.featureSlug,
    resume: true, events, stepRunner: runner, mode: 'auto', verifyArtifacts: false,
  });
  await conductor.run();
  return { calls, events };
}

describe('stacked resume from the committed sealed plan', () => {
  it('reseals a positions-preserving plan amendment and resumes child 2 at build without a HALT', async () => {
    const subject = await fixture();
    await subject.amend({ [planPath]: plan({ one: '1, 2, 3', two: '4, 5, 6' }, 'Operator clarified the leaf scope.') });

    const { calls } = await resume(subject.repo);

    expect(calls[0]).toBe('build');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  it('persists executor_started before the resumed build after ADR and story reseals, with no halt record between', async () => {
    const subject = await fixture();
    await subject.amend({ [adrPath]: '# ADR\n\nAmended decision.\n', [storyPath]: '## Story 1: Closed\n\n## Story 2: Amended leaf\n' });
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    await events.emit({ type: 'executor_started', slug: 'demo', engineVersionId: 'test-engine', protocolVersion: 1, supervisorEngineVersionId: 'test-engine' });

    const { calls } = await resume(subject.repo, { events });
    persister.stop();
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent);
    const start = persisted.findIndex((event) => event.type === 'executor_started');
    const build = persisted.findIndex((event) => event.type === 'step_started' && event.step === 'build');

    expect(calls[0]).toBe('build');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(start);
    expect(persisted.slice(start + 1, build)).not.toContainEqual(expect.objectContaining({ type: 'halt_record_written' }));
  });

  it('uses amended plan membership after moving task 4, while a byte-identical reseal still resumes directly at build', async () => {
    const subject = await fixture();
    const moved = plan({ one: '1, 2, 3, 4', two: '5, 6' })
      .replace('### Task 4: Task 4\n**Story:** Story 2', '### Task 4: Task 4\n**Story:** Story 1');
    await subject.amend({ [planPath]: moved });

    const topology = await loadSliceTopology(subject.repo, 'demo');
    expect(topology.kind).toBe('sliced');
    if (topology.kind !== 'sliced') return;
    expect(topology.sliceMembership.taskSlices).toMatchObject({ '4': 1, '5': 2, '6': 2 });
    expect((await resume(subject.repo)).calls[0]).toBe('build');

    const identical = await fixture();
    await identical.amend({ [planPath]: plan({ one: '1, 2, 3', two: '4, 5, 6' }, 'Clarified without changing task membership.') });
    const seal = JSON.parse(await readFile(join(identical.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as ProtectedArtifactSeal;
    await resealProtectedArtifactSeal({
      projectRoot: identical.repo, seal, toCommit: await identical.git('rev-parse', 'HEAD'), trigger: 'operator-reseal',
      paths: [planPath], reason: 'Reconfirm the unchanged amended plan.', featureDesc: 'demo', baseBranch: 'main',
    });
    expect((await resume(identical.repo)).calls).toEqual(['build']);
    await expect(readFile(join(identical.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  it('recreates .pipeline state from the committed plan and closure ref, then enters child 2 without a HALT', async () => {
    const subject = await fixture();
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });
    // A recreated worktree receives fresh dispatch state from its work order,
    // but no cached topology. This deliberately recreates only the run-state
    // inputs required to stop after BUILD; the cursor must derive child 2
    // solely from the committed plan and closure ref.
    await writeState(join(subject.repo, '.pipeline', 'conduct-state.json'), resumeState());
    await writeState(join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json'), {
      acceptance_specs: 'done', build: 'pending', test_suite: 'done', build_review: 'done',
    });

    const { calls } = await resume(subject.repo, { featureSlug: 'demo' });

    expect(calls[0]).toBe('build');
    await expect(readFile(join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8')).resolves.toContain('"build"');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  it('resumes child 2 after positions are restored, resealed, and the positions-changed halt is cleared', async () => {
    const subject = await fixture();
    await writeFile(join(subject.repo, planPath), plan({ one: '1, 2, 3', two: '4, 5, 6' }).replace('| 2 | Leaf | 4, 5, 6 |', '| 3 | Leaf | 4, 5, 6 |'));
    await subject.git('add', planPath);
    await subject.git('commit', '-qm', 'move sealed position');
    await expect(resume(subject.repo)).resolves.toBeDefined();
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('positions-changed');

    await writeFile(join(subject.repo, planPath), plan({ one: '1, 2, 3', two: '4, 5, 6' }));
    await subject.git('add', planPath);
    await subject.git('commit', '-qm', 'restore sealed positions');
    const seal = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'protected-artifact-seal.json'), 'utf8')) as ProtectedArtifactSeal;
    await resealProtectedArtifactSeal({
      projectRoot: subject.repo, seal, toCommit: await subject.git('rev-parse', 'HEAD'), trigger: 'operator-reseal',
      paths: [planPath], reason: 'Restore the recorded positions.', featureDesc: 'demo', baseBranch: 'main',
    });
    await unlink(join(subject.repo, '.pipeline', 'HALT'));
    await unlink(join(subject.repo, '.pipeline', 'HALT.class'));

    expect((await resume(subject.repo)).calls[0]).toBe('build');
  });
});
