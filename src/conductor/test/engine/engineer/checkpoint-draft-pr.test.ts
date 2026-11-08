// Covers: task:4
// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import { checkpointComposerRun } from '../../../src/engine/engineer/checkpoint.js';
import { isStaleClaim } from '../../../src/engine/engineer/intake/stale-claim.js';

function checkpointDeps(input: {
  intake?: boolean;
  publication: any;
  files?: Map<string, string>;
}) {
  const files = input.files ?? new Map<string, string>([['.docs/track/demo.md', '# demo\n']]);
  if (input.intake) files.set('.docs/intake/demo.md', 'Source-Ref: acme/demo#12\nOwner: A\n');
  const git = vi.fn(async (args: readonly string[]) => {
    if (args[0] === 'branch') return { exitCode: 0, stdout: 'spec/demo\n', stderr: '' };
    if (args[0] === 'status') return { exitCode: 0, stdout: '?? .docs/track/demo.md', stderr: '' };
    if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  return {
    files, git,
    deps: { git, resolveOwner: async () => ({ resolved: true as const, id: 'A' }), fs: { readFile: async (path: string) => { const value = files.get(path.replace('/worktree/', '')); if (value === undefined) throw new Error(`ENOENT ${path}`); return value; }, writeFile: async (path: string, value: string) => { files.set(path.replace('/worktree/', ''), value); }, mkdir: async () => {} }, writeMarker: async () => {}, emit: async () => {}, publication: input.publication },
  };
}

describe('draft publication checkpoint', () => {
  it('Covers: Task 5 creates one draft PR with release metadata, a non-closing ref, and records its durable publication', async () => {
    const files = new Map<string, string>([
      ['.docs/track/demo.md', '# demo\n'],
      ['.docs/intake/demo.md', 'Source-Ref: acme/demo#12\nOwner: A\n'],
    ]);
    const create = vi.fn(async (input: any) => ({ url: 'https://github.com/acme/demo/pull/8', body: input.body }));
    const published = vi.fn(async () => {});
    const git = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'branch') return { exitCode: 0, stdout: 'spec/demo\n', stderr: '' };
      if (args[0] === 'status') return { exitCode: 0, stdout: '?? .docs/track/demo.md', stderr: '' };
      if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, {
      git, resolveOwner: async () => ({ resolved: true as const, id: 'A' }),
      fs: { readFile: async (path) => { const value = files.get(path.replace('/worktree/', '')); if (value === undefined) throw new Error(`ENOENT ${path}`); return value; }, writeFile: async (path, value) => { files.set(path.replace('/worktree/', ''), value); }, mkdir: async () => {} },
      writeMarker: async () => {}, emit: async () => {},
      publication: { push: async () => {}, findOpenPullRequest: async () => undefined, createDraftPullRequest: create, published },
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ branch: 'spec/demo', base: 'main', draft: true, body: expect.stringContaining('Release-Disposition: no-note') }));
    expect(create.mock.calls[0][0].body).toContain('Refs acme/demo#12');
    expect(published).toHaveBeenCalledWith({ slug: 'demo', branch: 'spec/demo', prUrl: 'https://github.com/acme/demo/pull/8' });
  });

  it('Covers: Task 5 creates intake and non-intake drafts with the exact non-closing body contract', async () => {
    for (const intake of [true, false]) {
      const create = vi.fn(async (input: any) => ({ url: 'https://github.com/acme/demo/pull/8', body: input.body }));
      const { deps } = checkpointDeps({ intake, publication: { push: async () => {}, findOpenPullRequest: async () => undefined, createDraftPullRequest: create, defaultBase: 'trunk' } });
      await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
      expect(create).toHaveBeenCalledOnce();
      const created = create.mock.calls[0][0];
      expect(created).toMatchObject({ branch: 'spec/demo', base: 'trunk', draft: true });
      expect(created.body).toContain('## Release metadata\n\nRelease-Disposition: no-note');
      if (intake) {
        expect(created.body).toContain('Refs acme/demo#12');
        expect(created.body).not.toMatch(/(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+(?:acme\/demo#12|#12)/i);
      } else expect(created.body).not.toMatch(/^Refs\s/m);
    }
  });

  it('Covers: Task 5 reuses an open draft and retries a failed create without making duplicate drafts', async () => {
    const existingCreate = vi.fn(async () => ({ url: 'unexpected', body: '' }));
    const existing = checkpointDeps({ publication: { push: async () => {}, findOpenPullRequest: async () => ({ url: 'https://github.com/acme/demo/pull/8', body: 'body' }), createDraftPullRequest: existingCreate } });
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, existing.deps);
    expect(existingCreate).not.toHaveBeenCalled();

    let attempts = 0;
    const retryCreate = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary create failure');
      return { url: 'https://github.com/acme/demo/pull/9', body: '' };
    });
    const retry = checkpointDeps({ publication: { push: async () => {}, findOpenPullRequest: async () => undefined, createDraftPullRequest: retryCreate } });
    await expect(checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, retry.deps)).rejects.toThrow('temporary create failure');
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, retry.deps);
    expect(retryCreate).toHaveBeenCalledTimes(2);
  });

  it('Covers: Task 5 persists a deciding ledger entry with a draft URL that cannot be stale', async () => {
    let entry: any;
    const publication = { push: async () => {}, findOpenPullRequest: async () => undefined, createDraftPullRequest: async () => ({ url: 'https://github.com/acme/demo/pull/8', body: '' }), published: async ({ branch, prUrl }: any) => { entry = { source: 'github-issues', sourceRef: 'acme/demo#12', status: 'deciding', attempts: 0, branch, draftPrUrl: prUrl }; } };
    const { deps } = checkpointDeps({ intake: true, publication });
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
    expect(entry).toMatchObject({ status: 'deciding', branch: 'spec/demo', draftPrUrl: 'https://github.com/acme/demo/pull/8' });
    expect(entry.prUrl).toBeUndefined();
    expect(isStaleClaim(entry, Date.now(), 1)).toBe(false);
  });

  it('Covers: Task 4 retries publication of an already committed checkpoint without a second commit', async () => {
    const files = new Map<string, string>([['.docs/track/demo.md', '# demo\n']]);
    let dirty = true;
    const pushes = vi.fn(async () => {});
    const git = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'branch') return { exitCode: 0, stdout: 'spec/demo\n', stderr: '' };
      if (args[0] === 'status') return { exitCode: 0, stdout: dirty ? '?? .docs/track/demo.md' : '', stderr: '' };
      if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const fs = {
      readFile: async (path: string) => { const value = files.get(path.replace('/worktree/', '')); if (value === undefined) throw new Error(`ENOENT ${path}`); return value; },
      writeFile: async (path: string, value: string) => { files.set(path.replace('/worktree/', ''), value); },
      mkdir: async () => {},
    };
    const publication = {
      push: pushes,
      findOpenPullRequest: async () => ({ url: 'https://github.com/acme/demo/pull/8', body: '' }),
      createDraftPullRequest: async () => ({ url: 'https://github.com/acme/demo/pull/8', body: '' }),
    };
    const deps = { git, resolveOwner: async () => ({ resolved: true as const, id: 'A' }), fs, writeMarker: async () => {}, emit: async () => {}, publication };
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
    dirty = false;
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
    expect(pushes).toHaveBeenCalledTimes(2);
    expect(git.mock.calls.filter(([args]) => args[0] === 'commit')).toHaveLength(1);
  });
});
