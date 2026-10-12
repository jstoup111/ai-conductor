// Covers: task:6
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../../src/engine/rebase.js';
import { replayChildRange, type CommitterStamp } from '../../../src/engine/restack/restack-replay.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseCommitSha, type ChildRange, type CommitSha } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);

const stamp: CommitterStamp = {
  name: 'Restack Journal',
  email: 'journal@example.test',
  date: '2030-02-03T04:05:06Z',
};

interface ReplayFixture {
  readonly repo: string;
  readonly range: ChildRange;
  readonly newParent: CommitSha;
  readonly commits: { readonly feature: CommitSha; readonly evidence: CommitSha; readonly alreadyCarried: CommitSha };
}

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw);
  if (!parsed) throw new Error(`expected Git object name, got ${raw}`);
  return parsed;
}

async function createFixture(options: { operatorConfig?: boolean; signing?: boolean } = {}): Promise<ReplayFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'restack-replay-'));
  const git = (args: string[], env?: NodeJS.ProcessEnv) => execFile('git', args, { cwd: repo, env });
  const commit = async (message: string, author: { name: string; email: string; date: string }) => {
    await git(['add', '.']);
    await git(['commit', '-qm', message], {
      ...process.env,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_AUTHOR_DATE: author.date,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      GIT_COMMITTER_DATE: author.date,
    });
  };
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Fixture Committer']);
    await git(['config', 'user.email', 'fixture@example.test']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await commit('base', { name: 'Base Author', email: 'base@example.test', date: '2020-01-01T00:00:00+00:00' });
    const oldParent = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

    await git(['checkout', '-qb', 'child']);
    await writeFile(join(repo, 'feature.txt'), 'feature\n');
    await commit('feature message\n\nFeature-Trailer: exact', { name: 'Feature Author', email: 'feature@example.test', date: '2021-02-03T04:05:06+00:00' });
    const feature = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

    await git(['commit', '--allow-empty', '-qm', 'Evidence: TDD red\n\nEvidence-Trailer: preserved'], {
      ...process.env,
      GIT_AUTHOR_NAME: 'Evidence Author',
      GIT_AUTHOR_EMAIL: 'evidence@example.test',
      GIT_AUTHOR_DATE: '2021-02-03T04:05:07+00:00',
      GIT_COMMITTER_NAME: 'Evidence Author',
      GIT_COMMITTER_EMAIL: 'evidence@example.test',
      GIT_COMMITTER_DATE: '2021-02-03T04:05:07+00:00',
    });
    const evidence = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

    await writeFile(join(repo, 'already-carried.txt'), 'carried\n');
    await commit('already carried', { name: 'Carried Author', email: 'carried@example.test', date: '2021-02-03T04:05:08+00:00' });
    const alreadyCarried = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

    await git(['checkout', '-qb', 'new-parent', oldParent]);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    await writeFile(join(repo, 'already-carried.txt'), 'carried\n');
    await commit('upstream carries C2', { name: 'Upstream Author', email: 'upstream@example.test', date: '2022-02-03T04:05:06+00:00' });
    const newParent = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());

    if (options.operatorConfig) {
      await git(['config', 'rebase.updateRefs', 'true']);
      await git(['config', 'rebase.autoSquash', 'true']);
      await git(['config', 'merge.renames', 'false']);
    }
    if (options.signing) {
      const privateKey = join(repo, 'replay-signing-key');
      const allowedSigners = join(repo, 'allowed-signers');
      await execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKey]);
      await writeFile(allowedSigners, `restack-test ${await readFile(`${privateKey}.pub`, 'utf8')}`);
      await git(['config', 'gpg.format', 'ssh']);
      await git(['config', 'user.signingkey', privateKey]);
      await git(['config', 'gpg.ssh.allowedSignersFile', allowedSigners]);
      await git(['config', 'commit.gpgSign', 'true']);
    }

    const child = parseChildId(1);
    if (!child) throw new Error('child 1 should be valid');
    return {
      repo,
      range: { child, oldParent, oldTip: alreadyCarried, kind: 'active' },
      newParent,
      commits: { feature, evidence, alreadyCarried },
    };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

async function commitDetails(repo: string, commit: string) {
  const { stdout } = await execFile('git', ['show', '-s', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B', commit], { cwd: repo });
  const [authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message] = stdout.split('\0');
  return { authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message };
}

describe('replayChildRange (real local Git)', () => {
  it('copies authors and raw messages, fixes committer metadata, preserves started-empty evidence, and drops a commit already carried by the parent', async () => {
    const fixture = await createFixture();
    try {
      const result = await replayChildRange(fixture.range, fixture.newParent, stamp, makeGitRunner(fixture.repo));

      expect([...result.rewrites.keys()]).toEqual([fixture.commits.feature, fixture.commits.evidence]);
      expect(result.rewrites.has(fixture.commits.alreadyCarried)).toBe(false);
      expect(result.tip).toBe(result.rewrites.get(fixture.commits.evidence));
      for (const oldCommit of [fixture.commits.feature, fixture.commits.evidence]) {
        const rewritten = result.rewrites.get(oldCommit);
        expect(rewritten).toBeDefined();
        const [before, after] = await Promise.all([
          commitDetails(fixture.repo, oldCommit),
          commitDetails(fixture.repo, rewritten!),
        ]);
        expect(after.authorName).toBe(before.authorName);
        expect(after.authorEmail).toBe(before.authorEmail);
        expect(after.authorDate).toBe(before.authorDate);
        expect(after.message).toBe(before.message);
        expect(after.committerName).toBe(stamp.name);
        expect(after.committerEmail).toBe(stamp.email);
        expect(after.committerDate).toBe(stamp.date);
      }
      expect((await execFile('git', ['show', '-s', '--format=%B', result.rewrites.get(fixture.commits.evidence)!], { cwd: fixture.repo })).stdout)
        .toContain('Evidence-Trailer: preserved');
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('signs every replayed commit when commit.gpgSign is configured', async () => {
    const fixture = await createFixture({ signing: true });
    try {
      const result = await replayChildRange(fixture.range, fixture.newParent, stamp, makeGitRunner(fixture.repo));
      for (const rewritten of result.rewrites.values()) {
        await expect(execFile('git', ['verify-commit', rewritten], { cwd: fixture.repo })).resolves.toBeDefined();
      }
    } finally {
      await rm(fixture.repo, { recursive: true, force: true });
    }
  });

  it('is deterministic with a journaled stamp, including when operator config conflicts with engine pins', async () => {
    const baseline = await createFixture();
    const configured = await createFixture({ operatorConfig: true });
    try {
      const first = await replayChildRange(baseline.range, baseline.newParent, stamp, makeGitRunner(baseline.repo));
      const again = await replayChildRange(baseline.range, baseline.newParent, stamp, makeGitRunner(baseline.repo));
      const withOperatorConfig = await replayChildRange(configured.range, configured.newParent, stamp, makeGitRunner(configured.repo));

      expect([...again.rewrites.entries()]).toEqual([...first.rewrites.entries()]);
      expect(again.tip).toBe(first.tip);
      expect([...withOperatorConfig.rewrites.entries()]).toEqual([...first.rewrites.entries()]);
      expect(withOperatorConfig.tip).toBe(first.tip);
    } finally {
      await Promise.all([
        rm(baseline.repo, { recursive: true, force: true }),
        rm(configured.repo, { recursive: true, force: true }),
      ]);
    }
  });
});
