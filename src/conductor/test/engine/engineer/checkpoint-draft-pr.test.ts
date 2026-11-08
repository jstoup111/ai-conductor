import { describe, expect, it, vi } from 'vitest';
import { checkpointComposerRun } from '../../../src/engine/engineer/checkpoint.js';

describe('draft publication checkpoint', () => {
  it('Covers: Task 5 creates one draft PR with release metadata, a non-closing ref, and records its durable publication', async () => {
    const files = new Map<string, string>([
      ['.docs/track/demo.md', '# demo\n'],
      ['.docs/intake/demo.md', 'Source-Ref: acme/demo#12\nOwner: A\n'],
    ]);
    const create = vi.fn(async (input: any) => ({ url: 'https://github.com/acme/demo/pull/8', body: input.body }));
    const published = vi.fn(async () => {});
    const git = vi.fn(async (args: string[]) => {
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
});
