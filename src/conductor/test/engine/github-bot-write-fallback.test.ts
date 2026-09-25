import { describe, expect, it, vi } from 'vitest';

import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../src/engine/tracker-client.js';

const request = {
  operation: 'issue.read', access: 'read', repository: 'acme/repo',
  target: { repository: 'acme/repo', kind: 'issue', number: 1 },
  resource: { kind: 'issue', number: 1 }, context: { actor: 'operator' },
} as any;

describe('bot write fallback boundary', () => {
  it('refuses a request with no access class without calling the transport', async () => {
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '{}' }));
    const runner = createGuardedGithubOperationRunner(transport, { cwd: '/fixture' });
    await expect(runner.run({ ...request, access: undefined })).resolves.toEqual({ kind: 'refused', reason: 'missing-provenance' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('never retries as the operator without a successfully emitted warning', async () => {
    const transport = vi.fn<GhRunner>(async () => { throw new GithubBotAuthRefusalError('auth-refused'); });
    const runner = createGuardedGithubOperationRunner(transport, { cwd: '/fixture' });
    await expect(runner.run(request)).rejects.toBeInstanceOf(GithubBotAuthRefusalError);
    expect(transport).toHaveBeenCalledTimes(1);

    const emitter = { emit: vi.fn(async () => { throw new Error('sink unavailable'); }) };
    const withEmitter = createGuardedGithubOperationRunner(transport, { cwd: '/fixture', events: emitter });
    await expect(withEmitter.run(request)).rejects.toBeInstanceOf(GithubBotAuthRefusalError);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
