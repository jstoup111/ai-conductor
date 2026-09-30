import { describe, expect, it, vi } from 'vitest';
import { createBotCoAuthorResolver, installDaemonBotCoAuthor, withDaemonCoAuthorTrailer } from '../../src/engine/bot-co-author.js';
import type { ConductorEvent } from '../../src/types/index.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import { GithubBotAuthRefusalError } from '../../src/engine/github-bot-auth-refusal.js';

describe('daemon bot co-author resolver', () => {
  it('uses the bot-only identity read once and exposes a trailer without rereading', async () => {
    const runner = vi.fn(async () => ({ stdout: JSON.stringify({ login: 'conductor-bot', id: 4242 }) })) as unknown as GhRunner;
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture',
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
    });
    await expect(resolver.prepare()).resolves.toMatchObject({ kind: 'resolved', trailer: 'Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>' });
    await resolver.prepare();
    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(['api', 'user'], { cwd: '/fixture', credential: 'bot' });
    installDaemonBotCoAuthor(resolver);
    expect(withDaemonCoAuthorTrailer('message')).toBe('message\n\nCo-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>');
    installDaemonBotCoAuthor(undefined);
  });

  it('does not invoke the identity runner when a token is unavailable', async () => {
    const runner = vi.fn() as unknown as GhRunner;
    const events: ConductorEvent[] = [];
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture', readCredential: async () => ({ kind: 'configured', tokenFile: '/missing' }),
      readToken: async () => ({ kind: 'unavailable' }), events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    });
    await expect(resolver.prepare()).resolves.toEqual({ kind: 'unavailable', reason: 'token-unavailable' });
    expect(runner).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }]);
  });

  it.each([401, 403])('reports a bot identity %i refusal as identity-read-failed', async () => {
    const runner = vi.fn(async () => {
      throw new GithubBotAuthRefusalError('auth-refused');
    }) as unknown as GhRunner;
    const events: ConductorEvent[] = [];
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture',
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
      events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    });

    await expect(resolver.prepare()).resolves.toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
    expect(runner).toHaveBeenCalledWith(['api', 'user'], { cwd: '/fixture', credential: 'bot' });
    expect(events).toEqual([{ type: 'bot_co_author_skipped', reason: 'identity-read-failed' }]);
  });

  it.each([
    new Error('timed out'),
    new Error('transport unavailable'),
    new Error('invalid JSON'),
  ])('does not fall back to the operator after an identity failure', async error => {
    const runnerSpy = vi.fn(async () => { throw error; });
    const runner = runnerSpy as unknown as GhRunner;
    const events: ConductorEvent[] = [];
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture',
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
      events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    });

    await expect(resolver.prepare()).resolves.toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
    expect(runner).toHaveBeenCalledWith(['api', 'user'], { cwd: '/fixture', credential: 'bot' });
    expect(runnerSpy.mock.calls.flat().join(' ')).not.toContain('operator');
    expect(resolver.current()).toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
    expect(withDaemonCoAuthorTrailer('message')).toBe('message');
    expect(events).toEqual([{ type: 'bot_co_author_skipped', reason: 'identity-read-failed' }]);
  });

  it.each([
    { login: undefined, id: 1 },
    { login: 'conductor-bot', id: '4242' },
    { login: '-invalid', id: 1 },
    { login: 'invalid-', id: 1 },
    { login: 'two--hyphens', id: 1 },
  ])('rejects an invalid identity response without a trailer', async identity => {
    const runner = vi.fn(async () => ({ stdout: JSON.stringify(identity) })) as unknown as GhRunner;
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture',
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
    });
    await expect(resolver.prepare()).resolves.toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
    expect(resolver.current()).toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
  });

  it('does not read or re-emit after a failure, while an unconfigured bot stays silent', async () => {
    const runner = vi.fn(async () => { throw new Error('nope'); }) as unknown as GhRunner;
    const events: ConductorEvent[] = [];
    const resolver = createBotCoAuthorResolver({
      runner, cwd: '/fixture',
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
      events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    });
    await resolver.prepare();
    resolver.current();
    installDaemonBotCoAuthor(resolver);
    expect(withDaemonCoAuthorTrailer('message')).toBe('message');
    installDaemonBotCoAuthor(undefined);
    expect(runner).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);

    const unconfigured = createBotCoAuthorResolver({
      runner, cwd: '/fixture', readCredential: async () => ({ kind: 'unconfigured' }),
    });
    await expect(unconfigured.prepare()).resolves.toEqual({ kind: 'unconfigured' });
    expect(runner).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });
});
