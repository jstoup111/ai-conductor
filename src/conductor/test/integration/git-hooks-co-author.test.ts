import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

const execFileAsync = promisify(execFile);
const TRAILER = 'Co-authored-by: conductor-bot <4242+conductor-bot@users.noreply.github.com>';

describe('integration/git-hooks-co-author', () => {
  let dir: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
    return stdout.trim();
  }

  async function message(): Promise<string> {
    return git('log', '-1', '--format=%B');
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-hooks-co-author-'));
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Operator');
    await git('config', 'user.email', 'operator@example.com');
    await git('config', 'commit.gpgsign', 'false');
    await git('commit', '--allow-empty', '-m', 'initial');
    await prepareWorktree(dir);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'co-author'), `${TRAILER}\n`, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stamps plain and allowed-empty commits without changing operator identity', async () => {
    await writeFile(join(dir, 'work.txt'), 'work\n', 'utf8');
    await git('add', 'work.txt');
    await git('commit', '-m', 'work\n\nTask: 6');
    expect(await message()).toContain('Task: 6');
    expect(await message()).toContain(TRAILER);
    expect(await git('log', '-1', '--format=%an <%ae> %cn <%ce>')).toBe('Operator <operator@example.com> Operator <operator@example.com>');

    await git('commit', '--allow-empty', '-m', 'evidence');
    expect(await message()).toContain(TRAILER);
  });

  it('does not restamp an existing bot trailer and preserves another co-author', async () => {
    await writeFile(join(dir, 'work.txt'), 'work\n', 'utf8');
    await git('add', 'work.txt');
    await git('commit', '-m', `work\n\nCo-authored-by: other <other@example.com>\n${TRAILER}`);
    const recorded = await message();
    expect(recorded.match(new RegExp(TRAILER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(recorded).toContain('Co-authored-by: other <other@example.com>');
  });
});
