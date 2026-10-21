// Covers: task:14
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const BRANCH = 'feat/daemon-demo';
const RETARGET_BASE = 'feat/c3/demo';
const PR_URL = 'https://github.com/acme/repo/pull/500';
const SLUG = 'daemon-demo';
const BODY = [
  'Release-Disposition: note',
  'Release-Category: Fixed',
  'Release-Semver: patch',
  'Release-Note: Retargeted leaf.',
].join('\n');

const runner: StepRunner = { run: async () => ({ success: true }) };
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function subject(input: {
  rows?: Record<string, Array<{ url: string; state: 'OPEN' | 'CLOSED' | 'MERGED' }>>;
  child?: boolean;
  record?: boolean;
  body?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'retained-draft-retarget-'));
  dirs.push(root);
  if (input.child) await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  const calls: string[][] = [];
  const gitCalls: string[][] = [];
  const record = JSON.stringify({
    version: 1,
    retarget: { from: 'main', to: RETARGET_BASE, phase: 'observed' },
    members: [{ position: 1, branch: 'feat/c1/demo', pr: 100 }],
  });
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    if (args.includes('list')) {
      const base = args[args.indexOf('--base') + 1];
      return { stdout: JSON.stringify(input.rows?.[base ?? ''] ?? []) };
    }
    if (args.includes('view')) {
      return { stdout: JSON.stringify({ title: 'feat: retained leaf', isDraft: true, labels: [], comments: [], state: 'OPEN', body: input.body ?? BODY }) };
    }
    return { stdout: '{}' };
  };
  const conductor = new Conductor({
    stateFilePath: join(root, 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    featureSlug: SLUG,
    featureDesc: SLUG,
    worktreeBranch: BRANCH,
    daemon: true,
    selfHost: true,
    baseBranch: 'main',
    config: { steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } } } as never,
    gh,
    runGh: gh,
    git: async (args) => {
      gitCalls.push([...args]);
      if (!input.record) return { exitCode: 1, stdout: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${'a'.repeat(40)}\n` };
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: record };
      return { exitCode: 0, stdout: '' };
    },
    log: () => {},
  });
  return { conductor, calls, gitCalls, root };
}

function listBases(calls: readonly string[][]): string[] {
  return calls
    .filter((args) => args.includes('list'))
    .map((args) => args[args.indexOf('--base') + 1] ?? '');
}

describe('retained draft lookup after stack retargeting', () => {
  it('resolves an observed retargeted leaf after the default-base lookup misses', async () => {
    const fixture = await subject({ child: true, record: true, rows: { [RETARGET_BASE]: [{ url: PR_URL, state: 'OPEN' }] } });

    const result = await (fixture.conductor as unknown as {
      readShipDraftReleaseMetadata(branch: string): Promise<{ ok: boolean }>;
    }).readShipDraftReleaseMetadata(BRANCH);

    expect(result.ok).toBe(true);
    expect(listBases(fixture.calls)).toEqual(['main', RETARGET_BASE]);
  });

  it('does not adopt a third-base PR or a closed retargeted PR', async () => {
    const thirdBase = await subject({
      child: true,
      record: true,
      rows: { 'release-x': [{ url: PR_URL, state: 'OPEN' }] },
    });
    const closed = await subject({
      child: true,
      record: true,
      rows: { [RETARGET_BASE]: [{ url: PR_URL, state: 'CLOSED' }] },
    });
    const resolve = (conductor: Conductor) => (conductor as unknown as {
      resolveRetainedShipDraftPrUrl(branch: string): Promise<string | undefined>;
    }).resolveRetainedShipDraftPrUrl(BRANCH);

    await expect(resolve(thirdBase.conductor)).resolves.toBeUndefined();
    await expect(resolve(closed.conductor)).resolves.toBeUndefined();
    expect(listBases(thirdBase.calls)).toEqual(['main', RETARGET_BASE]);
  });

  it('does not read the publication record for an N=1 leaf', async () => {
    const found = await subject({ rows: { main: [{ url: PR_URL, state: 'OPEN' }] } });
    const missing = await subject();
    const resolve = (conductor: Conductor) => (conductor as unknown as {
      resolveRetainedShipDraftPrUrl(branch: string): Promise<string | undefined>;
    }).resolveRetainedShipDraftPrUrl(BRANCH);

    await expect(resolve(found.conductor)).resolves.toBe(PR_URL);
    await expect(resolve(missing.conductor)).resolves.toBeUndefined();
    expect(listBases(found.calls)).toEqual(['main']);
    expect(listBases(missing.calls)).toEqual(['main']);
    expect(found.gitCalls).toEqual([]);
    expect(missing.gitCalls).toEqual([]);
  });

  it('uses the observed retarget base for region preparation, capture, and resume clearing', async () => {
    const body = `${BODY}\n<!-- ai-conductor:step release-disposition -->\nRelease-Disposition: note\n<!-- /ai-conductor:step -->`;
    const input = { child: true, record: true, body, rows: { [RETARGET_BASE]: [{ url: PR_URL, state: 'OPEN' as const }] } };
    const prepare = await subject(input);
    const capture = await subject(input);
    const clear = await subject(input);
    const state = { worktree_branch: BRANCH, feature_desc: SLUG } as ConductState;
    const owner = 'release-disposition' as StepName;
    (prepare.conductor as unknown as { config: object }).config = {
      steps: { [owner]: { skill: '.agents/skills/release-disposition/SKILL.md' } },
      pr_template_region_owners: { [owner]: '\nRelease-Disposition: note\n' },
    };
    (capture.conductor as unknown as { config: object }).config = {
      steps: { [owner]: { skill: '.agents/skills/release-disposition/SKILL.md' } },
      pr_template_region_owners: { [owner]: '\nRelease-Disposition: note\n' },
    };

    await (prepare.conductor as unknown as {
      ensureOwnedStepRegion(state: ConductState, step: StepName): Promise<void>;
    }).ensureOwnedStepRegion(state, owner);
    await (capture.conductor as unknown as {
      captureOwnedStepRegion(state: ConductState, step: StepName): Promise<void>;
    }).captureOwnedStepRegion(state, owner);
    await (clear.conductor as unknown as {
      clearRetainedHaltStateForDispatch(state: ConductState): Promise<void>;
    }).clearRetainedHaltStateForDispatch(state);

    expect([listBases(prepare.calls), listBases(capture.calls), listBases(clear.calls)]).toEqual([
      ['main', RETARGET_BASE], ['main', RETARGET_BASE], ['main', RETARGET_BASE],
    ]);
  });
});
