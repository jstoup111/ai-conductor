// Covers: task:rem-as-built-rem-v3-park-reclaim-order
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seams = vi.hoisted(() => ({
  activePublicationRecord: vi.fn(),
  writePublicationRecord: vi.fn(),
  deleteStackChildren: vi.fn(),
  verifyMemberReachability: vi.fn(),
  shippedRecordOnMain: vi.fn(),
  runProjectTeardown: vi.fn(),
  makeGitRunner: vi.fn(),
  makeProductionGh: vi.fn(),
  makeProductionGit: vi.fn(),
  runTrackerRepositoryRead: vi.fn(),
  detectAutoResume: vi.fn(),
  resolveMainRepoRootStrict: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock('../../src/engine/stack-publication-record.js', () => ({
  activePublicationRecord: seams.activePublicationRecord,
  writePublicationRecord: seams.writePublicationRecord,
}));
vi.mock('../../src/engine/stack-teardown.js', () => ({ deleteStackChildren: seams.deleteStackChildren }));
vi.mock('../../src/engine/stack-publication.js', () => ({ verifyMemberReachability: seams.verifyMemberReachability }));
vi.mock('../../src/engine/shipped-record-on-main.js', () => ({ shippedRecordOnMain: seams.shippedRecordOnMain }));
vi.mock('../../src/engine/worktree-prepare.js', () => ({ runProjectTeardown: seams.runProjectTeardown }));
vi.mock('../../src/engine/rebase.js', () => ({ makeGitRunner: seams.makeGitRunner }));
vi.mock('../../src/engine/pr-labels.js', () => ({ makeProductionGh: seams.makeProductionGh, makeProductionGit: seams.makeProductionGit }));
vi.mock('../../src/engine/tracker-client.js', () => ({ runTrackerRepositoryRead: seams.runTrackerRepositoryRead }));
vi.mock('../../src/engine/auto-resume.js', () => ({ detectAutoResume: seams.detectAutoResume }));
vi.mock('../../src/engine/park-marker.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/park-marker.js')>(),
  resolveMainRepoRootStrict: seams.resolveMainRepoRootStrict,
}));
vi.mock('../../src/engine/config.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/config.js')>(),
  loadConfig: seams.loadConfig,
}));

import { dispatchDaemonPark } from '../../src/engine/daemon-park-cli.js';

const roots: string[] = [];
const record = {
  version: 1 as const,
  members: [
    { position: 1, branch: 'feat/c1/demo', pr: 101 },
    { position: 3, branch: 'feat/c3/demo', pr: 103 },
    { position: 5, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  seams.resolveMainRepoRootStrict.mockResolvedValue(undefined);
  seams.detectAutoResume.mockResolvedValue({ kind: 'none' });
  seams.loadConfig.mockResolvedValue({ ok: true, config: {} });
  seams.makeGitRunner.mockReturnValue(vi.fn());
  seams.makeProductionGh.mockReturnValue(vi.fn());
  seams.makeProductionGit.mockReturnValue(vi.fn());
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engine/daemon-park-cli reclaim-worktree stacked cleanup', () => {
  it('removes the worktree before deleting children after shipped and reachability proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-stack-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'demo');
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), JSON.stringify({ pr_url: 'https://github.com/acme/demo/pull/500' }));
    const calls: string[] = [];
    seams.runProjectTeardown.mockImplementation(async () => { calls.push('teardown'); });
    seams.activePublicationRecord.mockImplementation(async () => {
      calls.push('record');
      return { kind: 'record', slug: 'demo', blob: 'a'.repeat(40), record };
    });
    seams.shippedRecordOnMain.mockImplementation(async () => { calls.push('shipped'); return 'present'; });
    seams.verifyMemberReachability.mockImplementation(async () => { calls.push('reachability'); return { kind: 'reachable' }; });
    seams.deleteStackChildren.mockImplementation(async () => { calls.push('delete'); return { kind: 'deleted' }; });

    const code = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: 'demo' },
      {
        cwd: root,
        out: () => {},
        removeWorktree: async () => {
          calls.push('remove');
          await rm(worktree, { recursive: true, force: true });
        },
      },
    );

    expect({ code, calls }).toEqual({
      code: 0,
      calls: ['teardown', 'remove', 'record', 'shipped', 'reachability', 'delete'],
    });
    expect(seams.deleteStackChildren).toHaveBeenCalledWith(root, 'demo', record, expect.objectContaining({
      repository: 'acme/demo',
    }));
  });

  it('keeps children and retires their record when closed-unmerged #500 has no shipped record on main', async () => {
    const root = await mkdtemp(join(tmpdir(), 'daemon-reclaim-stack-'));
    roots.push(root);
    const worktree = join(root, '.worktrees', 'demo');
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await writeFile(join(worktree, '.pipeline', 'conduct-state.json'), JSON.stringify({ pr_url: 'https://github.com/acme/demo/pull/500' }));
    const calls: string[] = [];
    const stored = { kind: 'record', slug: 'demo', blob: 'a'.repeat(40), record };
    seams.runProjectTeardown.mockImplementation(async () => { calls.push('teardown'); });
    seams.activePublicationRecord.mockImplementation(async () => { calls.push('record'); return stored; });
    seams.shippedRecordOnMain.mockImplementation(async () => { calls.push('shipped'); return 'absent'; });
    seams.writePublicationRecord.mockImplementation(async () => { calls.push('retire'); return { kind: 'updated' }; });

    const code = await dispatchDaemonPark(
      { kind: 'reclaim-worktree', slug: 'demo' },
      {
        cwd: root,
        out: () => {},
        removeWorktree: async () => {
          calls.push('remove');
          await rm(worktree, { recursive: true, force: true });
        },
      },
    );

    expect({ code, calls, write: seams.writePublicationRecord.mock.calls }).toEqual({
      code: 0,
      calls: ['teardown', 'remove', 'record', 'shipped', 'retire'],
      write: [[root, 'demo', stored, { ...record, tornDown: true }, expect.any(Object)]],
    });
    expect(seams.deleteStackChildren).not.toHaveBeenCalled();
    expect(seams.makeProductionGh).not.toHaveBeenCalled();
  });
});
