// Covers: task:2
import { describe, expect, it } from 'vitest';

import { resolveHeadSha, resolvePrDisposition } from '../../src/engine/run-provenance.js';
type GitRunner = Parameters<typeof resolveHeadSha>[0];

describe('engine/run-provenance', () => {
  describe('resolvePrDisposition', () => {
    it('returns opened when a PR URL is present', () => {
      expect(resolvePrDisposition({ prUrl: 'https://github.com/acme/project/pull/42', finishChoice: 'keep' })).toBe('opened');
    });

    it('returns none when no PR URL exists and the finish choice is keep', () => {
      expect(resolvePrDisposition({ finishChoice: 'keep' })).toBe('none');
    });

    it.each(['pr', 'merge-local', 'discard', undefined] as const)(
      'returns unrecorded when no PR URL exists and finish choice is %s',
      (finishChoice) => {
        expect(resolvePrDisposition({ finishChoice })).toBe('unrecorded');
      },
    );
  });

  describe('resolveHeadSha', () => {
    it('returns the trimmed output from git rev-parse HEAD', async () => {
      const calls: Array<{ args: string[]; cwd: string | undefined }> = [];
      const git: GitRunner = async (args, opts) => {
        calls.push({ args, cwd: opts?.cwd });
        return { exitCode: 0, stdout: '  abc123  \n', stderr: '' };
      };

      await expect(resolveHeadSha(git, '/repo')).resolves.toBe('abc123');
      expect(calls).toEqual([{ args: ['rev-parse', 'HEAD'], cwd: '/repo' }]);
    });

    it('returns undefined when git exits non-zero', async () => {
      const git: GitRunner = async () => ({ exitCode: 1, stdout: 'abc123\n', stderr: 'failed' });

      await expect(resolveHeadSha(git, '/repo')).resolves.toBeUndefined();
    });

    it('returns undefined when git prints no SHA', async () => {
      const git: GitRunner = async () => ({ exitCode: 0, stdout: ' \n', stderr: '' });

      await expect(resolveHeadSha(git, '/repo')).resolves.toBeUndefined();
    });

    it('returns undefined without throwing when the git runner rejects', async () => {
      const git: GitRunner = async () => Promise.reject(new Error('git unavailable'));

      await expect(resolveHeadSha(git, '/repo')).resolves.toBeUndefined();
    });
  });
});
