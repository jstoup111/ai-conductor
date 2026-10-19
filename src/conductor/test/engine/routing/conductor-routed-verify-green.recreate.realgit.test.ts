// Covers: task:rem-as-built-rem-asbuilt-5ac42490-1
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeChild } from '../../../src/engine/child-lifecycle.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), 'conductor-routed-verify-green-recreate-'));
  roots.push(repository);
  const git = (args: string[]) => execFile('git', args, { cwd: repository });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await mkdir(join(repository, '.ai-conductor'), { recursive: true });
  await writeFile(join(repository, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repository, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await writeFile(join(repository, 'base.txt'), 'base\n');
  await git(['add', '.gitignore', '.ai-conductor/config.yml', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['switch', '-c', 'feat/c1/demo']);
  await writeFile(join(repository, 'child.txt'), 'child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'child work']);

  const childDir = join(repository, '.pipeline', 'children', '1');
  await mkdir(childDir, { recursive: true });
  await writeFile(join(childDir, 'acceptance-specs-red.json'), JSON.stringify({
    failingTests: [{ name: 'child acceptance', reason: 'RED' }],
    intentRationale: 'Proves the routed child acceptance behavior was RED.',
  }));
  await writeFile(join(childDir, 'acceptance-specs-run.json'), JSON.stringify({
    command: 'recovered-green-command', cwd: '.', targetSpecs: ['test/acceptance/child.test.ts'],
  }));
  await expect(closeChild(repository, 'demo', {
    child, position: child, branch: 'feat/c1/demo',
  }, new ConductorEventEmitter())).resolves.toEqual({ kind: 'completed' });

  const recreated = await mkdtemp(join(tmpdir(), 'conductor-routed-verify-green-worktree-'));
  roots.push(recreated);
  await git(['worktree', 'add', '--detach', recreated, 'feat/c1/demo']);
  return { recreated };
}

describe('Conductor routed acceptance verify-green recreated worktree', () => {
  it('recovers the closed child contract from durable routing state and emits verify-green', async () => {
    const { recreated } = await fixture();
    const childDir = join(recreated, '.pipeline', 'children', '1');
    const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
    await mkdir(childDir, { recursive: true });
    await rm(join(childDir, 'acceptance-specs-run.json'), { force: true });
    await expect(execFile('git', ['cat-file', '-e', 'HEAD:.pipeline/children/1/acceptance-specs-run.json'], { cwd: recreated }))
      .rejects.toMatchObject({ code: 128 });
    await writeFile(join(recreated, '.pipeline', 'conduct-state.json'), JSON.stringify({ ...parentState, feature_desc: 'demo' }));
    await writeFile(join(childDir, 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending', build: 'skipped', test_suite: 'skipped', build_review: 'skipped',
    }));

    const events = new ConductorEventEmitter();
    const receipts: Array<Record<string, unknown>> = [];
    events.on('acceptance_red', (event) => { receipts.push(event as unknown as Record<string, unknown>); });
    const acceptanceRedExec = vi.fn(async () => ({ executed: 1, passed: 1, failed: 0, skipped: 0, errors: 0 }));
    const cursor = {
      kind: 'repair-pending' as const,
      child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [child], routedRepair: { child, roundId },
    };
    const conductor = new Conductor({
      projectRoot: recreated,
      stateFilePath: join(recreated, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      mode: 'auto', daemon: true, verifyArtifacts: true,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events,
      stepRunner: { run: vi.fn(async () => ({ success: true })), resetSession: vi.fn(async () => {}) },
      acceptanceRedExec,
      childRegionLifecycle: {
        resolveActiveChild: async () => cursor,
        enterHostRegion: async () => ({ kind: 'resume', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' }) as never,
      },
    });

    await conductor.run();

    expect(acceptanceRedExec).toHaveBeenCalledWith('recovered-green-command', recreated);
    expect(receipts).toContainEqual(expect.objectContaining({
      type: 'acceptance_red', state: 'satisfied', step: 'acceptance_specs', mode: 'verify-green',
    }));
  });
});
