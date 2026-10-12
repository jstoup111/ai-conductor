// Covers: task:26
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { commitEngineChange } from '../../src/engine/guarded-engine-commit.js';
import {
  createRestackJournal,
  journalRefFor,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../src/engine/restack/restack-journal.js';
import { type RestackOpId } from '../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('guarded engine commit (real local Git)', () => {
  it('refuses while the restack journal is ready and leaves HEAD unchanged', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'guarded-engine-commit-'));
    repos.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'guard@example.invalid']);
    await git(['config', 'user.name', 'Guarded commit test']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', 'base.txt']);
    await git(['commit', '-qm', 'base']);
    const headBefore = (await git(['rev-parse', 'HEAD'])).stdout.trim();

    const draft: RestackJournalDraft = {
      opId: 'guarded-commit-op' as RestackOpId,
      cause: 'feature-repair',
      committer: { name: 'Guarded commit', email: 'guard@example.invalid', date: '2030-01-01T00:00:00Z' },
      dirtyPaths: [],
      refs: [],
      ranges: [],
      children: [],
    };
    const created = await createRestackJournal(repo, 'demo', draft);
    if (created.kind !== 'created') throw new Error('journal was not created');
    const readyBlob = await writeRestackJournalBlob(repo, { ...created.journal.journal, state: 'ready' });
    await git(['update-ref', journalRefFor('demo'), readyBlob, created.journal.blob]);
    await writeFile(join(repo, 'engine-note.txt'), 'must not commit\n');

    await expect(commitEngineChange({
      worktree: repo,
      slug: 'demo',
      pathspec: ['engine-note.txt'],
      message: 'chore: guarded engine change',
      noVerify: true,
    })).resolves.toMatchObject({ kind: 'refused' });
    expect((await git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(headBefore);
  });
});
