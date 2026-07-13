/**
 * RED acceptance specs for jstoup111/ai-conductor#535
 * (rebase-orphans-every-sha-anchored-evidence-citatio).
 *
 * Stories: `.docs/stories/rebase-orphans-every-sha-anchored-evidence-citatio.md`
 * Plan:    `.docs/plans/rebase-orphans-every-sha-anchored-evidence-citatio.md`
 *
 * Nothing under this feature exists yet — `rebase-translate.ts` is not
 * written, and `performRebase` does not call it. Per this project's
 * writing-system-tests convention for a headless engine, these specs drive
 * the REAL production call sites — `runRebaseStep` (via a real
 * `Conductor.run({ fromStep: 'rebase' })`, mirroring
 * `test/engine/merged-pr-guard-rebase.test.ts`) and `resumeRebaseFirst`
 * (mirroring `test/engine/daemon-rekick.test.ts`) — never the new
 * `translateAfterRebase`/`buildRewriteMap`/`resolveThroughMap` primitives
 * directly. That guards against an orphaned primitive: a new module that is
 * unit-tested but never wired into `performRebase`.
 *
 * Real scratch git repos (not a fake GitRunner) are required because
 * patch-id correspondence is a real git plumbing operation
 * (`git patch-id --stable`) that only a real rebase can exercise.
 *
 * Every assertion below is expected to FAIL today: `.pipeline/rebase-rewrites.json`
 * and `.pipeline/rebase-residue.json` are never written, the sidecar/status
 * stores are never rewritten, and `validateCitations` has no map to resolve
 * through — so a citation to a rewritten commit still fails ancestry. That is
 * the correct RED signal (missing artifacts / unmet assertions), not a
 * module-resolution error, because this spec deliberately only imports real,
 * already-shipped entry points.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { resumeRebaseFirst, REKICK_SENTINEL } from '../../src/engine/daemon-rekick.js';
import { validateCitations } from '../../src/engine/attribution-validate.js';

const execFile = promisify(execFileCb);

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

async function readJson(p: string): Promise<any> {
  return JSON.parse(await readFile(p, 'utf-8'));
}

/** Seeds `.pipeline/conduct-state.json` with every step before `rebase` marked done. */
async function seedPreRebaseState(statePath: string): Promise<void> {
  const state: ConductState = {};
  for (const s of ALL_STEPS) {
    if (s.name === 'rebase') break;
    (state as Record<string, unknown>)[s.name] = s.name === 'retro' ? 'skipped' : 'done';
  }
  await writeState(statePath, state);
}

/** Drives the finish-time site: a real `Conductor.run({ fromStep: 'rebase' })`. */
async function runFinishTimeRebase(repo: string): Promise<void> {
  const statePath = join(repo, 'conduct-state.json');
  await seedPreRebaseState(statePath);
  const events = new ConductorEventEmitter();
  const runner: StepRunner = {
    run: async () => ({ success: true }) satisfies StepRunResult,
  };
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    projectRoot: repo,
    daemon: true,
    mode: 'auto',
    fromStep: 'rebase',
  } as never);
  await conductor.run();
  console.error('[DEBUG after run]', await readFile(join(repo, '.pipeline/rebase-rewrites.json'), 'utf-8').catch((e) => `ERR:${e}`));
}

interface Scratch {
  repo: string;
  g: (args: string[]) => ReturnType<typeof execFile>;
}

/**
 * Builds a scratch repo whose `feat` branch has:
 *  - C1 (a.ts) — cited (short-form) by a task-status row.
 *  - C2 (work.ts) — cited (full-form + sidecar) by task T1, and the target of
 *    an `Evidence: satisfied-by` empty commit.
 * `main` then advances with an unrelated file so the eventual rebase is real
 * and file-changing, not a no-op.
 */
async function buildTranslationRepo(): Promise<
  Scratch & { c1Sha: string; c2Sha: string }
> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-xlate-'));
  const g = (args: string[]) => execFile('git', args, { cwd: repo });

  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await g(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'base.ts'), 'base\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'init']);

  await g(['checkout', '-q', '-b', 'feat']);
  await writeFile(join(repo, 'a.ts'), 'a1\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feat: a1']);
  const c1Sha = (await g(['rev-parse', 'HEAD'])).stdout.trim();

  await writeFile(join(repo, 'work.ts'), 'work1\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feat: work']);
  const c2Sha = (await g(['rev-parse', 'HEAD'])).stdout.trim();

  await g([
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    `feat: satisfied-by note\n\nTask: T1\nEvidence: satisfied-by ${c2Sha}`,
  ]);

  await g(['checkout', '-q', 'main']);
  await writeFile(join(repo, 'unrelated.ts'), 'main1\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'main: unrelated advance']);
  await g(['checkout', '-q', 'feat']);

  return { repo, g, c1Sha, c2Sha };
}

/** Seeds the three sha-anchored stores per Stories 2-4. */
async function seedStores(repo: string, c1Sha: string, c2Sha: string): Promise<void> {
  console.error('[DEBUG seedStores]', { c1Sha, c2Sha });
  await mkdir(join(repo, '.pipeline'), { recursive: true });

  const evidence = {
    evidenceStamps: {
      T1: { sha: c2Sha, form: 'commit', citedShas: [c1Sha, c2Sha], verdictAnchor: c2Sha },
    },
    noEvidenceAttempts: 0,
    noEvidenceReasons: [],
    migrationGrandfather: [],
  };
  await writeFile(
    join(repo, '.pipeline/task-evidence.json'),
    JSON.stringify(evidence, null, 2),
  );

  const status = {
    plan_ref: 'plan.md',
    tasks: [
      // Full 40-char form (task-seed.ts:213).
      { id: 'T1', status: 'completed', commit: c2Sha },
      // Short 7-char form (autoheal.ts:202).
      { id: 'T2', status: 'completed', commit: c1Sha.slice(0, 7) },
    ],
  };
  await writeFile(
    join(repo, '.pipeline/task-status.json'),
    JSON.stringify(status, null, 2),
  );

  // #520 judged-stamp memo: keyed `${headSha}:${residueIds}` per
  // attribution-lane.ts computeMemoKey; seeded pre-rebase so a translation
  // that re-keys onto the new HEAD is observable.
  const memo = { key: `${c2Sha}:T1`, result: JSON.stringify({ verdictAnchor: c2Sha }) };
  await writeFile(
    join(repo, '.pipeline/attribution-memo.json'),
    JSON.stringify(memo, null, 2),
  );
}

/** Resolves the post-rebase sha for a commit by its original subject line. */
async function shaForSubject(
  g: Scratch['g'],
  branch: string,
  subject: string,
): Promise<string> {
  const { stdout } = await g(['log', branch, '--format=%H %s']);
  const line = stdout.split('\n').find((l) => l.endsWith(subject));
  if (!line) throw new Error(`commit with subject "${subject}" not found on ${branch} after rebase`);
  return line.split(' ')[0];
}

describe('rebase-translate acceptance (#535) — real call sites, real scratch git repos', () => {
  let repo: string | undefined;

  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
    repo = undefined;
  });

  it(
    'Stories 1-3: finish-time site (runRebaseStep via Conductor.run) persists rebase-rewrites.json and repoints the sidecar + task-status (full and short forms)',
    async () => {
      const scratch = await buildTranslationRepo();
      repo = scratch.repo;
      const { g, c1Sha, c2Sha } = scratch;
      await seedStores(repo, c1Sha, c2Sha);

      await runFinishTimeRebase(repo);

      const newC1Sha = await shaForSubject(g, 'feat', 'feat: a1');
      const newC2Sha = await shaForSubject(g, 'feat', 'feat: work');
      expect(newC1Sha).not.toBe(c1Sha); // sanity: the rebase actually rewrote commits
      expect(newC2Sha).not.toBe(c2Sha);

      // Story 1: transitive rewrite map persisted, both full and short forms indexed.
      const rewritesPath = join(repo, '.pipeline/rebase-rewrites.json');
      expect(await fileExists(rewritesPath)).toBe(true);
      const rewrites = await readJson(rewritesPath);
      expect(rewrites[c2Sha]).toBe(newC2Sha);
      expect(rewrites[c1Sha.slice(0, 7)]).toBe(newC1Sha);

      // Story 2: sidecar's sha/citedShas/verdictAnchor repointed.
      const evAfter = await readJson(join(repo, '.pipeline/task-evidence.json'));
      expect(evAfter.evidenceStamps.T1.sha).toBe(newC2Sha);
      expect(evAfter.evidenceStamps.T1.citedShas).toEqual([newC1Sha, newC2Sha]);
      expect(evAfter.evidenceStamps.T1.verdictAnchor).toBe(newC2Sha);

      // Story 3: task-status full-form AND short-form commit fields repointed.
      const statusAfter = await readJson(join(repo, '.pipeline/task-status.json'));
      const t1 = statusAfter.tasks.find((t: { id: string }) => t.id === 'T1');
      const t2 = statusAfter.tasks.find((t: { id: string }) => t.id === 'T2');
      expect(t1.commit).toBe(newC2Sha);
      expect(t2.commit).toBe(newC1Sha.slice(0, 7));
    },
    20000,
  );

  it(
    'Story 6: rekick site (resumeRebaseFirst) produces IDENTICAL post-rebase translation to the finish-time site',
    async () => {
      const scratch = await buildTranslationRepo();
      repo = scratch.repo;
      const { g, c1Sha, c2Sha } = scratch;
      await seedStores(repo, c1Sha, c2Sha);
      await mkdir(join(repo, '.pipeline'), { recursive: true });
      await writeFile(join(repo, REKICK_SENTINEL), 'rekick\n', 'utf-8');

      const events = new ConductorEventEmitter();
      const res = await resumeRebaseFirst({
        worktreePath: repo,
        localBase: 'main',
        events,
        ranManualTest: true,
      });
      expect(res).toBe('rebased');

      const newC1Sha = await shaForSubject(g, 'feat', 'feat: a1');
      const newC2Sha = await shaForSubject(g, 'feat', 'feat: work');

      const rewritesPath = join(repo, '.pipeline/rebase-rewrites.json');
      expect(await fileExists(rewritesPath)).toBe(true);
      const rewrites = await readJson(rewritesPath);
      expect(rewrites[c2Sha]).toBe(newC2Sha);
      expect(rewrites[c1Sha.slice(0, 7)]).toBe(newC1Sha);

      const evAfter = await readJson(join(repo, '.pipeline/task-evidence.json'));
      expect(evAfter.evidenceStamps.T1.sha).toBe(newC2Sha);

      const statusAfter = await readJson(join(repo, '.pipeline/task-status.json'));
      const t2 = statusAfter.tasks.find((t: { id: string }) => t.id === 'T2');
      expect(t2.commit).toBe(newC1Sha.slice(0, 7));
    },
    20000,
  );

  it(
    'Story 5: a satisfied-by citation to a rewritten commit resolves against the new HEAD (validateCitations, real read-time consumer)',
    async () => {
      const scratch = await buildTranslationRepo();
      repo = scratch.repo;
      const { c1Sha, c2Sha } = scratch;
      await seedStores(repo, c1Sha, c2Sha);

      await runFinishTimeRebase(repo);

      const git = makeGitRunner(repo);
      const newHead = (await git(['rev-parse', 'feat'])).stdout.trim();

      // Today the OLD sha is dangling/off-branch after the rebase, so
      // validateCitations' ancestry check refuses it — this is the RED
      // signal. Once translation is wired the citation resolves through
      // .pipeline/rebase-rewrites.json before the ancestry check and this
      // flips to valid.
      const result = await validateCitations(
        git,
        { taskId: 'T1', paths: new Set() },
        { taskId: 'T1', verdict: 'satisfied', citations: [{ sha: c2Sha, rationale: 'work' }] },
        newHead,
      );
      expect(result.valid).toBe(true);
      expect(result.reasons).toEqual([]);
    },
    20000,
  );

  it(
    'Story 8: a never-on-branch (forged) citation is still refused after translation runs (no laundering)',
    async () => {
      const scratch = await buildTranslationRepo();
      repo = scratch.repo;
      const { c1Sha, c2Sha } = scratch;
      await seedStores(repo, c1Sha, c2Sha);

      // A commit from a totally unrelated repo history — never a pre-image
      // commit of THIS branch; stale/forged per Story 8.
      const forgedRepo = await mkdtemp(join(tmpdir(), 'rebase-xlate-forged-'));
      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: forgedRepo });
      await execFile('git', ['config', 'user.email', 't@t.com'], { cwd: forgedRepo });
      await execFile('git', ['config', 'user.name', 'T'], { cwd: forgedRepo });
      await writeFile(join(forgedRepo, 'x.ts'), 'x\n');
      await execFile('git', ['add', '.'], { cwd: forgedRepo });
      await execFile('git', ['commit', '-q', '-m', 'unrelated history'], { cwd: forgedRepo });
      const forgedSha = (
        await execFile('git', ['rev-parse', 'HEAD'], { cwd: forgedRepo })
      ).stdout.trim();
      await rm(forgedRepo, { recursive: true, force: true });

      await runFinishTimeRebase(repo);

      const git = makeGitRunner(repo);
      const newHead = (await git(['rev-parse', 'feat'])).stdout.trim();

      // The legitimate citation must resolve — this is the failing half
      // today (no translation wired yet), and is what makes this spec RED
      // even though the forged-refusal half below already holds unimplemented.
      const legit = await validateCitations(
        git,
        { taskId: 'T1', paths: new Set() },
        { taskId: 'T1', verdict: 'satisfied', citations: [{ sha: c2Sha, rationale: 'work' }] },
        newHead,
      );
      expect(legit.valid).toBe(true);

      // No-laundering: a citation sha that was never a pre-image commit on
      // this branch must remain refused post-translation.
      const forged = await validateCitations(
        git,
        { taskId: 'T9', paths: new Set() },
        { taskId: 'T9', verdict: 'satisfied', citations: [{ sha: forgedSha, rationale: 'forged' }] },
        newHead,
      );
      expect(forged.valid).toBe(false);

      const rewritesPath = join(repo, '.pipeline/rebase-rewrites.json');
      const rewrites = await readJson(rewritesPath).catch(() => ({}));
      expect(Object.keys(rewrites)).not.toContain(forgedSha);
    },
    20000,
  );

  it(
    'Story 7: a pre-image commit dropped by git during rebase (patch already upstream) lands in rebase-residue.json',
    async () => {
      const repoDir = await mkdtemp(join(tmpdir(), 'rebase-xlate-residue-'));
      repo = repoDir;
      const g = (args: string[]) => execFile('git', args, { cwd: repo });

      await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      await g(['config', 'user.email', 't@t.com']);
      await g(['config', 'user.name', 'T']);
      await g(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(repo, 'base.ts'), 'base\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'init']);

      await g(['checkout', '-q', '-b', 'feat']);
      await writeFile(join(repo, 'dup.ts'), 'dup1\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'feat: dup change']);
      const droppedSha = (await g(['rev-parse', 'HEAD'])).stdout.trim();

      // A second, unrelated feature commit so the rebase outcome is a real
      // `changed` (code paths moved), not merely one dropped commit.
      await writeFile(join(repo, 'keep.ts'), 'keep1\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'feat: keep change']);

      // main applies an IDENTICAL change to dup.ts — the feature's dup.ts
      // commit becomes empty relative to the new base; git auto-drops
      // equivalent-upstream commits on a plain (non -i) rebase.
      await g(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'dup.ts'), 'dup1\n');
      await g(['add', '.']);
      await g(['commit', '-q', '-m', 'main: same dup change']);
      await g(['checkout', '-q', 'feat']);

      await mkdir(join(repo, '.pipeline'), { recursive: true });
      const evidence = {
        evidenceStamps: {
          T3: { sha: droppedSha, form: 'commit', citedShas: [droppedSha] },
        },
        noEvidenceAttempts: 0,
        noEvidenceReasons: [],
        migrationGrandfather: [],
      };
      await writeFile(
        join(repo, '.pipeline/task-evidence.json'),
        JSON.stringify(evidence, null, 2),
      );

      await runFinishTimeRebase(repo);

      // Sanity: the dup.ts commit really was dropped by git (equivalent
      // upstream) — a genuine patch-id-unmatched pre-image, not a test bug.
      const log = (await g(['log', '--format=%s', 'feat'])).stdout;
      expect(log).not.toContain('feat: dup change');

      const residuePath = join(repo, '.pipeline/rebase-residue.json');
      expect(await fileExists(residuePath)).toBe(true);
      const residue = await readJson(residuePath);
      expect(JSON.stringify(residue)).toContain(droppedSha);
      expect(JSON.stringify(residue)).toContain('T3');
    },
    20000,
  );
});
