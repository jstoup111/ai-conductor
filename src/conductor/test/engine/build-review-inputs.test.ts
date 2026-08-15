import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  assembleBuildReviewInputs as assembleInputs,
  MACHINERY_AUTHORED_PATHS,
  MergeBaseError,
  TestSuiteProofError,
} from '../../src/engine/build-review-inputs.js';
import type { BuildReviewFrozenInputs, BuildReviewInputOptions } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import { makeGitRunner, type GitRunner, type GitResult } from '../../src/engine/rebase.js';
import { recordTestSuiteRemediation } from '../../src/engine/test-suite-remediation.js';
import { setupStaleTrackingRefFixture } from '../fixtures/git-repo.js';
import type { FullSuiteInspectionResult } from '../../src/engine/full-suite-verifier.js';

const CURRENT_PROOF = {
  status: 'CURRENT',
  evidence: { provenanceHeadSha: 'head123', outcome: 'PASS' },
} as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>;

function assembleBuildReviewInputs(
  git: GitRunner,
  planPath: string,
  options: BuildReviewInputOptions = {},
): Promise<BuildReviewFrozenInputs> {
  return assembleInputs(git, planPath, {
    inspectTestSuite: async () => CURRENT_PROOF,
    ...options,
  });
}

// A scripted GitRunner: matches argv prefixes to canned results (same pattern
// as test/engine/rebase.test.ts's fakeGit).
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

const execFileAsync = promisify(execFile);

describe('engine/build-review-inputs — assembleBuildReviewInputs', () => {
  describe('unit (scripted GitRunner)', () => {
    let planPath: string;
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-inputs-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nSome plan content.\n', 'utf-8');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    // resolveFreshBase's happy-path probe sequence: remote → symbolic-ref →
    // rev-parse tracking ref → ls-remote (fresh when shas match).
    const freshProbeScript = [
      { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
      { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' } },
      { match: ['rev-parse', 'refs/remotes/origin/main'], result: { exitCode: 0, stdout: 'abc1234\n' } },
      { match: ['ls-remote', 'origin', 'main'], result: { exitCode: 0, stdout: 'abc1234\trefs/heads/main\n' } },
    ];

    it('freezes one source snapshot and admits only an injected CURRENT test-suite proof', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: 'diff --git a/a b/a\n+change\n' } },
      ]);
      const inspectTestSuite = vi.fn(async () => CURRENT_PROOF);

      const inputs = await assembleBuildReviewInputs(git, planPath, { inspectTestSuite });

      expect(inspectTestSuite).toHaveBeenCalledOnce();
      expect(inputs.testSuiteProof).toBe(CURRENT_PROOF.evidence);
      expect(inputs.sourceSnapshot).toMatchObject({
        mergeBase: 'base123', headSha: 'head123', diff: inputs.diff, planBody: inputs.planBody,
        operatorReseals: inputs.operatorReseals,
      });
      expect(inputs.sourceSnapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(JSON.stringify(inputs)).not.toMatch(/makerNarrative/i);
      expect(inputs).not.toHaveProperty('acceptedDispositions');
    });

    it('derives content identity from review content rather than git provenance or operator reseals', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/identity.md');

      async function contentDigestFor({
        baseRef = 'feature/first',
        mergeBase = 'base-first',
        headSha = 'head-first',
        diff = 'diff --git a/a b/a\n+change\n',
        planBody = '# Plan body\n\nSome plan content.\n',
        resealReason = 'Operator approved the amendment.',
      } = {}): Promise<string> {
        await mkdir(join(dir, '.docs/plans'), { recursive: true });
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(scopedPlanPath, planBody, 'utf-8');
        await writeFile(join(dir, '.pipeline/protected-artifact-seal.json'), JSON.stringify({
          version: 2,
          baselineCommit: 'baseline',
          protectedArtifacts: [],
          rebaselines: [{
            trigger: 'operator-reseal', fromCommit: 'before', toCommit: 'after',
            paths: ['.docs/stories/fixture.md'], reason: resealReason,
          }],
        }));
        const { git } = fakeGit([
          { match: ['remote'], result: { exitCode: 0, stdout: '' } },
          { match: ['symbolic-ref', '--short', 'HEAD'], result: { stdout: `${baseRef}\n` } },
          { match: ['merge-base', baseRef, 'HEAD'], result: { stdout: `${mergeBase}\n` } },
          { match: ['diff', `${mergeBase}..HEAD`], result: { stdout: diff } },
        ]);

        return (await assembleBuildReviewInputs(git, scopedPlanPath, {
          inspectTestSuite: async () => ({
            status: 'CURRENT', evidence: { ...CURRENT_PROOF.evidence, provenanceHeadSha: headSha },
          }),
        })).sourceSnapshot.contentDigest;
      }

      const baseline = await contentDigestFor();
      const changedProvenance = await contentDigestFor({
          baseRef: 'feature/rebased', mergeBase: 'base-rebased', headSha: 'head-rebased',
      });
      const oneByteDiff = await contentDigestFor({ diff: 'diff --git a/a b/a\n+changed\n' });
      const changedPlan = await contentDigestFor({ planBody: '# Plan body\n\nChanged plan content.\n' });
      const changedReseal = await contentDigestFor({ resealReason: 'Operator approved the corrected amendment.' });

      expect({
        hasSha256Digest: /^sha256:[a-f0-9]{64}$/.test(baseline),
        provenanceIsExcluded: changedProvenance === baseline,
        diffIsIncluded: oneByteDiff !== baseline,
        planIsIncluded: changedPlan !== baseline,
        resealIsExcluded: changedReseal === baseline,
      }).toEqual({
        hasSha256Digest: true,
        provenanceIsExcluded: true,
        diffIsIncluded: true,
        planIsIncluded: true,
        resealIsExcluded: true,
      });
    });

    it.each([
      { status: 'FAILED', reason: 'nonzero_exit', message: 'suite failed' },
      { status: 'STALE', reason: 'source_changed' },
    ] as const)('refuses a non-current test-suite proof before reading git ($status)', async (inspection) => {
      const { git, calls } = fakeGit([]);

      await expect(assembleBuildReviewInputs(git, planPath, {
        inspectTestSuite: async () => inspection,
      })).rejects.toBeInstanceOf(TestSuiteProofError);
      expect(calls).toEqual([]);
    });

    it('merge-base failure raises a typed MergeBaseError', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 1, stderr: 'fatal: no merge base' } },
      ]);

      await expect(assembleBuildReviewInputs(git, planPath)).rejects.toBeInstanceOf(
        MergeBaseError,
      );
    });

    it('empty diff signals no-diff (empty diff string returned)', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { exitCode: 0, stdout: '' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.diff).toBe('');
      expect(result.planBody).toContain('Plan body');
    });

    it('fresh base: returns base evidence with fresh=true and no fetch performed', async () => {
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/x b/x\n' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.baseRef).toBe('origin/main');
      expect(result.baseKind).toBe('remote');
      expect(result.fresh).toBe(true);
      expect(result.trackingRefSha).toBe('abc1234');
      expect(result.remoteHeadSha).toBe('abc1234');
      expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
    });

    // Machinery-authored paths are engine output, not agent work. Grading them
    // against the plan produces scope FAILs no plan can ever satisfy (observed
    // on build-review-ci-watch-partial-block-1002, whose engine-stamped
    // `.docs/shipped/<slug>.md` was cited as unplanned work).
    it('excludes machinery-authored paths from the graded diff', async () => {
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/x b/x\n' } },
      ]);

      await assembleBuildReviewInputs(git, planPath);

      const diffCall = calls.find((c) => c[0] === 'diff');
      expect(diffCall).toBeDefined();
      expect(diffCall).toEqual([
        'diff',
        'abc1234..HEAD',
        '--',
        '.',
        ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
      ]);
    });

    it('names exactly the engine-authored surfaces as machinery paths', () => {
      expect([...MACHINERY_AUTHORED_PATHS].sort()).toEqual([
        '.docs/shipped/',
        '.pipeline/',
      ]);
    });

    it('derives removal context from the exact assembled diff', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { stdout: 'diff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644\n' } },
      ]);
      await expect(assembleBuildReviewInputs(git, planPath)).resolves.toMatchObject({
        removalContext: { deletedFiles: ['src/old.ts'], removedDeclarations: [], removedMembers: [] },
      });
    });

    it('returns an explicitly empty removal context for an additive diff', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { stdout: 'diff --git a/src/new.ts b/src/new.ts\n+export const added = true;\n' } },
      ]);
      await expect(assembleBuildReviewInputs(git, planPath)).resolves.toMatchObject({
        removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
      });
    });

    it('stale base: fetches, recomputes merge-base against the refreshed ref, fresh=false', async () => {
      const { git } = fakeGit([
        { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
        { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' } },
        { match: ['rev-parse', 'refs/remotes/origin/main'], result: { exitCode: 0, stdout: 'stale111\n' } },
        { match: ['ls-remote', 'origin', 'main'], result: { exitCode: 0, stdout: 'fresh222\trefs/heads/main\n' } },
        // resolveBaseCore's fetch path (stale → refetch):
        { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { exitCode: 0, stdout: 'newbase\n' } },
        { match: ['diff', 'newbase..HEAD'], result: { exitCode: 0, stdout: 'diff --git a/y b/y\n' } },
      ]);

      const result = await assembleBuildReviewInputs(git, planPath);
      expect(result.baseRef).toBe('origin/main');
      expect(result.baseKind).toBe('remote');
      expect(result.fresh).toBe(false);
      expect(result.trackingRefSha).toBe('stale111');
      expect(result.remoteHeadSha).toBe('fresh222');
      expect(result.diff).toContain('diff --git a/y b/y');
    });

    it('no-remote fallback: keeps local behavior, emits one advisory console.warn', async () => {
      const { git } = fakeGit([
        { match: ['remote'], result: { exitCode: 0, stdout: '' } },
        { match: ['symbolic-ref', '--short', 'HEAD'], result: { exitCode: 0, stdout: 'feature/foo\n' } },
        { match: ['merge-base', 'feature/foo', 'HEAD'], result: { exitCode: 0, stdout: 'localbase\n' } },
        { match: ['diff', 'localbase..HEAD'], result: { exitCode: 0, stdout: '' } },
      ]);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = await assembleBuildReviewInputs(git, planPath);
        expect(result.baseRef).toBe('feature/foo');
        expect(result.baseKind).toBe('local');
        expect(result.fresh).toBe(false);
        expect(result.trackingRefSha).toBeNull();
        expect(result.remoteHeadSha).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('build_review');
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('fixture repo (real git, merge-base correctness)', () => {
    let dir: string;
    let planPath: string;

    async function git(...args: string[]): Promise<string> {
      const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
      return stdout.trim();
    }

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-fixture-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nFixture plan.\n', 'utf-8');

      await execFileAsync('git', ['init', '-b', 'main', dir]);
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');

      // Simulate an origin whose default branch is 'main'. Register a real
      // `origin` remote pointed at this same repo (local-path "clone") so
      // `resolveFreshBase`'s `git remote` / `ls-remote origin` probe has a
      // real remote to talk to, then set refs/remotes/origin/HEAD to point
      // at refs/heads/main so default-branch discovery resolves it.
      await writeFile(join(dir, 'base.txt'), 'base\n');
      await git('add', '.');
      await git('commit', '-m', 'initial commit on base');
      await git('remote', 'add', 'origin', dir);
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

      await git('checkout', '-b', 'feature/foo');
      await writeFile(join(dir, 'feature.txt'), 'feature change\n');
      await git('add', '.');
      await git('commit', '-m', 'add feature change');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    function realGit(): GitRunner {
      return async (args: string[]) => {
        try {
          const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
          return { exitCode: 0, stdout, stderr };
        } catch (err) {
          const e = err as { code?: number; stdout?: string; stderr?: string };
          return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
        }
      };
    }

    it('computes the merge-base against the discovered default branch and returns the diff since it', async () => {
      const result = await assembleBuildReviewInputs(realGit(), planPath);
      expect(result.diff).toContain('feature.txt');
      expect(result.diff).toContain('feature change');
      expect(result.planBody).toContain('Fixture plan.');
    });

    it('threads cumulative repair context into the isolated grader inputs', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/fixture.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(scopedPlanPath, '# Plan body\n\nFixture plan.\n');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/events.jsonl'),
        JSON.stringify({
          type: 'rebase_changed',
          ts: new Date(100).toISOString(),
          allChangedPaths: ['src/base.ts'],
        }) + '\n',
      );
      const repair = await recordTestSuiteRemediation(dir, 'test_suite', {
        reason: 'command_failed',
        message: 'src/base.ts changed the aggregate command expectation',
        observedAt: 101,
      });
      expect(repair).toBeDefined();

      const result = await assembleBuildReviewInputs(realGit(), scopedPlanPath);

      expect(result.repairContext).toEqual([repair]);
    });

    it('threads operator reseals only when the plan belongs to the feature root', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/fixture.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(scopedPlanPath, '# Plan body\n\nFixture plan.\n');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/protected-artifact-seal.json'), JSON.stringify({
        version: 2,
        baselineCommit: 'baseline',
        protectedArtifacts: [],
        rebaselines: [{
          trigger: 'operator-reseal',
          fromCommit: 'before',
          toCommit: 'after',
          paths: ['.docs/stories/fixture.md'],
          reason: 'Operator approved the amendment.',
        }, {
          trigger: 'proactive-rebase', fromCommit: 'after', toCommit: 'rotation', paths: ['.docs/stories/fixture.md'],
        }, {
          trigger: 'future-machinery-trigger', fromCommit: 'rotation', toCommit: 'future', paths: ['.docs/stories/fixture.md'],
        }],
      }));

      const [featureInputs, looseInputs] = await Promise.all([
        assembleBuildReviewInputs(realGit(), scopedPlanPath),
        assembleBuildReviewInputs(realGit(), planPath),
      ]);

      expect({
        feature: featureInputs.operatorReseals,
        loose: looseInputs.operatorReseals,
      }).toEqual({
        feature: [{
          fromCommit: 'before',
          toCommit: 'after',
          paths: ['.docs/stories/fixture.md'],
          reason: 'Operator approved the amendment.',
        }],
        loose: [],
      });
      expect(featureInputs.sourceSnapshot.operatorReseals).toEqual(featureInputs.operatorReseals);

      await writeFile(join(dir, '.pipeline/protected-artifact-seal.json'), '{ unusable');
      expect((await assembleBuildReviewInputs(realGit(), scopedPlanPath)).sourceSnapshot.operatorReseals).toEqual([]);
    });

    it('keeps shared rubric snapshot identity stable while a real operator reseal invalidates Scope only', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/fixture.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(scopedPlanPath, '# Plan body\n\nFixture plan.\n');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const writeSeal = (reason: string) => writeFile(
        join(dir, '.pipeline/protected-artifact-seal.json'),
        JSON.stringify({
          version: 2,
          baselineCommit: 'baseline',
          protectedArtifacts: [],
          rebaselines: [{
            trigger: 'operator-reseal', fromCommit: 'before', toCommit: 'after',
            paths: ['.docs/stories/fixture.md'], reason,
          }],
        }),
      );
      const project = (inputs: BuildReviewFrozenInputs) => deriveBuildReviewRubricProjections({
        lapId: parseBuildReviewLapId('lap-input-assembly')!,
        inputs,
        tautology: {
          changedTestSelectors: [], revertedProductionManifest: [], preflightEvidence: { classification: 'not-requested' },
        },
      });

      await writeSeal('Operator approved the amendment.');
      const firstInputs = await assembleBuildReviewInputs(realGit(), scopedPlanPath);
      const first = project(firstInputs);
      await writeSeal('Operator approved the corrected amendment rationale.');
      const secondInputs = await assembleBuildReviewInputs(realGit(), scopedPlanPath);
      const second = project(secondInputs);

      expect(secondInputs.sourceSnapshot.digest).toBe(firstInputs.sourceSnapshot.digest);
      expect(second.scope.digest).not.toBe(first.scope.digest);
      expect(second.tautology).toEqual(first.tautology);
      expect(second.rootCause).toEqual(first.rootCause);
      expect(second.completeness).toEqual(first.completeness);
    });

    it('renders a #1502 sealed-artifact amendment only when its operator reseal is persisted', async () => {
      const amendedPath = '.docs/stories/resealed-story.md';
      const pairedPlanPath = join(dir, '.docs/plans/feature.md');
      const rationale = 'Operator approved the corrected acceptance boundary verbatim.';
      const evidenceSection = (prompt: string) => prompt.match(
        /## Operator-authorized protected-artifact reseals\n\n[\s\S]*?(?=\n\n## Engine-derived removal evidence)/,
      )?.[0] ?? '';
      const withoutEvidenceSection = (prompt: string) => prompt.replace(
        evidenceSection(prompt),
        '<operator-reseal-evidence>',
      );

      await git('checkout', 'main');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await writeFile(pairedPlanPath, '# Approved plan\n\nAmend the sealed story.\n');
      await writeFile(join(dir, amendedPath), 'approved story\n');
      await git('add', '.');
      await git('commit', '-m', 'decide: approve protected artifacts');
      const baseline = await git('rev-parse', 'HEAD');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      await git('checkout', '-b', 'operator-reseal-evidence');
      await writeFile(join(dir, amendedPath), 'operator-approved amended story\n');
      await git('add', amendedPath);
      await git('commit', '-m', 'docs: amend sealed story');
      const head = await git('rev-parse', 'HEAD');

      await mkdir(join(dir, '.pipeline'), { recursive: true });
      const writeSeal = (rebaselines: unknown[]) => writeFile(
        join(dir, '.pipeline/protected-artifact-seal.json'),
        JSON.stringify({
          version: 2,
          baselineCommit: head,
          protectedArtifacts: [],
          rebaselines,
        }),
      );
      await writeSeal([{
        trigger: 'operator-reseal',
        paths: [amendedPath],
        reason: rationale,
        fromCommit: baseline,
        toCommit: head,
      }]);
      const withResealPrompt = buildGraderPrompt(
        await assembleBuildReviewInputs(realGit(), pairedPlanPath),
      );

      await writeSeal([]);
      const withoutResealPrompt = buildGraderPrompt(
        await assembleBuildReviewInputs(realGit(), pairedPlanPath),
      );

      expect({
        populatedEvidence: [amendedPath, rationale].every((value) =>
          evidenceSection(withResealPrompt).includes(value)),
        emptyEvidence: evidenceSection(withoutResealPrompt).endsWith('(none)'),
        otherwiseIdentical:
          withoutEvidenceSection(withResealPrompt) === withoutEvidenceSection(withoutResealPrompt),
      }).toEqual({
        populatedEvidence: true,
        emptyEvidence: true,
        otherwiseIdentical: true,
      });
    });

    it('classifies a closed provenance disposition for available, unwarranted, and unmatched repair context', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/fixture.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(scopedPlanPath, '# Plan body\n\nFixture plan.\n');

      const advanceLedger = () =>
        writeFile(
          join(dir, '.pipeline/events.jsonl'),
          JSON.stringify({
            type: 'rebase_changed',
            ts: new Date(100).toISOString(),
            allChangedPaths: ['src/base.ts'],
          }) + '\n',
        );

      const cases = [
        {
          name: 'context available',
          prepare: async () => {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await advanceLedger();
            await recordTestSuiteRemediation(dir, 'test_suite', {
              reason: 'command_failed',
              message: 'src/base.ts changed the aggregate command expectation',
              observedAt: 101,
            });
          },
          expected: { disposition: 'context_available', repairCount: 1 },
        },
        {
          name: 'none warranted',
          prepare: async () => {},
          expected: { disposition: 'none_warranted' },
        },
        {
          name: 'no join',
          prepare: async () => {
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await advanceLedger();
          },
          expected: { disposition: 'no_join' },
        },
      ] as const;

      for (const scenario of cases) {
        await rm(join(dir, '.pipeline'), { recursive: true, force: true });
        await scenario.prepare();

        const inputs = await assembleBuildReviewInputs(realGit(), scopedPlanPath);

        expect(inputs.repairProvenance, scenario.name).toEqual(scenario.expected);
      }
    });

    it('leaves a plan outside a feature root unattributed rather than guessing a disposition', async () => {
      const looseePlanPath = join(dir, 'plan.md');
      await writeFile(looseePlanPath, '# Plan body\n\nFixture plan.\n');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/events.jsonl'),
        JSON.stringify({
          type: 'rebase_changed',
          ts: new Date(100).toISOString(),
          allChangedPaths: ['src/base.ts'],
        }) + '\n',
      );

      const inputs = await assembleBuildReviewInputs(realGit(), looseePlanPath);

      expect(inputs.repairContext).toEqual([]);
      expect(inputs.repairProvenance).toEqual({ disposition: 'none_warranted' });
    });
  });

  // Regression fixture for the stale-tracking-ref incident (#870/#872): a
  // bare "remote" advances past the clone's local `origin/main` tracking
  // ref (merged-PR content lands after the clone last synced), the clone's
  // `feat` branch is rebased onto the TRUE remote head (a healthy rebase),
  // and then the clone's tracking ref is rolled back to simulate a worktree
  // that never re-fetched. Pre-Task-3, `assembleBuildReviewInputs` computed
  // its merge-base against the stale local `origin/main`, which would
  // wrongly bundle the merged-PR-only content into the graded diff. Post-
  // Task-3 (`resolveFreshBase`), the base resolution detects the mismatch,
  // fetches, and grades only the branch's own commits.
  describe('real two-repo fixture (setupStaleTrackingRefFixture)', () => {
    let dir: string;
    let planPath: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'build-review-stale-ref-'));
      planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Plan body\n\nStale-ref regression fixture.\n', 'utf-8');
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('grades only the feat branch commits, not merged-PR-only content that arrived after the tracking ref went stale', async () => {
      const fixture = await setupStaleTrackingRefFixture(dir);
      const git = makeGitRunner(fixture.repo);

      const result = await assembleBuildReviewInputs(git, planPath);

      expect(result.diff).not.toContain(fixture.mergedOnlyPath);
      expect(result.diff).toContain('feat.txt');
      expect(result.diff).toContain('feature work');

      // A stale-ref mismatch was detected and resolved: the tracking ref at
      // resolution time differed from the true remote head, so the base
      // ended up fresh (post-fetch) rather than silently graded stale.
      expect(result.trackingRefSha).toBe(fixture.staleTrackingSha);
      expect(result.remoteHeadSha).toBe(fixture.freshRemoteSha);
      expect(result.trackingRefSha).not.toBe(result.remoteHeadSha);
      expect(result.baseKind).toBe('remote');
      // `fresh` means "tracking ref already matched the remote head, no
      // fetch needed" — here the mismatch was detected and a fetch was
      // required, so `fresh` is correctly `false` per the documented
      // semantics on `BuildReviewInputs.fresh`.
      expect(result.fresh).toBe(false);
    });
  });
});
