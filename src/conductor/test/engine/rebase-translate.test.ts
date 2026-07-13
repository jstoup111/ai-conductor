import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// Task 2 of .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md
//
// RED spec for `buildRewriteMap`, the pure old-sha->new-sha correspondence
// builder described in adr-2026-07-12-rebase-evidence-stamp-translation.md.
// `src/engine/rebase-translate.ts` does not exist yet — this import is
// expected to fail module resolution, which is the correct RED signal for
// this task. Task 3 (GREEN) creates the module and makes these pass.
//
// Contract pinned here (mirrors the injected-GitRunner pattern of
// `src/engine/rebase.ts`'s `GitRunner`/`makeGitRunner`, but adds an optional
// `input` for the `git patch-id --stable` plumbing, which reads a diff on
// stdin and has no non-stdin invocation form):
//
//   buildRewriteMap(git, onto, origHead, head): Promise<{
//     map: Record<string, string>;   // old sha (full AND 7-char short) -> new full sha
//     residue: string[];             // full pre-image shas with no patch-id match post-rebase
//   }>
//
// Git calls buildRewriteMap is expected to make, in this shape:
//   git(['rev-list', `${onto}..${origHead}`])          -> pre-image sha list (newline-separated)
//   git(['rev-list', `${onto}..${head}`])               -> post-image sha list (newline-separated)
//   git(['show', sha])                                  -> diff text, per sha in both lists
//   git(['patch-id', '--stable'], { input: diffText })  -> "<patch-id> <sha>" per sha
import type { GitResult } from '../../src/engine/rebase.js';
import { buildRewriteMap } from '../../src/engine/rebase-translate.js';

interface FakeGitOptions {
  input?: string;
}

/** Builds a fake GitRunner-shaped function from canned per-command responses. */
function makeFakeGit(opts: {
  revList: Record<string, string[]>; // `${onto}..${ref}` -> sha list (newest first)
  show: Record<string, string>; // sha -> diff text
  patchId: Record<string, string>; // diff text -> patch-id
}): (args: string[], gitOpts?: FakeGitOptions) => Promise<GitResult> {
  return async (args: string[], gitOpts?: FakeGitOptions): Promise<GitResult> => {
    const [cmd, ...rest] = args;

    if (cmd === 'rev-list') {
      const range = rest[0];
      const shas = opts.revList[range];
      if (shas === undefined) {
        throw new Error(`unexpected rev-list range in fake git: ${range}`);
      }
      return { exitCode: 0, stdout: shas.join('\n') + (shas.length ? '\n' : ''), stderr: '' };
    }

    if (cmd === 'show') {
      const sha = rest[0];
      const diff = opts.show[sha];
      if (diff === undefined) {
        throw new Error(`unexpected show sha in fake git: ${sha}`);
      }
      return { exitCode: 0, stdout: diff, stderr: '' };
    }

    if (cmd === 'patch-id') {
      const diff = gitOpts?.input ?? '';
      const id = opts.patchId[diff];
      if (id === undefined) {
        throw new Error(`unexpected patch-id input in fake git: ${JSON.stringify(diff)}`);
      }
      return { exitCode: 0, stdout: `${id} deadbeef\n`, stderr: '' };
    }

    throw new Error(`unexpected git command in fake git: ${args.join(' ')}`);
  };
}

const ONTO = 'onto-sha';

describe('buildRewriteMap (RED — module does not exist yet)', () => {
  it('maps each pre-image sha to its post-image sha by matching patch-id (1:1 unconflicted)', async () => {
    const origHead = 'orig-head';
    const head = 'new-head';

    const preFull = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const postFull = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const git = makeFakeGit({
      revList: {
        [`${ONTO}..${origHead}`]: [preFull],
        [`${ONTO}..${head}`]: [postFull],
      },
      show: {
        [preFull]: 'diff --git a/x b/x\n+one line changed\n',
        [postFull]: 'diff --git a/x b/x\n+one line changed\n',
      },
      patchId: {
        'diff --git a/x b/x\n+one line changed\n': 'patchid-shared',
      },
    });

    const { map, residue } = await buildRewriteMap(git, ONTO, origHead, head);

    expect(map[preFull]).toBe(postFull);
    expect(residue).toEqual([]);
  });

  it('lists a pre-image sha as residue when its patch-id has no post-image match', async () => {
    const origHead = 'orig-head';
    const head = 'new-head';

    const preDropped = 'cccccccccccccccccccccccccccccccccccccccc';
    const preKept = 'dddddddddddddddddddddddddddddddddddddddd';
    const postKept = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'.slice(0, 40);

    const git = makeFakeGit({
      revList: {
        [`${ONTO}..${origHead}`]: [preKept, preDropped],
        [`${ONTO}..${head}`]: [postKept],
      },
      show: {
        [preDropped]: 'diff --git a/dropped b/dropped\n+content that changed during rebase\n',
        [preKept]: 'diff --git a/kept b/kept\n+unchanged content\n',
        [postKept]: 'diff --git a/kept b/kept\n+unchanged content\n',
      },
      patchId: {
        'diff --git a/dropped b/dropped\n+content that changed during rebase\n': 'patchid-dropped-preimage',
        'diff --git a/kept b/kept\n+unchanged content\n': 'patchid-kept',
      },
    });

    const { map, residue } = await buildRewriteMap(git, ONTO, origHead, head);

    expect(map[preKept]).toBe(postKept);
    expect(map[preDropped]).toBeUndefined();
    expect(residue).toEqual([preDropped]);
  });

  it('indexes both the full 40-char sha and its 7-char short form to the same mapped value', async () => {
    const origHead = 'orig-head';
    const head = 'new-head';

    const preFull = 'ffffffffffffffffffffffffffffffffffffffff';
    const preShort = preFull.slice(0, 7);
    const postFull = '1111111111111111111111111111111111111111'.slice(0, 40);

    const git = makeFakeGit({
      revList: {
        [`${ONTO}..${origHead}`]: [preFull],
        [`${ONTO}..${head}`]: [postFull],
      },
      show: {
        [preFull]: 'diff --git a/short b/short\n+short-sha probe\n',
        [postFull]: 'diff --git a/short b/short\n+short-sha probe\n',
      },
      patchId: {
        'diff --git a/short b/short\n+short-sha probe\n': 'patchid-short-probe',
      },
    });

    const { map } = await buildRewriteMap(git, ONTO, origHead, head);

    expect(map[preFull]).toBe(postFull);
    expect(map[preShort]).toBe(postFull);
    expect(map[preFull]).toBe(map[preShort]);
  });
});

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
