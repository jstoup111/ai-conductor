// Covers: task:rem-prd-audit-W7
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function doneThrough(stopAt: StepName): ConductState {
  const state: ConductState = { feature_desc: 'demo', complexity_tier: 'M' };
  for (const step of ALL_STEPS) {
    if (step.name === stopAt) break;
    state[step.name] = 'done';
  }
  return state;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'conductor-routing-resume-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing-resume@example.test']);
  await git(['config', 'user.name', 'Routing resume']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack routing']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'routing-resume', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git };
}

describe('routed round conductor resume', () => {
  it('re-navigates a post-marker crash to build without re-admitting the round', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, child)).resolves.toMatchObject({ kind: 'admitted' });

    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('prd_audit'));
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', parseChildId(2)!), {
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
    });
    const dispatched: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          throw new Error('stop after resumed build dispatch');
        },
      },
      childRegionLifecycle: {
        enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' }),
      },
    });

    await conductor.run();
    expect(dispatched).toEqual(['build']);
    await expect(readState(pipelinePathFor(subject.repo, 'conduct-state.json', parseChildId(2)!)))
      .resolves.toMatchObject({ ok: true, value: { build: 'pending' } });
    const refs = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/'])).stdout.split('\n').filter(Boolean);
    expect(refs.filter((ref) => ref.includes('/routes/'))).toHaveLength(1);
    expect(refs.filter((ref) => ref.endsWith('/repairing'))).toHaveLength(1);
  });
});
