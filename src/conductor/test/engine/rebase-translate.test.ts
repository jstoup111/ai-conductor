import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
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
import { buildRewriteMap, resolveThroughMap } from '../../src/engine/rebase-translate.js';
// @ts-expect-error — Task 5 (GREEN) adds this export; Task 4 (RED) asserts it doesn't exist yet.
import { applyMapToStores } from '../../src/engine/rebase-translate.js';

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

// Task 4 of .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md
//
// RED spec for `applyMapToStores`, the in-place rewrite of
// `.pipeline/task-evidence.json` (EvidenceStamp `sha`, `citedShas[]`,
// `verdictAnchor`) and `.pipeline/task-status.json` (TaskStatusRecord
// `commit`, both full 40-char and 7-char short forms) through a persisted
// rewrite map, per adr-2026-07-12-rebase-evidence-stamp-translation.md.
// `applyMapToStores` does not exist yet — the import above is expected to
// fail module resolution, which is the correct RED signal for this task.
// Task 5 (GREEN) implements it.
//
// Contract pinned here:
//   applyMapToStores(projectRoot: string, map: Record<string, string>): Promise<void>
// Reads `.pipeline/task-evidence.json` and `.pipeline/task-status.json` from
// `projectRoot`, rewrites every sha occurrence that is a key in `map` to its
// mapped value, and writes both files back in place. Fields/shas that are
// NOT keys in the map are left byte-identical.
describe('applyMapToStores (RED — not implemented yet, Task 5)', () => {
  const OLD_FULL_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const NEW_FULL_A = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const OLD_SHORT_A = OLD_FULL_A.slice(0, 7);
  const NEW_SHORT_A = NEW_FULL_A.slice(0, 7);

  const OLD_FULL_B = 'cccccccccccccccccccccccccccccccccccccccc'.slice(0, 40);
  const NEW_FULL_B = 'dddddddddddddddddddddddddddddddddddddddd'.slice(0, 40);
  const OLD_SHORT_B = OLD_FULL_B.slice(0, 7);
  const NEW_SHORT_B = NEW_FULL_B.slice(0, 7);

  // A sha that is NOT a key in the rewrite map — must be left untouched
  // wherever it appears in either fixture.
  const UNMAPPED_FULL = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'.slice(0, 40);
  const UNMAPPED_SHORT = UNMAPPED_FULL.slice(0, 7);

  const REWRITE_MAP: Record<string, string> = {
    [OLD_FULL_A]: NEW_FULL_A,
    [OLD_SHORT_A]: NEW_FULL_A,
    [OLD_FULL_B]: NEW_FULL_B,
    [OLD_SHORT_B]: NEW_FULL_B,
  };

  function evidenceFixture() {
    return {
      evidenceStamps: {
        'T1': {
          sha: OLD_FULL_A,
          form: 'commit',
          citedShas: [OLD_FULL_A, UNMAPPED_FULL],
          verdictAnchor: OLD_SHORT_B,
        },
        'T2': {
          sha: UNMAPPED_FULL,
          form: 'evidence:satisfied-by',
          citedShas: [OLD_SHORT_A, UNMAPPED_SHORT],
        },
      },
      noEvidenceAttempts: 0,
      noEvidenceReasons: [],
      migrationGrandfather: [],
    };
  }

  function statusFixture() {
    return {
      plan_ref: 'some-plan.md',
      tasks: [
        { id: 'T1', name: 'first task', status: 'completed', commit: OLD_FULL_A },
        { id: 'T2', name: 'second task', status: 'completed', commit: OLD_SHORT_B },
        { id: 'T3', name: 'third task', status: 'completed', commit: UNMAPPED_FULL },
        { id: 'T4', name: 'unstarted task', status: 'pending' },
      ],
    };
  }

  let projectRoot: string;
  let pipelineDir: string;
  let evidencePath: string;
  let statusPath: string;
  let evidenceBefore: string;
  let statusBefore: string;

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'apply-map-to-stores-'));
    pipelineDir = join(projectRoot, '.pipeline');
    await mkdirForFixtures(pipelineDir);

    evidencePath = join(pipelineDir, 'task-evidence.json');
    statusPath = join(pipelineDir, 'task-status.json');

    evidenceBefore = JSON.stringify(evidenceFixture(), null, 2);
    statusBefore = JSON.stringify(statusFixture(), null, 2);

    await writeFile(evidencePath, evidenceBefore);
    await writeFile(statusPath, statusBefore);
  }, 30_000);

  afterAll(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rewrites every mapped sha occurrence in task-evidence.json (sha, citedShas[], verdictAnchor)', async () => {
    await applyMapToStores(projectRoot, REWRITE_MAP);

    const raw = await readFile(evidencePath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.evidenceStamps.T1.sha).toBe(NEW_FULL_A);
    expect(parsed.evidenceStamps.T1.citedShas).toEqual([NEW_FULL_A, UNMAPPED_FULL]);
    expect(parsed.evidenceStamps.T1.verdictAnchor).toBe(NEW_FULL_B);

    expect(parsed.evidenceStamps.T2.sha).toBe(UNMAPPED_FULL);
    expect(parsed.evidenceStamps.T2.citedShas).toEqual([NEW_FULL_A, UNMAPPED_SHORT]);
  });

  it('rewrites every mapped sha occurrence in task-status.json (commit, full and short forms)', async () => {
    await applyMapToStores(projectRoot, REWRITE_MAP);

    const raw = await readFile(statusPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const byId = Object.fromEntries(
      (parsed.tasks as Array<{ id: string; commit?: string }>).map((t) => [t.id, t]),
    );

    expect(byId.T1.commit).toBe(NEW_FULL_A);
    // T2's original commit was recorded short-form (OLD_SHORT_B); the fix
    // preserves that original width when writing back the resolved value.
    expect(byId.T2.commit).toBe(NEW_SHORT_B);
    expect(byId.T3.commit).toBe(UNMAPPED_FULL);
    expect(byId.T4.commit).toBeUndefined();
  });

  it('before/after diff shows every mapped sha updated and no unmapped sha changed', async () => {
    await applyMapToStores(projectRoot, REWRITE_MAP);

    const evidenceAfter = await readFile(evidencePath, 'utf-8');
    const statusAfter = await readFile(statusPath, 'utf-8');

    expect(evidenceAfter).not.toBe(evidenceBefore);
    expect(statusAfter).not.toBe(statusBefore);

    expect(evidenceAfter).not.toContain(OLD_FULL_A);
    expect(evidenceAfter).not.toContain(OLD_SHORT_B);
    expect(statusAfter).not.toContain(OLD_FULL_A);
    expect(statusAfter).not.toContain(OLD_SHORT_B);

    // Unmapped shas appear identically before and after.
    expect(evidenceAfter).toContain(UNMAPPED_FULL);
    expect(evidenceAfter).toContain(UNMAPPED_SHORT);
    expect(statusAfter).toContain(UNMAPPED_FULL);
  });

  it('leaves fields/shas not present as map keys completely untouched (byte-identical fixture aside from mapped shas)', async () => {
    await applyMapToStores(projectRoot, REWRITE_MAP);

    const evidenceAfter = JSON.parse(await readFile(evidencePath, 'utf-8'));
    const statusAfter = JSON.parse(await readFile(statusPath, 'utf-8'));

    // Non-sha fields are untouched.
    expect(evidenceAfter.noEvidenceAttempts).toBe(0);
    expect(evidenceAfter.noEvidenceReasons).toEqual([]);
    expect(evidenceAfter.migrationGrandfather).toEqual([]);
    expect(evidenceAfter.evidenceStamps.T1.form).toBe('commit');
    expect(evidenceAfter.evidenceStamps.T2.form).toBe('evidence:satisfied-by');

    expect(statusAfter.plan_ref).toBe('some-plan.md');
    const t4 = (statusAfter.tasks as Array<{ id: string; status?: string }>).find(
      (t) => t.id === 'T4',
    );
    expect(t4?.status).toBe('pending');
  });
});

async function mkdirForFixtures(dir: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });
}

// Task 10 of .docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md
//
// RED spec for `writeResidue`, per adr-2026-07-12-rebase-evidence-stamp-translation.md
// Story 7: residue shas (dropped/patch-changed pre-image commits from
// `buildRewriteMap`'s `residue` list) must never be silently repointed. They
// are surfaced instead — persisted to `.pipeline/rebase-residue.json` with
// which task ids cited them and why, and announced via a structured
// `rebase_citation_residue` event (mirrors the `rebase_gate_reverified`
// event-emission pattern in `src/engine/rebase.ts`'s `emitRebaseEvent`,
// which takes a `ConductorEventEmitter` and calls `events.emit({ type, ... })`).
//
// `writeResidue` does not exist yet in rebase-translate.ts — this import is
// expected to fail module resolution, which is the correct RED signal for
// this task. Task 11 (GREEN) implements it.
//
// Contract pinned here:
//   writeResidue(
//     projectRoot: string,
//     events: ConductorEventEmitter,
//     residueEntries: Array<{ sha: string; citingTaskIds: string[]; reason: string }>,
//   ): Promise<void>
// @ts-expect-error — Task 11 (GREEN) adds this export; Task 10 (RED) asserts it doesn't exist yet.
import { writeResidue } from '../../src/engine/rebase-translate.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('writeResidue (RED — not implemented yet, Task 11)', () => {
  const RESIDUE_SHA_A = 'cccccccccccccccccccccccccccccccccccccccc';
  const RESIDUE_SHA_B = 'dddddddddddddddddddddddddddddddddddddddd';

  const RESIDUE_ENTRIES = [
    {
      sha: RESIDUE_SHA_A,
      citingTaskIds: ['T4', 'T7'],
      reason: 'no patch-id match post-rebase (dropped or content changed)',
    },
    {
      sha: RESIDUE_SHA_B,
      citingTaskIds: ['T9'],
      reason: 'no patch-id match post-rebase (dropped or content changed)',
    },
  ];

  let projectRoot: string;
  let residuePath: string;

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'write-residue-'));
    await mkdirForFixtures(join(projectRoot, '.pipeline'));
    residuePath = join(projectRoot, '.pipeline', 'rebase-residue.json');
  }, 30_000);

  afterAll(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes each residue entry with its reason and citing task ids to .pipeline/rebase-residue.json', async () => {
    const events = new ConductorEventEmitter();

    await writeResidue(projectRoot, events, RESIDUE_ENTRIES);

    const raw = await readFile(residuePath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.residue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sha: RESIDUE_SHA_A,
          citingTaskIds: ['T4', 'T7'],
          reason: 'no patch-id match post-rebase (dropped or content changed)',
        }),
        expect.objectContaining({
          sha: RESIDUE_SHA_B,
          citingTaskIds: ['T9'],
          reason: 'no patch-id match post-rebase (dropped or content changed)',
        }),
      ]),
    );
  });

  it('emits a rebase_citation_residue structured event mirroring the rebase_gate_reverified pattern', async () => {
    const events = new ConductorEventEmitter();
    const seen: Array<{ type: string; residue?: unknown }> = [];

    events.on('rebase_citation_residue' as never, (e: { type: string; residue?: unknown }) => {
      seen.push({ type: e.type, residue: e.residue });
    });

    await writeResidue(projectRoot, events, RESIDUE_ENTRIES);

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('rebase_citation_residue');
    expect(seen[0].residue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sha: RESIDUE_SHA_A, citingTaskIds: ['T4', 'T7'] }),
        expect.objectContaining({ sha: RESIDUE_SHA_B, citingTaskIds: ['T9'] }),
      ]),
    );
  });

  it('never repoints residue shas into the persisted rewrite map (nothing silently repointed)', async () => {
    const rewritesPath = join(projectRoot, '.pipeline', 'rebase-rewrites.json');

    // Simulate a real Task-3 persistRewriteMap call for an unrelated,
    // successfully-matched sha, so the rewrites file exists alongside the
    // residue file.
    const { persistRewriteMap } = await import('../../src/engine/rebase-translate.js');
    await persistRewriteMap(projectRoot, {
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    await writeResidue(projectRoot, new ConductorEventEmitter(), RESIDUE_ENTRIES);

    const rewritesRaw = await readFile(rewritesPath, 'utf-8');
    const rewrites = JSON.parse(rewritesRaw);

    // Persisted format is the flat old-sha -> new-sha map (no wrapper
    // object) — see persistRewriteMap's `serialized` assignment.
    expect(Object.keys(rewrites)).not.toContain(RESIDUE_SHA_A);
    expect(Object.keys(rewrites)).not.toContain(RESIDUE_SHA_B);
    expect(Object.values(rewrites)).not.toContain(RESIDUE_SHA_A);
    expect(Object.values(rewrites)).not.toContain(RESIDUE_SHA_B);
  });
});

describe('resolveThroughMap — module contract: never maps a non-key sha (Task 13)', () => {
  // This is the structural no-laundering gate: `resolveThroughMap` is a
  // strict map-key lookup (see src/engine/rebase-translate.ts). A sha that
  // was never a key in the rewrite map — forged, unrelated, or merely
  // sha-shaped — can never be "mapped" to something else. It must come back
  // out identical to what went in, for every sha shape callers may pass.
  const MAP: Record<string, string> = {
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ccccccc: 'ddddddd',
  };

  it.each([
    ['full 40-char sha not in the map', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
    ['short 7-char sha not in the map', 'fffffff'],
    ['sha-shaped but random hex string', '0123456789abcdef0123456789abcdef01234567'],
  ])('returns %s unchanged (identity), never resolved through the map', (_label, sha) => {
    expect(resolveThroughMap(sha, MAP)).toBe(sha);
  });
});

// FR-1 closure (prd-audit 2026-07-13): Story 1's SECOND scenario — the
// persisted map must survive SUCCESSIVE rebases. When a prior rebase already
// persisted `old -> mid` and a second rebase persists `mid -> new` over the
// existing `.pipeline/rebase-rewrites.json`, persistRewriteMap's
// merge-and-close branch (src/engine/rebase-translate.ts:268-294) must
// repoint the stale chain so the file resolves `old -> new` directly —
// no two-hop chain, no stale `old -> mid` left behind. Every other
// persistRewriteMap call in the suite is single-hop against an empty prior
// map, so this is the only test exercising that merge path.
describe('persistRewriteMap — transitive closure across successive rebases (FR-1)', () => {
  const OLD_FULL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const MID_FULL = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const NEW_FULL = 'cccccccccccccccccccccccccccccccccccccccc';
  const OLD_SHORT = OLD_FULL.slice(0, 7);
  const MID_SHORT = MID_FULL.slice(0, 7);

  let projectRoot: string;
  let rewritesPath: string;

  beforeAll(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'persist-rewrite-closure-'));
    rewritesPath = join(projectRoot, '.pipeline', 'rebase-rewrites.json');
  }, 30_000);

  afterAll(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('repoints a prior old→mid hop through a second-rebase mid→new hop so the persisted file resolves old→new', async () => {
    const { persistRewriteMap } = await import('../../src/engine/rebase-translate.js');

    // First rebase: buildRewriteMap-shaped hop (full AND short pre-image
    // keys, both -> the full post-image sha), persisted against NO existing
    // file.
    await persistRewriteMap(projectRoot, {
      [OLD_FULL]: MID_FULL,
      [OLD_SHORT]: MID_FULL,
    });

    // Second rebase: `mid` itself is rewritten to `new`; persisted OVER the
    // existing rebase-rewrites.json — the merge-and-close branch.
    await persistRewriteMap(projectRoot, {
      [MID_FULL]: NEW_FULL,
      [MID_SHORT]: NEW_FULL,
    });

    const persisted = JSON.parse(await readFile(rewritesPath, 'utf-8')) as Record<
      string,
      string
    >;

    // The stale chain is collapsed IN THE FILE: old (full and short) points
    // directly at new, not at the intermediate mid.
    expect(persisted[OLD_FULL]).toBe(NEW_FULL);
    expect(persisted[OLD_SHORT]).toBe(NEW_FULL);
    // The new hop itself is present too.
    expect(persisted[MID_FULL]).toBe(NEW_FULL);
    expect(persisted[MID_SHORT]).toBe(NEW_FULL);
    // No value anywhere still dangles at the rewritten intermediate sha.
    expect(Object.values(persisted)).not.toContain(MID_FULL);

    // And a read-time consumer resolving through the loaded file lands on
    // `new` for the original pre-first-rebase sha.
    expect(resolveThroughMap(OLD_FULL, persisted)).toBe(NEW_FULL);
    expect(resolveThroughMap(OLD_SHORT, persisted)).toBe(NEW_FULL);
  });
});
