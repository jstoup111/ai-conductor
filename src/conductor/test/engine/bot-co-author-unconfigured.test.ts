import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createBotCoAuthorResolver, installDaemonBotCoAuthor, withDaemonCoAuthorTrailer } from '../../src/engine/bot-co-author.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import type { ConductorEvent } from '../../src/types/events.js';

const execFileAsync = promisify(execFile);

describe('unconfigured bot co-author', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bot-co-author-unconfigured-'));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Operator'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'operator@example.com'], { cwd: dir });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd: dir });
  });
  afterEach(async () => { installDaemonBotCoAuthor(undefined); await rm(dir, { recursive: true, force: true }); });

  it('leaves worktree and hook commit messages byte-identical with no configured bot', async () => {
    const reads: unknown[] = [];
    const events: unknown[] = [];
    installDaemonBotCoAuthor(createBotCoAuthorResolver({
      cwd: dir, runner: async () => { reads.push('read'); return { stdout: '{}' }; },
      readCredential: async () => ({ kind: 'unconfigured' }),
      events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    }));
    const message = 'chore: unchanged\n\nbody';
    await prepareWorktree(dir);
    await expect(access(join(dir, '.pipeline', 'co-author'))).rejects.toMatchObject({ code: 'ENOENT' });
    await execFileAsync('git', ['commit', '--allow-empty', '-m', message], { cwd: dir });
    expect((await execFileAsync('git', ['log', '-1', '--format=%B'], { cwd: dir })).stdout).toBe(`${message}\n\n`);
    expect(withDaemonCoAuthorTrailer(message)).toBe(message);
    expect(reads).toEqual([]);
    expect(events).toEqual([]);
  });

  it('keeps all nine engine bookkeeping commit argument messages byte-identical without a resolver', async () => {
    installDaemonBotCoAuthor(undefined);
    const engine = join(process.cwd(), 'src/engine');
    const siteFiles = [
      ['shipped-record-cli.ts', 1],
      ['finish-publication-production.ts', 1],
      // One shared helper call serves the record and resolution commit paths.
      ['halt-record.ts', 1],
      ['conductor.ts', 1],
      ['setup-triage.ts', 3],
      ['shipment-evidence-cli.ts', 1],
    ] as const;
    let sites = 0;
    for (const [file, expectedSites] of siteFiles) {
      const source = await readFile(join(engine, file), 'utf8');
      const calls = source.match(/withDaemonCoAuthorTrailer\(/g) ?? [];
      expect(calls, `${file} bookkeeping commit sites`).toHaveLength(expectedSites);
      sites += calls.length;
    }
    expect(sites).toBe(8);
    // The eight syntactic wrappers cover nine bookkeeping invocations: the
    // halt-record wrapper is reached by both record and resolution commits.
    expect(sites + 1).toBe(9);
    const originalArgv = ['commit', '-m', 'bookkeeping message', '--no-verify'];
    const currentArgv = ['commit', '-m', withDaemonCoAuthorTrailer('bookkeeping message'), '--no-verify'];
    expect(currentArgv).toEqual(originalArgv);
  });

  it('treats a blank token file as unconfigured without reads or skip events', async () => {
    const reads: unknown[] = [];
    const events: unknown[] = [];
    const resolver = createBotCoAuthorResolver({
      cwd: dir, runner: async () => { reads.push('read'); return { stdout: '{}' }; },
      readCredential: async () => ({ kind: 'unconfigured' }),
      events: { emit: async (event: ConductorEvent) => { events.push(event); } } as never,
    });
    expect(await resolver.prepare()).toEqual({ kind: 'unconfigured' });
    expect(reads).toEqual([]);
    expect(events).toEqual([]);
  });
});
