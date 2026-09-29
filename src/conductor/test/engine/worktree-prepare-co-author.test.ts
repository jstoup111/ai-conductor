// Covers: task:8
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installDaemonBotCoAuthor, type BotCoAuthorResolver } from '../../src/engine/bot-co-author.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFileAsync = promisify(execFile);
const TRAILER = 'Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>';

describe('engine/worktree-prepare co-author input', () => {
  let dir: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-co-author-'));
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Operator');
    await git('config', 'user.email', 'operator@example.com');
    await git('config', 'commit.gpgsign', 'false');
    await git('commit', '--allow-empty', '-m', 'initial');
  });

  afterEach(async () => {
    installDaemonBotCoAuthor(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('removes stale co-author input when preparation cannot refresh it', async () => {
    let prepareCalls = 0;
    const resolver: BotCoAuthorResolver = {
      prepare: vi.fn(async () => {
        if (++prepareCalls === 2) await chmod(join(dir, '.pipeline'), 0o555);
        return { kind: 'resolved' as const, login: 'conductor-bot', id: 4242, trailer: TRAILER };
      }),
      current: () => undefined,
    };
    installDaemonBotCoAuthor(resolver);
    await prepareWorktree(dir);
    const coAuthorPath = join(dir, '.pipeline', 'co-author');
    expect(await readFile(coAuthorPath, 'utf8')).toBe(`${TRAILER}\n`);

    const events: ConductorEvent[] = [];
    try {
      await prepareWorktree(dir, undefined, { events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never });
    } finally {
      await chmod(join(dir, '.pipeline'), 0o755);
    }

    await expect(access(coAuthorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toContainEqual({ type: 'bot_co_author_skipped', reason: 'worktree-write-failed' });
    await git('commit', '--allow-empty', '-m', 'after failed refresh');
    expect(await git('log', '-1', '--format=%B')).not.toContain(TRAILER);
  });

  it('uses the resolver emitter for a write failure without feature events', async () => {
    let prepareCalls = 0;
    const events: ConductorEvent[] = [];
    const resolver: BotCoAuthorResolver = {
      prepare: vi.fn(async () => {
        if (++prepareCalls === 2) await chmod(join(dir, '.pipeline'), 0o555);
        return { kind: 'resolved' as const, login: 'conductor-bot', id: 4242, trailer: TRAILER };
      }),
      current: () => undefined,
      eventEmitter: () => ({ emit: async (event: ConductorEvent) => { events.push(event); } } as never),
    };
    installDaemonBotCoAuthor(resolver);
    await prepareWorktree(dir);
    const coAuthorPath = join(dir, '.pipeline', 'co-author');
    try {
      await prepareWorktree(dir);
    } finally {
      await chmod(join(dir, '.pipeline'), 0o755);
    }

    await expect(access(coAuthorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toEqual([{ type: 'bot_co_author_skipped', reason: 'worktree-write-failed' }]);
  });

  it('rejects preparation when a stale co-author input cannot be removed', async () => {
    const events: ConductorEvent[] = [];
    installDaemonBotCoAuthor({
      prepare: vi.fn(async () => ({ kind: 'resolved' as const, login: 'conductor-bot', id: 4242, trailer: TRAILER })),
      current: () => undefined,
    });
    await prepareWorktree(dir);
    const coAuthorPath = join(dir, '.pipeline', 'co-author');
    await writeFile(coAuthorPath, 'stale trailer\n', 'utf8');
    await chmod(join(dir, '.pipeline'), 0o555);

    try {
      await expect(prepareWorktree(dir, undefined, { events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never }))
        .rejects.toThrow(coAuthorPath);
      expect(await readFile(coAuthorPath, 'utf8')).toBe('stale trailer\n');
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'project_setup' }));
    } finally {
      await chmod(join(dir, '.pipeline'), 0o755);
    }
  });

  it('removes stale input for unavailable resolution and forwards the feature emitter', async () => {
    const events: ConductorEvent[] = [];
    const prepare = vi.fn(async (emitter?: { emit(event: ConductorEvent): Promise<void> }) => {
      await emitter?.emit({ type: 'bot_co_author_skipped', reason: 'identity-read-failed' });
      return { kind: 'unavailable' as const, reason: 'identity-read-failed' as const };
    });
    installDaemonBotCoAuthor({ prepare, current: () => undefined });
    await prepareWorktree(dir, undefined, { events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never });
    await expect(access(join(dir, '.pipeline', 'co-author'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ emit: expect.any(Function) }));
    expect(events).toContainEqual({ type: 'bot_co_author_skipped', reason: 'identity-read-failed' });
  });
});
