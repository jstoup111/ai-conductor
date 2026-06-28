import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  STEP_ARTIFACT_GLOBS,
  findArtifactFiles,
  stepHasArtifacts,
  getArtifactStatus,
  checkStepCompletion,
  isStoriesApproved,
  classifyPrdAuditGaps,
  FINISH_CHOICE_MARKER,
  HALT_MARKER,
} from '../../src/engine/artifacts.js';

describe('engine/artifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createFile(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dirPath, { recursive: true });
    await writeFile(fullPath, content);
  }

  describe('STEP_ARTIFACT_GLOBS', () => {
    it('declares plan output in .docs/plans/', () => {
      expect(STEP_ARTIFACT_GLOBS.plan).toEqual(['.docs/plans/*.md']);
    });

    it('declares stories output recursively in .docs/stories/', () => {
      expect(STEP_ARTIFACT_GLOBS.stories).toEqual(['.docs/stories/**/*.md']);
    });

    it('returns an empty list for steps that produce no artifacts', () => {
      expect(STEP_ARTIFACT_GLOBS.complexity).toEqual([]);
      expect(STEP_ARTIFACT_GLOBS.finish).toEqual([]);
    });

    it('declares manual_test results file', () => {
      expect(STEP_ARTIFACT_GLOBS.manual_test).toEqual(['.pipeline/manual-test-results.md']);
    });
  });

  describe('findArtifactFiles', () => {
    it('returns [] when the step produces no artifacts', async () => {
      expect(await findArtifactFiles(dir, 'complexity')).toEqual([]);
    });

    it('returns [] when no matching files exist', async () => {
      expect(await findArtifactFiles(dir, 'plan')).toEqual([]);
    });

    it('matches dir/*.ext patterns', async () => {
      await createFile('.docs/plans/2026-04-16-feature.md', 'plan');
      const files = await findArtifactFiles(dir, 'plan');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/2026-04-16-feature\.md$/);
    });

    it('matches dir/**/*.ext patterns recursively', async () => {
      await createFile('.docs/stories/epic-1/story-a.md', 'story');
      await createFile('.docs/stories/epic-1/nested/story-b.md', 'story');
      const files = await findArtifactFiles(dir, 'stories');
      expect(files).toHaveLength(2);
    });

    it('matches multiple globs for architecture_review', async () => {
      await createFile('.docs/decisions/architecture-review-2026-04-16.md', 'rev');
      await createFile('.docs/decisions/adr-001.md', 'adr');
      const files = await findArtifactFiles(dir, 'architecture_review');
      expect(files).toHaveLength(2);
    });

    it('matches literal filenames', async () => {
      await createFile('.pipeline/task-status.json', '{}');
      const files = await findArtifactFiles(dir, 'build');
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/task-status\.json$/);
    });

    it('matches prefix globs like technical-assessment-*', async () => {
      await createFile('.docs/decisions/technical-assessment-2026-04-16.md', 'a');
      const files = await findArtifactFiles(dir, 'assess');
      expect(files).toHaveLength(1);
    });
  });

  describe('stepHasArtifacts', () => {
    it('returns true for steps that produce no artifacts (vacuous truth)', async () => {
      expect(await stepHasArtifacts(dir, 'complexity')).toBe(true);
      expect(await stepHasArtifacts(dir, 'worktree')).toBe(true);
    });

    it('returns false when an artifact-producing step has no files', async () => {
      expect(await stepHasArtifacts(dir, 'plan')).toBe(false);
      expect(await stepHasArtifacts(dir, 'brainstorm')).toBe(false);
    });

    it('returns true once the expected file exists', async () => {
      await createFile('.docs/plans/2026-04-16-thing.md');
      expect(await stepHasArtifacts(dir, 'plan')).toBe(true);
    });

    it('recognizes acceptance_specs across stacks (Rails spec dir AND Node test file)', async () => {
      expect(await stepHasArtifacts(dir, 'acceptance_specs')).toBe(false);
      // Node convention: a root-level *.test.js must satisfy the step.
      await createFile('app.test.js');
      expect(await stepHasArtifacts(dir, 'acceptance_specs')).toBe(true);
    });

    it('recognizes a root-level *.test.tsx (React/RN) without any config', async () => {
      expect(await stepHasArtifacts(dir, 'acceptance_specs')).toBe(false);
      await createFile('App.test.tsx');
      expect(await stepHasArtifacts(dir, 'acceptance_specs')).toBe(true);
    });
  });

  describe('checkStepCompletion: acceptance_specs (monorepo + config globs)', () => {
    // Mirrors the honeydew-or-handymando false-halt: correct RED specs committed
    // under package subdirs (api/, frontend/) that no root-level default matches.
    async function seedMonorepoSpecs() {
      await createFile('api/spec/integration/household_invite_spec.rb', 'x');
      await createFile('api/spec/jobs/notification_dispatcher_job_spec.rb', 'x');
      await createFile('frontend/__tests__/screens/TabBar.test.tsx', 'x');
    }

    it('false-fails on a monorepo layout when no config globs are declared', async () => {
      await seedMonorepoSpecs();
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
    });

    it('passes once the project declares package-prefix globs via config', async () => {
      await seedMonorepoSpecs();
      const result = await checkStepCompletion(dir, 'acceptance_specs', {
        config: { acceptance_spec_globs: ['*/spec/**/*', '*/__tests__/**/*'] },
      });
      expect(result).toEqual({ done: true });
    });

    it('honors a literal package prefix (no wildcard) in config globs too', async () => {
      await seedMonorepoSpecs();
      const result = await checkStepCompletion(dir, 'acceptance_specs', {
        config: { acceptance_spec_globs: ['api/spec/**/*'] },
      });
      expect(result).toEqual({ done: true });
    });

    it('still fails with zero spec files even when config globs are declared', async () => {
      const result = await checkStepCompletion(dir, 'acceptance_specs', {
        config: { acceptance_spec_globs: ['*/spec/**/*', '*/__tests__/**/*'] },
      });
      expect(result.done).toBe(false);
    });

    it('does not expand `*/` into node_modules or dot-dirs', async () => {
      // A spec-shaped path buried in node_modules / .git must NOT satisfy the gate.
      await createFile('node_modules/somepkg/spec/x_spec.rb', 'x');
      await createFile('.git/spec/x_spec.rb', 'x');
      const result = await checkStepCompletion(dir, 'acceptance_specs', {
        config: { acceptance_spec_globs: ['*/spec/**/*'] },
      });
      expect(result.done).toBe(false);
    });
  });

  describe('checkStepCompletion: finish predicate', () => {
    it('passes when finish-choice="pr" AND state.pr_url is set', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish');
      expect(result).toEqual({ done: true });
    });

    it('passes when finish-choice marker holds a recognized non-PR outcome', async () => {
      for (const choice of ['merge-local', 'keep', 'discard']) {
        const subDir = join(dir, choice);
        await mkdir(join(subDir, '.pipeline'), { recursive: true });
        await writeFile(join(subDir, FINISH_CHOICE_MARKER), choice);
        const result = await checkStepCompletion(subDir, 'finish');
        expect(result).toEqual({ done: true });
      }
    });

    it('fails when finish-choice="pr" but state has no pr_url', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      // No .pipeline/conduct-state.json with pr_url.
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/pr_url/);
    });

    it('fails when state.pr_url is set but finish-choice marker is missing', async () => {
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/finish-choice/);
    });

    it('fails when neither pr_url nor finish-choice exists', async () => {
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/finish-choice/);
    });

    it('fails when finish-choice contains an unrecognized value', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'maybe');
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/unrecognized/);
    });

    it('trims whitespace around the marker value', async () => {
      await createFile(FINISH_CHOICE_MARKER, '  keep\n');
      const result = await checkStepCompletion(dir, 'finish');
      expect(result).toEqual({ done: true });
    });

    it('rejects a stale finish-choice when sessionStartedAt is in the future', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'keep');
      // Backdate the marker to before the session.
      const past = new Date(Date.now() - 60_000);
      await utimes(join(dir, FINISH_CHOICE_MARKER), past, past);
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: Date.now(),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/stale/);
    });
  });

  describe('checkStepCompletion: build predicate (halt marker)', () => {
    async function writeAllCompleteTaskStatus() {
      await createFile(
        '.pipeline/task-status.json',
        JSON.stringify({
          tasks: [
            { id: 'T1', status: 'completed' },
            { id: 'T2', status: 'completed' },
          ],
        }),
      );
    }

    it('fails when .pipeline/halt-user-input-required is present, even with all-complete tasks', async () => {
      await writeAllCompleteTaskStatus();
      await createFile(HALT_MARKER, 'user requested exit; 1 regression pending');
      const result = await checkStepCompletion(dir, 'build');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/halt-user-input-required/);
    });

    it('passes when no halt marker and all tasks completed', async () => {
      await writeAllCompleteTaskStatus();
      const result = await checkStepCompletion(dir, 'build');
      expect(result).toEqual({ done: true });
    });
  });

  describe('checkStepCompletion: manual_test predicate', () => {
    const RESULTS = '.pipeline/manual-test-results.md';

    it('fails when manual-test-results.md is missing', async () => {
      const result = await checkStepCompletion(dir, 'manual_test');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/manual-test-results\.md/);
    });

    it('fails when manual-test-results.md contains a FAIL row', async () => {
      await createFile(
        RESULTS,
        '# Results\n\n| Story | Result |\n|---|---|\n| Foo | PASS |\n| Bar | FAIL |\n',
      );
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/FAIL/);
    });

    it('passes when results are PASS only and fresh enough', async () => {
      await createFile(RESULTS, '| Story | Result |\n|---|---|\n| Foo | PASS |\n');
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
      });
      expect(result).toEqual({ done: true });
    });

    it('rejects a stale results file when sessionStartedAt is newer than mtime', async () => {
      await createFile(RESULTS, '| Story | Result |\n|---|---|\n| Foo | PASS |\n');
      const past = new Date(Date.now() - 60_000);
      await utimes(join(dir, RESULTS), past, past);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: Date.now(),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/stale/);
    });
  });

  describe('checkStepCompletion: retro predicate', () => {
    it('fails when no retro files exist', async () => {
      const result = await checkStepCompletion(dir, 'retro');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/no \.docs\/retros/);
    });

    it('fails when only stale prior-feature retros exist', async () => {
      await createFile('.docs/retros/2025-01-01-other-feature.md', '# Retro');
      const past = new Date(Date.now() - 60_000);
      await utimes(join(dir, '.docs/retros/2025-01-01-other-feature.md'), past, past);
      const result = await checkStepCompletion(dir, 'retro', {
        sessionStartedAt: Date.now(),
        featureDesc: 'add foo',
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/no retro found for current feature|stale/);
    });

    it('passes when a fresh slug-matched retro exists', async () => {
      await createFile('.docs/retros/2026-05-01-add-foo.md', '# Retro');
      const result = await checkStepCompletion(dir, 'retro', {
        sessionStartedAt: 0,
        featureDesc: 'add foo',
      });
      expect(result).toEqual({ done: true });
    });

    it('passes when feature_desc is unavailable and any fresh retro file exists', async () => {
      await createFile('.docs/retros/some-retro.md', '# Retro');
      const result = await checkStepCompletion(dir, 'retro', {
        sessionStartedAt: 0,
      });
      expect(result).toEqual({ done: true });
    });
  });

  describe('getArtifactStatus', () => {
    it('returns [] for steps that produce no artifacts', async () => {
      expect(await getArtifactStatus(dir, 'complexity')).toEqual([]);
    });

    it('reports satisfied=false when the pattern has no matches', async () => {
      const status = await getArtifactStatus(dir, 'plan');
      expect(status).toHaveLength(1);
      expect(status[0]).toMatchObject({
        pattern: '.docs/plans/*.md',
        files: [],
        satisfied: false,
      });
    });

    it('reports satisfied=true with matched file paths relative to dir', async () => {
      await createFile('.docs/plans/2026-04-16-feature.md');
      const status = await getArtifactStatus(dir, 'plan');
      expect(status[0].satisfied).toBe(true);
      expect(status[0].files).toEqual(['.docs/plans/2026-04-16-feature.md']);
    });

    it('returns one status per glob pattern', async () => {
      await createFile('.docs/decisions/adr-001.md');
      const status = await getArtifactStatus(dir, 'architecture_review');
      expect(status).toHaveLength(2);
      const adrMatch = status.find((s) => s.pattern.includes('adr-'));
      const reviewMatch = status.find((s) => s.pattern.includes('architecture-review-'));
      expect(adrMatch?.satisfied).toBe(true);
      expect(reviewMatch?.satisfied).toBe(false);
    });
  });

  // The single canonical approval token shared by the engineer land gate and the
  // daemon backlog. Locks the contract: ONLY "Status: Accepted" approves; DRAFT,
  // a missing status line, and the PRD's "Approved" token are all unapproved.
  describe('isStoriesApproved (canonical approval token)', () => {
    it('approves a stories file declaring **Status:** Accepted', () => {
      expect(isStoriesApproved('# Stories\n**Status:** Accepted\n')).toBe(true);
    });

    it('approves plain-YAML and case/whitespace variants of Status: Accepted', () => {
      expect(isStoriesApproved('status: accepted')).toBe(true);
      expect(isStoriesApproved('**Status:**   ACCEPTED')).toBe(true);
      expect(isStoriesApproved('Status : Accepted')).toBe(true);
    });

    it('rejects DRAFT stories', () => {
      expect(isStoriesApproved('# Stories\n**Status:** DRAFT\n')).toBe(false);
    });

    it('rejects a file with NO status line at all (the silent-skip casualty)', () => {
      expect(isStoriesApproved('# Stories\n\n## Story: Foo\nbody\n')).toBe(false);
      expect(isStoriesApproved('')).toBe(false);
    });

    it('rejects the PRD token "Status: Approved" (strict: stories use Accepted)', () => {
      expect(isStoriesApproved('# Stories\n**Status:** Approved\n')).toBe(false);
    });

    it('rejects when DRAFT is present even if Accepted also appears', () => {
      expect(isStoriesApproved('**Status:** Accepted\n... was **Status:** DRAFT')).toBe(false);
    });
  });

  describe('classifyPrdAuditGaps', () => {
    const header = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n';
    async function writeAudit(body: string) {
      // sessionStartedAt=undefined below treats any mtime as fresh.
      await createFile('.pipeline/prd-audit.md', '# PRD Audit\n\n' + header + body);
    }

    it('returns clean when there is no audit report', async () => {
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('clean');
    });

    it('returns clean when every FR is ALIGNED', async () => {
      await writeAudit('| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n');
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('clean');
    });

    it('does not flag an ALIGNED row whose Evidence prose contains a verdict word', async () => {
      // Regression: the verdict must be read from the Verdict CELL, not the whole
      // row. This is the live FR-9 case — verdict ALIGNED, but the Evidence cell
      // says "404 foreign/missing", which a whole-row scan mistook for a MISSING
      // verdict and falsely blocked the SHIP gate.
      await writeAudit(
        '| FR-9 | ALIGNED | n/a | kids_controller.rb:193-200 (find_kid_for_parent → 404 foreign/missing); routes.rb:21 | — |\n',
      );
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('clean');
    });

    it('returns impl-only when every blocking row is impl-gap', async () => {
      await writeAudit(
        '| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n' +
          '| FR-2 | MISSING | impl-gap | (no handler) | no |\n' +
          '| FR-3 | PARTIAL | impl-gap | bar.ts:9 | no |\n',
      );
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('impl-only');
      expect(c.summary).toMatch(/FR-2 \(impl-gap\)/);
      expect(c.summary).toMatch(/FR-3 \(impl-gap\)/);
    });

    it('returns needs-decide when any blocking row is intended-drift', async () => {
      await writeAudit(
        '| FR-2 | MISSING | impl-gap | (no handler) | no |\n' +
          '| FR-3 | DIVERGED | intended-drift | baz.ts:88 | no |\n',
      );
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('needs-decide');
      expect(c.summary).toMatch(/FR-3 \(intended-drift\)/);
    });

    it('treats a plan-gap row as needs-decide (forward-compat class)', async () => {
      await writeAudit('| FR-4 | MISSING | plan-gap | (never planned) | no |\n');
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('needs-decide');
      expect(c.summary).toMatch(/FR-4 \(plan-gap\)/);
    });

    it('treats an unclassifiable blocking row as needs-decide', async () => {
      // Blocking verdict but no recognizable gap-class cell.
      await writeAudit('| FR-5 | MISSING | | (evidence) | no |\n');
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('needs-decide');
      expect(c.summary).toMatch(/FR-5 \(unknown\)/);
    });

    it('ignores ACCEPTED rows (human-approved divergence does not block)', async () => {
      await writeAudit('| FR-3 | DIVERGED | intended-drift | baz.ts:88 | ACCEPTED |\n');
      const c = await classifyPrdAuditGaps(dir, undefined);
      expect(c.kind).toBe('clean');
    });

    it('ignores a stale report (mtime predates the session)', async () => {
      await writeAudit('| FR-2 | MISSING | impl-gap | x | no |\n');
      const past = new Date(2000, 0, 1);
      await utimes(join(dir, '.pipeline/prd-audit.md'), past, past);
      // Session started "now" → the 2000 file is stale and ignored.
      const c = await classifyPrdAuditGaps(dir, Date.now());
      expect(c.kind).toBe('clean');
    });
  });
});
