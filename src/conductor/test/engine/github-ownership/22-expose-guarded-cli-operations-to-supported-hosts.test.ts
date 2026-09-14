// Covers: task:22
import { describe, expect, it, vi } from 'vitest';
import { dispatchGithubOperationCommand, detectGithubOperationCommand } from '../../../src/engine/github-operations-cli.js';

describe('github-operation CLI', () => {
  it('decodes a request file through the guarded boundary and reports refusal as non-success', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const exit = await dispatchGithubOperationCommand({ requestFile: '/request.json' }, {
        cwd: '/fixture',
        readRequest: vi.fn().mockResolvedValue(JSON.stringify({
          operation: 'issue.comment.create', repository: 'acme/widgets', resource: { kind: 'issue', number: 7 },
          context: { actor: 'alice' }, payload: { body: 'no raw command' },
        })),
        gh: vi.fn(),
      });
      expect(exit).toBe(1);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('missing-provenance'));
    } finally { write.mockRestore(); }
  });

  it('accepts only the request-file command form', () => {
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', '--request-file', 'request.json']))
      .toEqual({ requestFile: 'request.json' });
    expect(detectGithubOperationCommand(['node', 'conduct', 'github-operation', 'gh', 'api'])).toBeNull();
  });
});
