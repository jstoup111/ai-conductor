// Covers: task:39
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { loadConfig } from '../../src/engine/config.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { CELLS } from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execFile('git', ['-C', root, ...args])).stdout.trim();
}

describe('N=1 restack absence', () => {
  it.each(CELLS)('runs FINISH, re-kick, and resume production cells for $name without restack state', async (cell) => {
    const root = await mkdtemp(join(tmpdir(), `n1-restack-absence-${cell.name}-`));
    roots.push(root);
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
    await writeFile(join(root, '.docs', 'plans', 'n1-golden.md'), cell.planMd);
    await writeFile(join(root, 'README.md'), 'base\n');
    await writeFile(join(root, '.gitignore'), '.pipeline/\n');
    await git(root, 'init', '-q', '-b', 'main');
    await git(root, 'config', 'user.email', 'n1@example.test');
    await git(root, 'config', 'user.name', 'N1 Test');
    await git(root, 'add', '.');
    await git(root, 'commit', '-qm', 'base');

    const pipeline = join(root, '.pipeline');
    await mkdir(pipeline, { recursive: true });
    const statePath = join(pipeline, 'conduct-state.json');
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', coverage_binding: 'done',
      architecture_diagram: 'done', architecture_review: 'done', prd: 'done', prd_audit: 'done',
      acceptance_specs: 'pending', build: 'pending', test_suite: 'pending', build_review: 'pending',
      manual_test: 'pending', architecture_review_as_built: 'pending', finish: 'pending',
      complexity_tier: 'S', track: 'technical', feature_desc: 'n1-golden',
    } as any);

    const events = new ConductorEventEmitter();
    const eventsPath = join(pipeline, 'events.jsonl');
    const persister = new EventPersister(eventsPath, events, { nowMs: () => 1_000 });
    persister.start();
    const completed = new Set<string>();
    const runner: StepRunner = {
      run: async (step) => {
        if (['acceptance_specs', 'build', 'test_suite', 'build_review'].includes(step)) {
          completed.add(step);
          return { success: true };
        }
        throw new Error(`expected stop at ${step}`);
      },
    };
    const loaded = await loadConfig(root);
    const conductor = new Conductor({
      stateFilePath: statePath, stepRunner: runner, events, projectRoot: root,
      fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
      featureSlug: 'n1-golden', baseBranch: 'main',
      operatorParkBoundary: async () => completed.has('build_review'),
      config: loaded.ok ? loaded.config : undefined,
    });
    await expect(conductor.run()).resolves.toMatchObject({
      kind: 'operator-parked',
      boundary: { name: 'build_review' },
    });

    // FINISH uses its production coordinator, not a rendering/source-text surrogate.
    let body = '## Why\n\nN=1\n\n## What Changed\n\nN=1\n\n## Testing\n\nN=1\n';
    const coordinator = createProductionFinishPublicationCoordinator({
      projectRoot: root, stateFilePath: statePath, baseBranch: 'main',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: JSON.stringify({ url: 'https://github.com/acme/repo/pull/1', title: 'n1', body, isDraft: true, labels: [] }) }),
      operations: { run: async (request: any) => { if (request.operation === 'pull-request.edit') body = request.payload.body; return {} as never; } },
      observeReleaseReadiness: async () => 'present', repairPresentation: async () => {}, recordFinish: async () => 0,
    });
    const finishState = {
      feature_desc: 'n1-golden', worktree_branch: 'feat/n1-golden', complexity_tier: 'S', track: 'technical',
      build_review: 'done', test_suite: 'done', manual_test: 'done', prd_audit: 'done',
      architecture_review_as_built: 'done', rebase: 'done', pr_url: 'https://github.com/acme/repo/pull/1',
    } as any;
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await coordinator.advance({
        state: finishState, mode: 'auto', daemon: true,
        dispatchJudgment: async () => ({ success: true, publicationDisposition: { kind: 'accepted' } }),
        dispatchAuthoring: async () => ({ success: true }), emit: async () => {},
      });
      if (result.kind === 'complete') break;
    }

    // Re-kick/resume remains the ordinary rebase path. This records every
    // Git argv the N=1 resume asks for at its injectable process boundary.
    await writeFile(join(root, REKICK_SENTINEL), 'rekick\n');
    const gitBoundary: string[][] = [];
    await expect(resumeRebaseFirst({
      worktreePath: root, localBase: 'main', slug: 'n1-golden', events, ranManualTest: false,
      performRebase: async () => { gitBoundary.push(['rebase', 'main']); return { kind: 'noop' }; },
      preVerify: async () => ({ done: true }),
    })).resolves.toBe('rebased');
    persister.stop();

    const persistedEvents = await readFile(eventsPath, 'utf8');
    expect(persistedEvents).not.toContain('"type":"restack_');
    const refs = await git(root, 'for-each-ref', '--format=%(refname)', 'refs/conductor/n1-golden/');
    expect(refs.split('\n').filter(Boolean)).toEqual([]);
    expect(gitBoundary).toEqual([['rebase', 'main']]);
    expect(gitBoundary.filter((args) => args[0] === 'update-ref' && args[1]?.startsWith('refs/conductor/n1-golden/'))).toEqual([]);
  });
});
