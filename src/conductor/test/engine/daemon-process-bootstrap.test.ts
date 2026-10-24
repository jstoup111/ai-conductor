// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { installDaemonBotCoAuthor } from '../../src/engine/bot-co-author.js';
import { installDaemonProcessServices } from '../../src/engine/daemon-process-bootstrap.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFileAsync = promisify(execFile);
const TRAILER = 'Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>';

describe('daemon process bootstrap', () => {
  let projectRoot: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', projectRoot, ...args]);
    return stdout.trim();
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-process-bootstrap-'));
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Operator');
    await git('config', 'user.email', 'operator@example.com');
    await git('config', 'commit.gpgsign', 'false');
    await git('commit', '--allow-empty', '-m', 'initial');
  });

  afterEach(async () => {
    installDaemonBotCoAuthor(undefined);
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('installs a resolved identity that preparation passes to the commit hook', async () => {
    installDaemonProcessServices({
      projectRoot,
      events: new ConductorEventEmitter(),
      runner: (async () => ({ stdout: JSON.stringify({ login: 'example-bot', id: 42 }) })) as GhRunner,
      readCredential: async () => ({ kind: 'configured', tokenFile: '/token' }),
      readToken: async () => ({ kind: 'token', token: 'secret' }),
    });

    await prepareWorktree(projectRoot, undefined, { dispatchStart: true, dispatchStartTimeoutSeconds: 1 });
    await git('commit', '--allow-empty', '-m', 'engine commit');

    expect({
      coAuthor: await readFile(join(projectRoot, '.pipeline', 'co-author'), 'utf8'),
      author: await git('log', '-1', '--format=%an <%ae>'),
      trailers: await git('log', '-1', '--format=%(trailers:only,unfold)')
    }).toEqual({
      coAuthor: `${TRAILER}\n`,
      author: 'Operator <operator@example.com>',
      trailers: TRAILER,
    });
  });

  it('emits an unavailable-token skip on the feature event bus without a trailer', async () => {
    const daemonEvents = new ConductorEventEmitter();
    const featureEvents = new ConductorEventEmitter();
    const skipped: unknown[] = [];
    featureEvents.on('bot_co_author_skipped', event => { skipped.push(event); });
    installDaemonProcessServices({
      projectRoot,
      events: daemonEvents,
      runner: (async () => ({ stdout: JSON.stringify({ login: 'unused', id: 1 }) })) as GhRunner,
      readCredential: async () => ({ kind: 'configured', tokenFile: '/missing-token' }),
      readToken: async () => ({ kind: 'unavailable' }),
    });

    await prepareWorktree(projectRoot, undefined, {
      events: featureEvents,
      dispatchStart: true,
      dispatchStartTimeoutSeconds: 1,
    });
    await git('commit', '--allow-empty', '-m', 'engine commit');

    await expect(access(join(projectRoot, '.pipeline', 'co-author'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(skipped).toEqual([{ type: 'bot_co_author_skipped', reason: 'token-unavailable' }]);
    expect(await git('log', '-1', '--format=%B')).not.toContain(TRAILER);
  });

  it('leaves an unconfigured bot silent and unstamped', async () => {
    const events = new ConductorEventEmitter();
    const skipped: unknown[] = [];
    events.on('bot_co_author_skipped', event => { skipped.push(event); });
    installDaemonProcessServices({
      projectRoot,
      events,
      runner: (async () => ({ stdout: JSON.stringify({ login: 'unused', id: 1 }) })) as GhRunner,
      readCredential: async () => ({ kind: 'unconfigured' }),
    });

    await prepareWorktree(projectRoot, undefined, {
      events,
      dispatchStart: true,
      dispatchStartTimeoutSeconds: 1,
    });
    await git('commit', '--allow-empty', '-m', 'engine commit');

    await expect(access(join(projectRoot, '.pipeline', 'co-author'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(skipped).toEqual([]);
    expect(await git('log', '-1', '--format=%B')).not.toContain(TRAILER);
  });
});
