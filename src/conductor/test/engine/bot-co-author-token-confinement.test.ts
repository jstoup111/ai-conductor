import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createBotCoAuthorResolver, installDaemonBotCoAuthor, withDaemonCoAuthorTrailer } from '../../src/engine/bot-co-author.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFileAsync = promisify(execFile);
const TOKEN = 'bot-token-that-must-never-escape-6f8c';
const TOKEN_FILE = '/private/bot-token-file';
const TRAILER = 'Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>';

describe('bot co-author token confinement', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bot-co-author-token-'));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Operator'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'operator@example.com'], { cwd: dir });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir });
  });
  afterEach(async () => { installDaemonBotCoAuthor(undefined); await rm(dir, { recursive: true, force: true }); });

  it('keeps a seeded token out of stamped artifacts and only grants bot access to the identity child', async () => {
    const calls: unknown[] = [];
    const resolver = createBotCoAuthorResolver({
      cwd: dir,
      runner: async (args, options) => { calls.push({ args, options }); return { stdout: JSON.stringify({ login: 'conductor-bot', id: 4242 }) }; },
      readCredential: async () => ({ kind: 'configured', tokenFile: TOKEN_FILE }),
      readToken: async () => ({ kind: 'token', token: TOKEN }),
    });
    installDaemonBotCoAuthor(resolver);

    const resolved = await resolver.prepare();
    await prepareWorktree(dir);
    const message = withDaemonCoAuthorTrailer('engine bookkeeping');
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'hook stamped'], { cwd: dir });
    const hookMessage = (await execFileAsync('git', ['log', '-1', '--format=%B'], { cwd: dir })).stdout;
    const artifacts = [
      JSON.stringify(resolved),
      await readFile(join(dir, '.pipeline', 'co-author'), 'utf8'),
      message,
      hookMessage,
    ];

    expect(calls).toEqual([{ args: ['api', 'user'], options: { cwd: dir, credential: 'bot' } }]);
    expect(artifacts.every((value) => value.includes(TRAILER))).toBe(true);
    expect(artifacts.join('\n')).not.toContain(TOKEN);
    expect(process.env.GH_TOKEN).not.toBe(TOKEN);
  });

  it('redacts a token-echoing identity failure across events, persistence, daemon logging, and results', async () => {
    const events = new ConductorEventEmitter();
    const eventsPath = join(dir, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    const log: string[] = [];
    events.on('bot_co_author_skipped', (event) => renderDaemonEvent(event, (line) => log.push(line)));
    persister.start();
    const resolver = createBotCoAuthorResolver({
      cwd: dir,
      events,
      runner: async () => { throw new Error(`gh stderr leaked ${TOKEN} from ${TOKEN_FILE}`); },
      readCredential: async () => ({ kind: 'configured', tokenFile: TOKEN_FILE }),
      readToken: async () => ({ kind: 'token', token: TOKEN }),
    });

    const result = await resolver.prepare();
    persister.stop();
    const serialized = [JSON.stringify(result), await readFile(eventsPath, 'utf8'), ...log].join('\n');
    expect(result).toEqual({ kind: 'unavailable', reason: 'identity-read-failed' });
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(TOKEN_FILE);
  });

  it('emits a closed token-unavailable event', async () => {
    const seen: unknown[] = [];
    const resolver = createBotCoAuthorResolver({
      cwd: dir, runner: async () => ({ stdout: '{}' }),
      readCredential: async () => ({ kind: 'configured', tokenFile: TOKEN_FILE }),
      readToken: async () => ({ kind: 'unavailable' }),
      events: { emit: async (event: ConductorEvent) => { seen.push(event); } } as never,
    });
    await resolver.prepare();
    expect(seen).toEqual([{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }]);
  });
});
