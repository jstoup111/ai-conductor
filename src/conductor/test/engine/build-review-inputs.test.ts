// Covers: task:3, task:8
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import {
  assembleBuildReviewInputs as assembleInputs,
  MACHINERY_AUTHORED_PATHS,
  MergeBaseError,
  TestSuiteProofError,
} from '../../src/engine/build-review-inputs.js';
import type { BuildReviewFrozenInputs, BuildReviewInputOptions } from '../../src/engine/build-review-inputs.js';
import { buildReviewFindingReferenceContext, parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import type { BuildReviewRubricProjection } from '../../src/engine/build-review-projections.js';
import { makeGitRunner, type GitRunner, type GitResult } from '../../src/engine/rebase.js';
import { BuildReviewSourceReadError } from '../../src/engine/build-review-scope-source.js';
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
      if (entry.match.every((tok, i) =>
        args[i] === tok
        || (tok === 'HEAD' && i > 0)
        || (tok.endsWith('..HEAD') && args[i]?.startsWith(tok.slice(0, -4)))
        || (tok.startsWith('HEAD:') && args[i]?.endsWith(tok.slice(4)))
      )) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    if (args[0] === 'show' && args[1]?.endsWith('.md')) {
      return { exitCode: 0, stdout: '# Plan body\n\nSome plan content.\n', stderr: '' };
    }
    if (args[0] === 'show') {
      // Incidental legacy fixtures still model a pinned Git blob; focused
      // missing-blob cases script a nonzero response explicitly.
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'diff' && args.includes('--name-status')) {
      const humanDiff = script.find((entry) => entry.match[0] === 'diff' && !entry.match.includes('--name-status'))?.result.stdout ?? '';
      const paths = [...humanDiff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => match[2]!);
      return { exitCode: 0, stdout: paths.flatMap((path) => ['M', path]).join('\0') + (paths.length ? '\0' : ''), stderr: '' };
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
      // The snapshot's headSha anchors what the grader looks at: live HEAD.
      // Kept equal to the injected proof's provenanceHeadSha ('head123') so
      // scenarios not about evidence reuse read unchanged.
      { match: ['rev-parse', 'HEAD'], result: { exitCode: 0, stdout: 'head123\n' } },
    ];

    it('stamps the snapshot headSha from live HEAD, not from reused test-suite evidence provenance', async () => {
      // Reused (drift-budget PRESERVED) evidence keeps provenanceHeadSha
      // pinned at the attested commit while build commits advance HEAD. The
      // lap identity derives from sourceSnapshot.headSha, and the completion
      // check compares it against live HEAD — so a snapshot stamped from
      // evidence provenance is stale by construction (halted features
      // the-cumulative-kickback-cap-never-resets-so-a-reco and
      // exported-step-cost-under-records-spend-20x-so-ever).
      const { git } = fakeGit([
        { match: ['remote'], result: { exitCode: 0, stdout: 'origin\n' } },
        { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 0, stdout: 'refs/remotes/origin/main\n' } },
        { match: ['rev-parse', 'refs/remotes/origin/main'], result: { exitCode: 0, stdout: 'abc1234\n' } },
        { match: ['ls-remote', 'origin', 'main'], result: { exitCode: 0, stdout: 'abc1234\trefs/heads/main\n' } },
        { match: ['rev-parse', 'HEAD'], result: { exitCode: 0, stdout: 'live456\n' } },
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/widget.test.ts b/test/widget.test.ts',
          '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
        ].join('\n') } },
        // Changed-test titles must be read from the graded tree (live HEAD),
        // not from the evidence's attested commit.
        { match: ['show', 'live456:test/widget.test.ts'], result: { stdout: "describe('widget', () => it('persists state', () => {}));" } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);

      expect(inputs.sourceSnapshot.headSha).toBe('live456');
      // The proof's own provenance stays what the evidence attests.
      expect(inputs.testSuiteProof.provenanceHeadSha).toBe('head123');
      expect(inputs.sourceSnapshot.changedTestTitles).toEqual([]);
    });

    it('fails input assembly when live HEAD cannot be resolved', async () => {
      const { git } = fakeGit([
        ...freshProbeScript.filter((entry) => !(entry.match[0] === 'rev-parse' && entry.match[1] === 'HEAD')),
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: 'diff --git a/a b/a\n+change\n' } },
        { match: ['rev-parse', 'HEAD'], result: { exitCode: 128, stderr: 'fatal: bad revision' } },
      ]);

      await expect(assembleBuildReviewInputs(git, planPath)).rejects.toThrow(MergeBaseError);
    });

    it('rejects a missing pinned plan blob instead of reading the live plan file', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: '' } },
        { match: ['show', 'head123:plan.md'], result: { exitCode: 128, stderr: 'pinned blob missing' } },
      ]);

      await expect(assembleBuildReviewInputs(git, planPath)).rejects.toMatchObject({
        name: 'BuildReviewSourceReadError', kind: 'required-read-failed', path: 'plan.md',
      } satisfies Partial<BuildReviewSourceReadError>);
    });

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
      });
      expect(inputs.sourceSnapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(JSON.stringify(inputs)).not.toMatch(/makerNarrative/i);
      expect(inputs).not.toHaveProperty('acceptedDispositions');
    });

    it('retains a declaration uncertainty rather than falling back to every title in a changed file', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/widget.test.ts b/test/widget.test.ts',
          '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
          'diff --git a/test/dynamic.test.ts b/test/dynamic.test.ts',
          '--- a/test/dynamic.test.ts', '+++ b/test/dynamic.test.ts', '+change',
        ].join('\n') } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: "describe('widget', () => it('persists state', () => {}));" } },
        { match: ['show', 'head123:test/dynamic.test.ts'], result: { stdout: 'it(titleFromFixture, () => {});' } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);

      expect(inputs.sourceSnapshot.changedTestTitles).toEqual([
        { selector: 'test/dynamic.test.ts', titleText: '', staticExtractionFallback: true },
      ]);
    });

    it('freezes the typed scope target for a changed bound declaration without admitting its unchanged sibling', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/widget.test.ts b/test/widget.test.ts',
          '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+changed assertion',
        ].join('\n') } },
        { match: ['show', 'head123:plan.md'], result: { stdout: '### Task 8: Typed frozen scope\n' } },
        { match: ['show', 'base123:test/widget.test.ts'], result: { stdout: [
          '// Covers: task:8',
          "it('changed assertion', () => { expect(true).toBe(true); });",
          "it('unchanged sibling', () => { expect(true).toBe(true); });",
        ].join('\n') } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: [
          '// Covers: task:8',
          "it('changed assertion', () => { expect(true).toBe(false); });",
          "it('unchanged sibling', () => { expect(true).toBe(true); });",
        ].join('\n') } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);
      const testScope = (inputs.sourceSnapshot as typeof inputs.sourceSnapshot & {
        testScope?: {
          changedDeclarations: readonly { titleChain: readonly string[] }[];
          targets: readonly { declaration: { titleChain: readonly string[] } }[];
          candidates: readonly unknown[];
        };
      }).testScope;

      expect({
        recursivelyFrozen: Object.isFrozen(testScope) && Object.isFrozen(testScope?.targets[0]),
        changedDeclarations: testScope?.changedDeclarations.map(({ titleChain }) => titleChain),
        targets: testScope?.targets.map(({ declaration }) => declaration.titleChain),
        candidates: testScope?.candidates,
      }).toEqual({
        recursivelyFrozen: true,
        changedDeclarations: [['changed assertion']],
        targets: [['changed assertion']],
        candidates: [],
      });
      const evidence = inputs.sourceSnapshot.testScopeEvidence?.find((entry) => entry.source.fileName === 'test/widget.test.ts' && entry.source.side === 'head' && entry.content.includes('changed assertion'));
      expect(evidence).toMatchObject({ startLine: 2, endLine: 2 });
    });

    it('memoizes frozen side-effect source and preserves an injected analyzer failure as a marked candidate', async () => {
      const sideEffect = '__buildReviewConsumerSideEffect';
      delete (globalThis as Record<string, unknown>)[sideEffect];
      const sourceText = [
        '// Covers: task:8',
        `globalThis.${sideEffect} = true;`,
        "it('parser-bound candidate', () => { expect(true).toBe(true); });",
      ].join('\n');
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/side-effect.test.ts b/test/side-effect.test.ts',
          '--- a/test/side-effect.test.ts', '+++ b/test/side-effect.test.ts', '+candidate',
        ].join('\n') } },
        { match: ['show', 'head123:plan.md'], result: { stdout: '### Task 8: typed scope\n' } },
        { match: ['show', 'base123:test/side-effect.test.ts'], result: { stdout: sourceText.replace('true);', 'false);') } },
        { match: ['show', 'head123:test/side-effect.test.ts'], result: { stdout: sourceText } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath, {
        analyzeTestScope: () => { throw new Error('injected parser unavailable'); },
      });

      expect({
        sideEffect: (globalThis as Record<string, unknown>)[sideEffect],
        headReads: calls.filter((args) => args[0] === 'show' && args[1] === 'head123:test/side-effect.test.ts').length,
        targets: inputs.sourceSnapshot.testScope?.targets,
        candidates: inputs.sourceSnapshot.testScope?.candidates.map((candidate) => ({
          reason: candidate.reasons,
          marker: candidate.markers[0]?.reference.id,
          diagnostic: candidate.diagnostic?.message,
        })),
      }).toEqual({
        sideEffect: undefined,
        headReads: 1,
        targets: [],
        candidates: [{
          reason: ['unsupported-declaration'],
          marker: '8',
          diagnostic: 'test declaration analysis failed: injected parser unavailable',
        }],
      });
    });

    it('freezes one changed setup group with its opted-in unchanged bodies', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/group.test.ts b/test/group.test.ts',
          '--- a/test/group.test.ts', '+++ b/test/group.test.ts', '+setup',
        ].join('\n') } },
        { match: ['show', 'head123:plan.md'], result: { stdout: '### Task 8: typed scope\n' } },
        { match: ['show', 'base123:test/group.test.ts'], result: { stdout: [
          '// Covers: task:8',
          "describe('group', () => { beforeEach(() => seed('base')); it('one', () => {}); it('two', () => {}); });",
        ].join('\n') } },
        { match: ['show', 'head123:test/group.test.ts'], result: { stdout: [
          '// Covers: task:8',
          "describe('group', () => { beforeEach(() => seed('head')); it('one', () => {}); it('two', () => {}); });",
        ].join('\n') } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);

      expect(inputs.sourceSnapshot.testScope).toMatchObject({
        changedDeclarations: [],
        targets: [],
        candidates: [{
          declaration: { titleChain: ['group'] },
          reasons: ['affected-opted-in-group'],
          affectedGroup: {
            setup: { kind: 'hook', source: { fileName: 'test/group.test.ts', side: 'head' } },
            unchangedDescendantBodies: [{}, {}],
          },
        }],
        affectedGroups: [{ suite: { titleChain: ['group'] } }],
      });
    });

    it('refuses a missing pinned HEAD blob for a changed test instead of silently emptying scope', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/missing.test.ts b/test/missing.test.ts',
          '--- a/test/missing.test.ts', '+++ b/test/missing.test.ts', '+missing',
        ].join('\n') } },
        { match: ['show', 'head123:test/missing.test.ts'], result: { exitCode: 128, stderr: 'missing pinned blob' } },
      ]);

      await expect(assembleBuildReviewInputs(git, planPath)).rejects.toMatchObject({
        name: 'BuildReviewSourceReadError', kind: 'required-read-failed', path: 'test/missing.test.ts',
      } satisfies Partial<BuildReviewSourceReadError>);
    });

    it('does not enumerate sibling titles without typed changed-declaration evidence', async () => {
      const diff = [
        'diff --git a/test/widget.test.ts b/test/widget.test.ts',
        '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
      ].join('\n');
      const alphaSource = [
        "describe('workspace', () => {",
        "  describe('alpha branch', () => it('keeps the selected assertion', () => {}));",
        "  describe('beta branch', () => it('unrelated sibling assertion', () => {}));",
        '});',
      ].join('\n');

      const baseline = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: diff } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: alphaSource } },
      ]);
      const baselineInputs = await assembleBuildReviewInputs(baseline.git, planPath);

      expect(baselineInputs.sourceSnapshot.changedTestTitles).toEqual([]);
    });

    it('does not turn declaration-shaped source text into typed title evidence', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/widget.test.ts b/test/widget.test.ts',
          '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
        ].join('\n') } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: [
          "// describe('comment suite', () => it('comment test', () => {}));",
          "const ordinary = \"describe('string suite', () => it('string test', () => {}));\";",
          "const templated = `describe('template suite', () => it('template test', () => {}));`;",
          "const declarationPattern = /describe('regex suite', () => it('regex test', () => {}));/;",
          "describe('actual suite', () => it('actual test', () => {}));",
        ].join('\n') } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);

      expect(inputs.sourceSnapshot.changedTestTitles).toEqual([]);
    });

    it('captures nested title chains declared through function suite callbacks', async () => {
      const { git } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: [
          'diff --git a/test/widget.test.ts b/test/widget.test.ts',
          '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
        ].join('\n') } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: "describe('workspace', function () { describe('alpha branch', function () { it('keeps the selected assertion', () => {}); }); });" } },
      ]);

      const inputs = await assembleBuildReviewInputs(git, planPath);

      expect(inputs.sourceSnapshot.changedTestTitles).toEqual([
        {
          selector: 'test/widget.test.ts',
          titleText: 'workspace > alpha branch > keeps the selected assertion',
          staticExtractionFallback: false,
        },
      ]);
    });

    it('does not construct legacy title regions for declarations outside typed scope', async () => {
      const diff = [
        'diff --git a/test/widget.test.ts b/test/widget.test.ts',
        '--- a/test/widget.test.ts', '+++ b/test/widget.test.ts', '+change',
      ].join('\n');
      const source = [
        "describe('workspace', () => {",
        "  describe('alpha branch', () => it('keeps the selected assertion', () => {}));",
        "  describe('beta branch', () => it('unrelated sibling assertion', () => {}));",
        '});',
      ].join('\n');
      const inputsFor = (widgetSource: string) => assembleBuildReviewInputs(fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'base123\n' } },
        { match: ['diff', 'base123..HEAD'], result: { stdout: diff } },
        { match: ['show', 'head123:test/widget.test.ts'], result: { stdout: widgetSource } },
      ]).git, planPath);
      const titleRegions = (inputs: BuildReviewFrozenInputs) =>
        (buildReviewFindingReferenceContext({
          rubric: 'tautology',
          changedFiles: [],
          changedTestSelectors: ['test/widget.test.ts'],
          changedTestTitles: inputs.sourceSnapshot.changedTestTitles,
        } as unknown as BuildReviewRubricProjection) as unknown as {
          readonly changedTestRegions: readonly {
          readonly path: string;
          readonly contentHash: string;
          readonly display: string;
          }[];
        }).changedTestRegions;
      const [baseline, siblingReworded] = await Promise.all([
        inputsFor(source),
        inputsFor(source.replace('unrelated sibling assertion', 'renamed unrelated sibling assertion')),
      ]);
      expect(titleRegions(baseline)).toEqual([]);
      expect(titleRegions(siblingReworded)).toEqual([]);
    });

    it('derives content identity from review content rather than git provenance or operator reseals', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/identity.md');

      async function contentDigestFor({
        baseRef = 'feature/first',
        mergeBase = 'base-first',
        headSha = 'head-first',
        diff = 'diff --git a/a b/a\nindex 1111111..2222222 100644\n+change\n',
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
          { match: ['rev-parse', 'HEAD'], result: { stdout: `${headSha}\n` } },
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
      const rebasedBlobIdentity = await contentDigestFor({
        diff: 'diff --git a/a b/a\nindex aaaaaaa..bbbbbbb 100644\n+change\n',
      });
      const oneByteDiff = await contentDigestFor({ diff: 'diff --git a/a b/a\nindex 1111111..2222222 100644\n+changed\n' });
      const changedPlan = await contentDigestFor({ planBody: '# Plan body\n\nChanged plan content.\n' });
      const changedReseal = await contentDigestFor({ resealReason: 'Operator approved the corrected amendment.' });
      expect({
        hasSha256Digest: /^sha256:[a-f0-9]{64}$/.test(baseline),
        provenanceIsExcluded: changedProvenance === baseline,
        blobIdentityIsExcluded: rebasedBlobIdentity === baseline,
        diffIsIncluded: oneByteDiff !== baseline,
        planIsIncluded: changedPlan !== baseline,
        resealIsExcluded: changedReseal === baseline,
      }).toEqual({
        hasSha256Digest: true,
        provenanceIsExcluded: true,
        blobIdentityIsExcluded: true,
        diffIsIncluded: true,
        planIsIncluded: false,
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
        'abc1234..head123',
        '--',
        '.',
        ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
      ]);
    });

    // The engine appends its own `### Task rem-*` blocks to the approved plan
    // during remediation rounds (recorded in `.pipeline/engine-state.json`).
    // That append lands as a feature commit, so the graded diff showed it as a
    // change to an approved DECIDE artifact and Scope FAILed it as an
    // out-of-plan change no authority could ever grant — the feature cannot
    // remove it, because the engine requires it (observed on
    // `clean-rubric-judgements-rejected-as-invalid-provid`, whose plan diff was
    // 0 removals / 11 additions, all of them recorded `rem-*` headings).
    // The exclusion reuses the seal's recorded-ids rule, so a plan amendment
    // that is anything more than exactly those blocks stays in the diff.
    async function recordAppendedRemediationTaskIds(ids: readonly string[]): Promise<void> {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/engine-state.json'),
        JSON.stringify({ appendedRemediationTaskIds: ids }),
        'utf-8',
      );
    }

    const BASE_PLAN = '# Plan\n\n### Task 1: do the thing\n- Files: src/a.ts\n';

    it('excludes the plan from the graded diff when its only amendment is the engine’s recorded remediation append', async () => {
      await recordAppendedRemediationTaskIds(['rem-tautology-1', 'rem-root-cause-1']);
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'abc1234\n' } },
        { match: ['show', 'abc1234:plan.md'], result: { stdout: BASE_PLAN } },
        {
          match: ['show', 'HEAD:plan.md'],
          result: {
            stdout: `${BASE_PLAN}\n### Task rem-tautology-1: strengthen the test\n- Files: test/a.test.ts\n\n### Task rem-root-cause-1: fix the cause\n- Files: src/a.ts\n`,
          },
        },
        { match: ['diff', 'abc1234..HEAD'], result: { stdout: 'diff --git a/x b/x\n' } },
      ]);

      await assembleBuildReviewInputs(git, planPath);

      expect(calls.find((c) => c[0] === 'diff')).toEqual([
        'diff',
        'abc1234..head123',
        '--',
        '.',
        ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
        ':(exclude)plan.md',
      ]);
    });

    it('keeps the plan in the graded diff when the amendment is more than the recorded append', async () => {
      await recordAppendedRemediationTaskIds(['rem-tautology-1']);
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'abc1234\n' } },
        { match: ['show', 'abc1234:plan.md'], result: { stdout: BASE_PLAN } },
        {
          match: ['show', 'HEAD:plan.md'],
          result: {
            // A hand-authored task rides along with the engine's own append.
            stdout: `${BASE_PLAN}\n### Task rem-tautology-1: strengthen the test\n- Files: test/a.test.ts\n\n### Task 9: unplanned extra work\n- Files: src/b.ts\n`,
          },
        },
        { match: ['diff', 'abc1234..HEAD'], result: { stdout: 'diff --git a/x b/x\n' } },
      ]);

      await assembleBuildReviewInputs(git, planPath);

      expect(calls.find((c) => c[0] === 'diff')).toEqual([
        'diff',
        'abc1234..head123',
        '--',
        '.',
        ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
      ]);
    });

    it('keeps the plan in the graded diff when the engine recorded no appended remediation tasks', async () => {
      const { git, calls } = fakeGit([
        ...freshProbeScript,
        { match: ['merge-base', 'origin/main', 'HEAD'], result: { stdout: 'abc1234\n' } },
        { match: ['diff', 'abc1234..HEAD'], result: { stdout: 'diff --git a/x b/x\n' } },
      ]);

      await assembleBuildReviewInputs(git, planPath);

      expect(calls.find((c) => c[0] === 'diff')).toEqual([
        'diff',
        'abc1234..head123',
        '--',
        '.',
        ...MACHINERY_AUTHORED_PATHS.map((p) => `:(exclude)${p}`),
      ]);
      expect(calls.some((c) => c[0] === 'show')).toBe(true);
    });

    it('names exactly the engine-authored surfaces as machinery paths', () => {
      expect([...MACHINERY_AUTHORED_PATHS].sort()).toEqual([
        '.docs/shipped/',
        '.pipeline/',
        'CHANGELOG.md',
        'docs/',
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
        { match: ['rev-parse', 'HEAD'], result: { exitCode: 0, stdout: 'head123\n' } },
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
        { match: ['rev-parse', 'HEAD'], result: { exitCode: 0, stdout: 'head123\n' } },
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
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await Promise.all([
        writeFile(join(dir, '.docs/plans/fixture.md'), '# Pinned fixture plan\n'),
        writeFile(join(dir, '.docs/plans/semantic-repair.md'), '# Pinned semantic plan\n'),
      ]);
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

    it('excludes tests introduced only by a newer base branch from feature-owned declaration evidence', async () => {
      await git('checkout', 'feature/foo');
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(join(dir, 'test/feature-owned.test.ts'), "it('feature-owned test', () => {});\n");
      await git('add', 'test/feature-owned.test.ts');
      await git('commit', '-m', 'add feature-owned test');

      await git('checkout', 'main');
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(join(dir, 'test/base-only.test.ts'), "it('base-only test', () => {});\n");
      await git('add', 'test/base-only.test.ts');
      await git('commit', '-m', 'add merged base test');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      await git('checkout', 'feature/foo');

      const result = await assembleInputs(realGit(), planPath, {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: await git('rev-parse', 'HEAD'), outcome: 'PASS' },
        } as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>),
      });

      expect(result.sourceSnapshot.changedTestTitles).toEqual([
        { selector: 'test/feature-owned.test.ts', titleText: 'feature-owned test', staticExtractionFallback: false },
      ]);
    });

    it('keeps pinned plan, stories, test bytes and a space-containing rename pair after live worktree mutation', async () => {
      const frozenPlan = join(dir, '.docs/plans/frozen.md');
      const frozenStories = join(dir, '.docs/stories/frozen.md');
      await git('checkout', 'main');
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(frozenPlan, '**Stories:** .docs/stories/frozen.md\n\n### Task 1: frozen\n');
      await writeFile(frozenStories, '# Frozen stories\n\n## Story 1: frozen\n\n#### Happy Path\n- Given frozen bytes, when assembled, then they remain pinned\n');
      await writeFile(join(dir, 'test/old name.test.ts'), '// Covers: S1.1\nit(\'pinned test\', () => {});\n');
      await git('add', '.docs', 'test/old name.test.ts');
      await git('commit', '-m', 'add frozen source artifacts');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');

      await git('checkout', '-b', 'feature/frozen-source');
      await git('mv', 'test/old name.test.ts', 'test/new name.test.ts');
      await git('commit', '-m', 'rename test with spaces');

      const result = await assembleInputs(realGit(), frozenPlan, {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: await git('rev-parse', 'HEAD'), outcome: 'PASS' },
        } as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>),
      });

      await Promise.all([
        writeFile(frozenPlan, '# MUTATED LIVE PLAN\n'),
        writeFile(frozenStories, '# MUTATED LIVE STORIES\n'),
        writeFile(join(dir, 'test/new name.test.ts'), 'it(\'mutated live test\', () => {});\n'),
      ]);

      expect(result.planBody).toContain('### Task 1: frozen');
      expect(result.sourceSnapshot.testQuality).toEqual({
        inScopeTests: [], unresolvedMarkers: [],
      });
      expect(result.sourceSnapshot.changedTestTitles).toEqual([]);
      expect(result.sourceSnapshot.sourceChanges).toContainEqual({
        kind: 'R', oldPath: 'test/old name.test.ts', path: 'test/new name.test.ts',
      });
    });

    it('projects only changed tests whose Covers markers bind to this plan or its referenced stories', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/selected.md');
      const selectedStoriesPath = join(dir, '.docs/stories/selected.md');

      await git('checkout', 'main');
      await mkdir(join(dir, '.docs/stories'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      // Criterion ids are positional: story files carry Given/When/Then
      // bullets, never literal `S<n>.<m>` ids. `S3.1` must resolve from the
      // first happy-path bullet of Story 3, not from a body grep.
      await writeFile(selectedStoriesPath, [
        '# Selected stories',
        '',
        '## Story 3: Selected behavior',
        '',
        '#### Happy Path',
        '- Given the selected stories artifact, when build_review resolves markers, then the first criterion binds positionally',
        '',
      ].join('\n'));
      // This criterion must not resolve `Covers: S9.1`: the plan selects the
      // preceding artifact, and build_review must never glob `.docs/stories`.
      await writeFile(join(dir, '.docs/stories/unrelated.md'), [
        '# Unrelated stories',
        '',
        '## Story 9: Unrelated behavior',
        '',
        '#### Happy Path',
        '- Given an unrelated stories artifact, when build_review resolves markers, then this criterion stays invisible',
        '',
      ].join('\n'));
      await writeFile(scopedPlanPath, [
        '**Stories:** .docs/stories/selected.md',
        '',
        '### Task 7: selected behavior',
        '',
        '**Files:** src/selected.ts',
      ].join('\n'));
      await git('add', '.');
      await git('commit', '-m', 'add selected plan and stories');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');

      await git('checkout', '-b', 'feature/test-quality-projection');
      await mkdir(join(dir, 'test'), { recursive: true });
      await mkdir(join(dir, 'src'), { recursive: true });
      await Promise.all([
        writeFile(join(dir, 'src/technical-coverage.ts'), '// Covers: task:7\nexport const technicalCoverage = true;\n'),
        writeFile(join(dir, 'test/criterion.test.ts'), '// Covers: S3.1\nit(\'criterion\', () => {});\n'),
        writeFile(join(dir, 'test/task.test.ts'), '// Covers: task:7\nit(\'task\', () => {});\n'),
        writeFile(join(dir, 'test/unmarked.test.ts'), 'it(\'unmarked\', () => {});\n'),
        writeFile(join(dir, 'test/unresolved.test.ts'), '// Covers: S9.1\nit(\'unresolved\', () => {});\n'),
        // Story 3 has exactly one criterion: an id beyond the positional
        // count stays advisory, never a scope binding.
        writeFile(join(dir, 'test/beyond.test.ts'), '// Covers: S3.2\nit(\'beyond criterion count\', () => {});\n'),
        writeFile(join(dir, 'test/malformed.test.ts'), '// Covers: FR-, S3, task:\nit(\'malformed\', () => {});\n'),
      ]);
      await git('add', 'test', 'src/technical-coverage.ts');
      await git('commit', '-m', 'add feature tests');

      const currentProof = async (): Promise<FullSuiteInspectionResult> => ({
        status: 'CURRENT',
        evidence: { provenanceHeadSha: await git('rev-parse', 'HEAD'), outcome: 'PASS' },
      } as Extract<FullSuiteInspectionResult, { status: 'CURRENT' }>);
      const assembleProjection = () => assembleInputs(realGit(), scopedPlanPath, { inspectTestSuite: currentProof });

      const beforeRebase = await assembleProjection();

      expect(beforeRebase.sourceSnapshot.testQuality).toEqual({
        inScopeTests: ['test/criterion.test.ts', 'test/task.test.ts'],
        unresolvedMarkers: [
          { selector: 'test/beyond.test.ts', reference: 'S3.2' },
          { selector: 'test/malformed.test.ts', reference: 'FR-' },
          { selector: 'test/malformed.test.ts', reference: 'S3' },
          { selector: 'test/malformed.test.ts', reference: 'task:' },
          { selector: 'test/unresolved.test.ts', reference: 'S9.1' },
        ],
      });

      // Another feature's test reaches the base before this feature is rebased.
      // It must disappear from this feature's fresh merge-base diff.
      await git('checkout', 'main');
      await mkdir(join(dir, 'test'), { recursive: true });
      await writeFile(join(dir, 'test/other-feature.test.ts'), '// Covers: S3.1\nit(\'other feature\', () => {});\n');
      await git('add', 'test/other-feature.test.ts');
      await git('commit', '-m', 'add other feature test');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      await git('checkout', 'feature/test-quality-projection');
      await git('rebase', 'main');

      const afterRebase = await assembleProjection();

      expect(afterRebase.diff).not.toContain('other-feature.test.ts');
      expect(afterRebase.sourceSnapshot.testQuality).toEqual(beforeRebase.sourceSnapshot.testQuality);
    });

    // End-to-end form of the engine-append exclusion: the plan is committed on
    // the base branch and the feature branch carries the engine's own
    // remediation append. Scope may never see that append as an out-of-plan
    // change, because no authority can grant it and the feature cannot remove
    // it — the engine requires the blocks.
    async function commitPlanRemediationFixture(headPlanBody: string, recordedIds: readonly string[]): Promise<string> {
      const scopedPlanPath = join(dir, '.docs/plans/rem-fixture.md');
      const basePlanBody = '# Plan\n\n### Task 1: do the thing\n- Files: src/fix.ts\n';
      await git('checkout', 'main');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(scopedPlanPath, basePlanBody, 'utf-8');
      await git('add', '.');
      await git('commit', '-m', 'approved plan');
      await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');

      await git('checkout', '-b', 'feature/remediation');
      await writeFile(scopedPlanPath, headPlanBody, 'utf-8');
      await writeFile(join(dir, 'src-fix.ts'), 'export const fixed = true;\n', 'utf-8');
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/engine-state.json'),
        JSON.stringify({ appendedRemediationTaskIds: recordedIds }),
        'utf-8',
      );
      await git('add', '.');
      await git('commit', '-m', 'remediation round');
      return scopedPlanPath;
    }

    const ENGINE_APPENDED_PLAN =
      '# Plan\n\n### Task 1: do the thing\n- Files: src/fix.ts\n'
      + '\n### Task rem-tautology-1: strengthen the test\n- Files: test/fix.test.ts\n';

    it('keeps the engine’s own recorded remediation append out of the graded diff', async () => {
      const scopedPlanPath = await commitPlanRemediationFixture(ENGINE_APPENDED_PLAN, ['rem-tautology-1']);

      const result = await assembleBuildReviewInputs(realGit(), scopedPlanPath);

      expect(result.diff).toContain('src-fix.ts');
      expect(result.diff).not.toContain('.docs/plans/rem-fixture.md');
      expect(result.diff).not.toContain('rem-tautology-1');
      // The plan the rubrics judge against still carries the appended task.
      expect(result.planBody).toContain('### Task rem-tautology-1');
    });

    it('grades a plan amendment that is more than the recorded remediation append', async () => {
      const scopedPlanPath = await commitPlanRemediationFixture(
        `${ENGINE_APPENDED_PLAN}\n### Task 9: unplanned extra work\n- Files: src/other.ts\n`,
        ['rem-tautology-1'],
      );

      const result = await assembleBuildReviewInputs(realGit(), scopedPlanPath);

      expect(result.diff).toContain('.docs/plans/rem-fixture.md');
      expect(result.diff).toContain('Task 9: unplanned extra work');
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

    it('derives shared content identity from semantic repair context, not repair record provenance', async () => {
      const scopedPlanPath = join(dir, '.docs/plans/semantic-repair.md');
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(scopedPlanPath, '# Plan body\n\nFixture plan.\n');

      const contentDigestFor = async (repair: Record<string, unknown>) => {
        await writeFile(join(dir, '.pipeline/build-review-rebase-repairs.json'), JSON.stringify({ repairs: [repair] }));
        return (await assembleBuildReviewInputs(realGit(), scopedPlanPath)).sourceSnapshot.contentDigest;
      };
      const baselineRepair = {
        id: 'repair-original', gate: 'test_suite', reason: 'command_failed',
        diagnostic: 'src/base.ts changed the aggregate command expectation', rebaseInvalidatedAt: 101,
      };

      const baseline = await contentDigestFor(baselineRepair);
      const changedProvenance = await contentDigestFor({
        ...baselineRepair, id: 'repair-rebased', rebaseInvalidatedAt: 202,
      });
      const changedReason = await contentDigestFor({ ...baselineRepair, reason: 'timeout' });
      const changedDiagnostic = await contentDigestFor({ ...baselineRepair, diagnostic: 'src/other.ts changed' });

      expect(changedProvenance).toBe(baseline);
      expect(changedReason).not.toBe(baseline);
      expect(changedDiagnostic).not.toBe(baseline);
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

      expect(featureInputs).not.toHaveProperty('operatorReseals');
      expect(looseInputs).not.toHaveProperty('operatorReseals');
      expect(featureInputs.sourceSnapshot).not.toHaveProperty('operatorReseals');

      await writeFile(join(dir, '.pipeline/protected-artifact-seal.json'), '{ unusable');
      expect(await assembleBuildReviewInputs(realGit(), scopedPlanPath)).not.toHaveProperty('operatorReseals');
    });

    it('keeps test-quality snapshot identity stable while a real operator reseal changes unrelated provenance', async () => {
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
        testQuality: {
          changedTestSelectors: [], revertedProductionManifest: [], unresolvedMarkers: [], preflight: { classification: 'not-requested' },
        },
      });

      await writeSeal('Operator approved the amendment.');
      const firstInputs = await assembleBuildReviewInputs(realGit(), scopedPlanPath);
      const first = project(firstInputs);
      await writeSeal('Operator approved the corrected amendment rationale.');
      const secondInputs = await assembleBuildReviewInputs(realGit(), scopedPlanPath);
      const second = project(secondInputs);

      expect(secondInputs.sourceSnapshot.digest).toBe(firstInputs.sourceSnapshot.digest);
      expect(second.testQuality).toEqual(first.testQuality);
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
      await writeFile(join(fixture.repo, 'plan.md'), '# Pinned plan\n');
      await execFileAsync('git', ['-C', fixture.repo, 'add', 'plan.md']);
      await execFileAsync('git', ['-C', fixture.repo, 'commit', '-m', 'add pinned plan']);
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
