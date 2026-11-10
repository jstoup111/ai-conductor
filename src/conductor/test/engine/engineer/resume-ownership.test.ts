// Covers: task:14
import { describe, expect, it, vi } from 'vitest';
import { checkpointComposerRun } from '../../../src/engine/engineer/checkpoint.js';
import { resumeOwnershipMode } from '../../../src/engine/engineer/resume.js';
import { decideSpecGate } from '../../../src/engine/owner-gate/gate.js';

describe('resume ownership', () => {
  it('Covers: Task 14 requires an interactive approved takeover and otherwise remains local-only', () => {
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: false, approved: true })).toBe('taken-over');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: true, approved: true })).toBe('local-only');
  });

  it('Covers: Task 14 refuses unresolved ownership and never grants takeover to declined, non-TTY, or daemon sessions', () => {
    expect(() => resumeOwnershipMode({ committedOwner: 'A', daemonSession: false, interactive: true })).toThrow(/identity is unresolved/);
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: false, approved: false })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: false, daemonSession: false, approved: true })).toBe('local-only');
    expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', interactive: true, daemonSession: true, approved: true })).toBe('local-only');
  });

  it('Covers: Task 14 keeps declined and non-TTY ownership retries local-only after their checkpoint already committed', async () => {
    for (const ownership of [
      { interactive: true, approved: false },
      { interactive: false, approved: true },
    ]) {
      expect(resumeOwnershipMode({ committedOwner: 'A', machineOwner: 'B', daemonSession: false, ...ownership })).toBe('local-only');
      const files = new Map<string, string>([
        ['.docs/intake/demo.md', 'Owner: A\n'],
        ['.docs/track/demo.md', '# demo\n'],
      ]);
      let dirty = true;
      const git = vi.fn(async (args: readonly string[]) => {
        if (args[0] === 'branch') return { exitCode: 0, stdout: 'spec/demo\n', stderr: '' };
        if (args[0] === 'status') return { exitCode: 0, stdout: dirty ? '?? .docs/track/demo.md' : '', stderr: '' };
        if (args[0] === 'diff') return { exitCode: 1, stdout: '', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      });
      const push = vi.fn(async () => {});
      const create = vi.fn(async () => ({ url: 'https://github.com/acme/demo/pull/8', body: '' }));
      const writeMarker = vi.fn(async () => {});
      const deps = {
        git,
        resolveOwner: async () => ({ resolved: true as const, id: 'B' }),
        fs: {
          readFile: async (path: string) => {
            const value = files.get(path.replace('/worktree/', ''));
            if (value === undefined) throw new Error(`ENOENT ${path}`);
            return value;
          },
          writeFile: async (path: string, value: string) => { files.set(path.replace('/worktree/', ''), value); },
          mkdir: async () => {},
        },
        writeMarker,
        emit: async () => {},
        localOnly: true,
        localOnlyOwner: 'A',
        publication: { push, findOpenPullRequest: async () => undefined, createDraftPullRequest: create },
      };

      await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
      dirty = false;
      const retry = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);

      expect(git.mock.calls.filter(([args]) => args[0] === 'commit')).toHaveLength(1);
      expect(push).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(writeMarker).not.toHaveBeenCalled();
      expect(files.get('.docs/intake/demo.md')).toContain('Owner: A');
      expect(retry).toMatchObject({ committed: false, published: false, warnings: [expect.stringMatching(/owned by A.*stays local until interactive take-over/i)] });
    }
  });

  it('Covers: Task 14 gates the re-stamped owner branch to that daemon owner only', () => {
    const stamp = { present: true as const, id: 'B' };
    expect(decideSpecGate({ daemonOwner: { id: 'B' }, stamp, mergeTime: null, cutover: null })).toEqual({ build: true });
    expect(decideSpecGate({ daemonOwner: { id: 'A' }, stamp, mergeTime: null, cutover: null })).toEqual({ build: false, reason: 'other-owner', other: 'B' });
  });
});
