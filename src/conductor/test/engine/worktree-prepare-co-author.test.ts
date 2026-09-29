import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
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
    const resolver: BotCoAuthorResolver = {
      prepare: vi.fn(async () => ({ kind: 'resolved' as const, login: 'conductor-bot', id: 4242, trailer: TRAILER })),
      current: () => undefined,
    };
    installDaemonBotCoAuthor(resolver);
    await prepareWorktree(dir);
    const coAuthorPath = join(dir, '.pipeline', 'co-author');
    expect(await readFile(coAuthorPath, 'utf8')).toBe(`${TRAILER}\n`);

    // Make the existing input unwritable. The resolver still resolves, so this
    // exercises the co-author write failure rather than an identity failure.
    await chmod(coAuthorPath, 0o444);
    const events: ConductorEvent[] = [];
    await prepareWorktree(dir, undefined, { events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never });

    await expect(access(coAuthorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toContainEqual({ type: 'bot_co_author_skipped', reason: 'worktree-write-failed' });
    await git('commit', '--allow-empty', '-m', 'after failed refresh');
    expect(await git('log', '-1', '--format=%B')).not.toContain(TRAILER);
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
