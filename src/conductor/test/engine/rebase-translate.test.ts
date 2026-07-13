import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// Task 1 of .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md
//
// This test pins two real-git-behavior assumptions the whole feature's design
// (Tasks 2-15) depends on. It is not RED->GREEN against production code —
// there is no production code here. The test itself, once passing, is the
// executable documentation of these facts:
//
// (a) `git patch-id --stable` produces a matching patch-id for a commit
//     before and after an unconflicted rebase replay. This is the
//     correspondence mechanism used to map old shas to new shas after rebase.
//
// (b) The default `--empty` behavior of `git rebase --autostash` when
//     replaying a commit that is already empty (e.g. an intentional
//     "satisfied-by" evidence commit produced by this repo's attribution-lane
//     machinery) — whether such a commit is DROPPED or KEPT. This determines
//     whether Task 15 must add `--empty=keep` to the `git rebase --autostash`
//     invocation in src/engine/rebase.ts's `performRebase`.

async function git(cwd: string, args: string[]) {
  return execa('git', args, { cwd });
}

async function patchId(cwd: string, sha: string): Promise<string> {
  // `git show <sha> | git patch-id --stable` — patch-id reads a diff on
  // stdin and prints "<patch-id> <sha-of-input>"; we only want the first
  // token, which is stable across the tree-move performed by a rebase.
  const show = await execa('git', ['show', sha], { cwd });
  const result = await execa('git', ['patch-id', '--stable'], {
    cwd,
    input: show.stdout,
  });
  const [id] = result.stdout.trim().split(/\s+/);
  return id;
}

describe('rebase evidence-stamp translation — pinned git assumptions', () => {
  let repoDir: string;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'rebase-translate-'));

    await git(repoDir, ['init', '-b', 'main']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test User']);

    // Base commit.
    await writeFile(join(repoDir, 'base.txt'), 'base\n');
    await git(repoDir, ['add', 'base.txt']);
    await git(repoDir, ['commit', '-m', 'base commit']);

    // Feature branch off main.
    await git(repoDir, ['checkout', '-b', 'feature']);

    await writeFile(join(repoDir, 'feature.txt'), 'feature line 1\n');
    await git(repoDir, ['add', 'feature.txt']);
    await git(repoDir, ['commit', '-m', 'feature: add feature.txt']);

    await writeFile(join(repoDir, 'feature.txt'), 'feature line 1\nfeature line 2\n');
    await git(repoDir, ['add', 'feature.txt']);
    await git(repoDir, ['commit', '-m', 'feature: extend feature.txt']);

    // An intentional empty "satisfied-by" evidence commit, as produced by
    // this repo's attribution-lane machinery.
    await git(repoDir, [
      'commit',
      '--allow-empty',
      '-m',
      'evidence: satisfied-by #123 (no code change)',
    ]);

    // Move the base forward on main so the feature rebase has real work to
    // do (an unrelated file, no overlap with feature.txt — unconflicted).
    await git(repoDir, ['checkout', 'main']);
    await writeFile(join(repoDir, 'unrelated.txt'), 'unrelated\n');
    await git(repoDir, ['add', 'unrelated.txt']);
    await git(repoDir, ['commit', '-m', 'main: unrelated advance']);

    await git(repoDir, ['checkout', 'feature']);
  }, 30_000);

  afterAll(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('rebases the feature branch onto the moved base without conflicts', async () => {
    // Capture pre-rebase shas for the two non-empty feature commits before
    // HEAD moves.
    const log = await git(repoDir, ['log', '--format=%H', 'main..feature']);
    const preShas = log.stdout.trim().split('\n').filter(Boolean);
    expect(preShas.length).toBe(3); // 2 real commits + 1 empty evidence commit

    const rebase = await git(repoDir, ['rebase', '--autostash', 'main']);
    expect(rebase.exitCode).toBe(0);
  });

  it('(a) produces matching --stable patch-ids for unconflicted replayed commits pre- and post-rebase', async () => {
    const postLog = await git(repoDir, ['log', '--format=%H %s', 'main..feature']);
    const postEntries = postLog.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split(' ');
        return { sha, subject: rest.join(' ') };
      });

    // Pre-rebase shas are still reachable via ORIG_HEAD, which git sets to
    // the pre-rebase tip of the branch before rewriting it.
    const origHead = (await git(repoDir, ['rev-parse', 'ORIG_HEAD'])).stdout.trim();
    const preLogAll = await git(repoDir, ['log', '--format=%H %s', origHead, '-n', '3']);
    const preEntries = preLogAll.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split(' ');
        return { sha, subject: rest.join(' ') };
      });

    expect(preEntries.length).toBe(3);
    expect(postEntries.length).toBeGreaterThanOrEqual(2);

    const realPre = preEntries.filter((e) => !e.subject.startsWith('evidence:'));
    const realPost = postEntries.filter((e) => !e.subject.startsWith('evidence:'));

    expect(realPre.length).toBe(2);
    expect(realPost.length).toBe(2);

    for (const preEntry of realPre) {
      const postEntry = realPost.find((p) => p.subject === preEntry.subject);
      expect(postEntry).toBeDefined();
      expect(postEntry!.sha).not.toBe(preEntry.sha); // rebase rewrites shas

      const prePatchId = await patchId(repoDir, preEntry.sha);
      const postPatchId = await patchId(repoDir, postEntry!.sha);

      expect(prePatchId).toBeTruthy();
      expect(prePatchId).toBe(postPatchId);
    }
  });

  it('(b) records whether git rebase --autostash DROPS or KEEPS an already-empty evidence commit by default', async () => {
    const postLog = await git(repoDir, ['log', '--format=%s', 'main..feature']);
    const postSubjects = postLog.stdout.trim().split('\n').filter(Boolean);

    const kept = postSubjects.some((s) => s.startsWith('evidence: satisfied-by #123'));

    // Pin the observed behavior. As of this git version, plain (non-`-i`)
    // `git rebase` — which is what `performRebase` invokes via
    // `git rebase --autostash <base>` — KEEPS a commit that was already
    // empty going into the rebase (the `--empty=drop` default only applies
    // to a commit that BECOMES empty as a result of the replay, e.g. because
    // its changes were already applied upstream; an intentionally
    // `--allow-empty` commit is untouched and stays empty in the rebased
    // history). If this assertion ever flips (e.g. a git version change),
    // Task 15's decision on whether performRebase needs `--empty=keep`
    // (or must instead defend against a newly-observed DROP) must be
    // revisited.
    expect(kept).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `[rebase-translate pin] git rebase --autostash --empty behavior for an ` +
        `already-empty commit: ${kept ? 'KEPT' : 'DROPPED'}`,
    );
  });
});
