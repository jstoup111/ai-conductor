// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { checkpointComposerRun } from '../../../src/engine/engineer/checkpoint.js';

type FileMap = Map<string, string>;

function fixture(options: { dirty?: string[]; owner?: string; provider?: string; branch?: string } = {}) {
  const files: FileMap = new Map([
    ['.docs/track/demo.md', '# Track\n'],
  ]);
  const calls: Array<readonly string[]> = [];
  const events: unknown[] = [];
  const dirty = options.dirty ?? ['?? .docs/track/demo.md'];
  const git = vi.fn(async (args: readonly string[]) => {
    calls.push(args);
    if (args[0] === 'branch') return { exitCode: 0, stdout: options.branch ?? 'spec/demo\n', stderr: '' };
    if (args[0] === 'status') return { exitCode: 0, stdout: dirty.join('\n'), stderr: '' };
    if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  return {
    files, calls, events, git,
    deps: {
      git,
      resolveOwner: async () => options.owner === undefined ? { resolved: true as const, id: 'machine-owner' } : options.owner ? { resolved: true as const, id: options.owner } : { resolved: false as const },
      fs: {
        readFile: async (path: string) => {
          const content = files.get(path.replace('/worktree/', ''));
          if (content === undefined) throw new Error(`ENOENT ${path}`);
          return content;
        },
        writeFile: async (path: string, content: string) => { files.set(path.replace('/worktree/', ''), content); },
        mkdir: async () => {},
      },
      writeMarker: async (_worktree: string, slug: string, owner: string) => { files.set(`.docs/intake/${slug}.md`, `Owner: ${owner}\n`); },
      emit: async (event: unknown) => { events.push(event); },
      now: () => '2026-11-08T12:00:00.000Z',
      provider: options.provider,
    },
  };
}

describe('checkpointComposerRun', () => {
  it('Covers: Task 3 accepted CLI checkpoint commits docs, run record, owner marker, and accepted event', async () => {
    const f = fixture({ provider: 'codex' });
    const result = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, f.deps);

    expect(result).toMatchObject({ slug: 'demo', committed: true, state: 'accepted' });
    expect(f.files.get('.docs/intake/demo.md')).toContain('Owner: machine-owner');
    expect(JSON.parse(f.files.get('.docs/composer-runs/demo.json')!)).toMatchObject({
      steps: { explore: { state: 'accepted', actor: 'machine-owner', provider: 'codex' } },
    });
    expect(f.calls).toContainEqual(['add', '--', '.docs']);
    expect(f.calls).toContainEqual(['commit', '-m', 'composer checkpoint: demo explore']);
    expect(f.events).toEqual([expect.objectContaining({ type: 'composer_run_checkpointed', slug: 'demo', step: 'explore', state: 'accepted', provider: 'codex', actor: 'machine-owner' })]);
  });

  it('Covers: Task 3 draft has no accepting actor or accepted digests; an empty docs stage makes no commit or push', async () => {
    const f = fixture({ dirty: [] });
    const result = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'draft' }, f.deps);

    expect(result.committed).toBe(false);
    expect(f.files.has('.docs/composer-runs/demo.json')).toBe(false);
    expect(f.calls.some(([command]) => command === 'commit' || command === 'push')).toBe(false);
    expect(f.events).toEqual([expect.objectContaining({ state: 'draft', published: false })]);
  });

  it('Covers: Task 3 refuses non-docs dirt before staging, marker, commit, or push', async () => {
    const f = fixture({ dirty: [' M src/unsafe.ts', '?? .docs/track/demo.md'] });
    await expect(checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, f.deps))
      .rejects.toThrow('src/unsafe.ts');
    expect(f.calls.some(([command]) => command === 'add' || command === 'commit' || command === 'push')).toBe(false);
    expect(f.files.has('.docs/intake/demo.md')).toBe(false);
  });

  it('Covers: Task 3 refuses unresolved machine identity before every write', async () => {
    const f = fixture({ owner: '' });
    await expect(checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, f.deps))
      .rejects.toThrow('identity is unresolved');
    expect(f.files.size).toBe(1);
    expect(f.calls.some(([command]) => command === 'add' || command === 'commit' || command === 'push')).toBe(false);
  });

  it('Covers: Task 3 records unrecorded provider and commits locally without push or PR', async () => {
    const f = fixture();
    await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, f.deps);
    const record = JSON.parse(f.files.get('.docs/composer-runs/demo.json')!);
    expect(record.steps.explore.provider).toBe('unrecorded');
    expect(f.calls.some(([command]) => command === 'push' || command === 'pr')).toBe(false);
  });
});
