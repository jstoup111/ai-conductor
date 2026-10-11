// Covers: task:39
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { CELLS } from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execFile('git', ['-C', root, ...args])).stdout.trim();
}

describe('N=1 restack absence', () => {
  it.each(CELLS)('keeps the committed $name event cell free of restack state', async (cell) => {
    const fixture = await readFile(
      join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${cell.name}-events.golden`),
      'utf8',
    );

    expect(fixture).not.toContain('"type":"restack_');
    expect(fixture).not.toContain('refs/conductor/');
  });

  it('re-kicks an N=1 feature through its legacy rebase boundary without restack state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'n1-restack-absence-'));
    roots.push(root);
    await git(root, 'init', '-q', '-b', 'main');
    await git(root, 'config', 'user.email', 'n1@example.test');
    await git(root, 'config', 'user.name', 'N1 Test');
    await writeFile(join(root, 'README.md'), 'base\n');
    await git(root, 'add', 'README.md');
    await git(root, 'commit', '-qm', 'base');
    await git(root, 'switch', '-qc', 'feature/plain');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, REKICK_SENTINEL), 'rekick\n');

    const events = new ConductorEventEmitter();
    const eventTypes: string[] = [];
    for (const type of ['restack_planned', 'restack_applied', 'restack_conflict', 'restack_refused', 'restack_recovered'] as const) {
      events.on(type, (event) => eventTypes.push(event.type));
    }
    const gitBoundary: string[][] = [];

    await expect(resumeRebaseFirst({
      worktreePath: root,
      localBase: 'main',
      slug: 'plain',
      events,
      ranManualTest: false,
      performRebase: async () => {
        gitBoundary.push(['rebase', 'main']);
        return { kind: 'noop' };
      },
    })).resolves.toBe('rebased');

    expect(gitBoundary).toEqual([['rebase', 'main']]);
    expect(gitBoundary.flat()).not.toContain('update-ref');
    expect(eventTypes.filter((type) => type.startsWith('restack_'))).toEqual([]);
    await expect(readFile(join(root, REKICK_SENTINEL), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(root, 'for-each-ref', '--format=%(refname)', 'refs/conductor/plain/')).toBe('');
  });
});
