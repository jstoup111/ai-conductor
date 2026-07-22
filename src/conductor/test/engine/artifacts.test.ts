import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execa } from 'execa';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the real readStaleHaltTitle for use in spy implementation
import { readStaleHaltTitle as realReadStaleHaltTitle } from '../../src/engine/halt-pr-rehabilitation.js';

// Spy target for the finish predicate's Phase 2 presentation check
// (readStaleHaltTitle, invoked with a gh runner). Mocked so tests can assert
// it is never reached when a Phase 1 evidence condition (e.g. push
// verification) already failed the gate. Default behavior returns null (fail-open);
// tests can override via mockImplementation to call the real implementation.
const readStaleHaltTitleSpy = vi.fn(async () => null);
// Spy target for the finish predicate's Phase 2 presentation banner check
// (readStaleHaltBanner, invoked with a gh runner). Default behavior returns
// null (fail-open); tests override via mockImplementation to call the real logic.
const readStaleHaltBannerSpy = vi.fn(async () => null);
vi.mock('../../src/engine/halt-pr-rehabilitation.js', () => ({
  readStaleHaltTitle: (...args: unknown[]) => readStaleHaltTitleSpy(...args),
  readStaleHaltBanner: (...args: unknown[]) => readStaleHaltBannerSpy(...args),
}));

import {
  STEP_ARTIFACT_GLOBS,
  findArtifactFiles,
  stepHasArtifacts,
  getArtifactStatus,
  checkStepCompletion,
  isStoriesApproved,
  classifyPrdAuditGaps,
  classifyRetryDecision,
  sweepStaleReviewArtifacts,
  FINISH_CHOICE_MARKER,
  HALT_MARKER,
  planStem,
  planHasDependencyTree,
  validateBuildReviewVerdict,
  isSkipAttempt,
  MANUAL_TEST_SKIP_SENTINEL,
  readManualTestFailRows,
  stampCode,
} from '../../src/engine/artifacts.js';
import type { CompletionResult, CompletionContext } from '../../src/engine/artifacts.js';

describe('engine/artifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
    readStaleHaltTitleSpy.mockClear();
    readStaleHaltBannerSpy.mockClear();
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
      expect(await stepHasArtifacts(dir, 'prd')).toBe(false);
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

    // The gate also requires RED execution evidence (the specs actually ran and
    // failed). These glob tests assert file-discovery, so seed valid evidence.
    async function seedRedEvidence() {
      await createFile(
        '.pipeline/acceptance-specs-red.json',
        JSON.stringify({
          command: 'bundle exec rspec api/spec && npm --prefix frontend test',
          targetSpecs: ['api/spec/integration/household_invite_spec.rb'],
          executed: 3,
          passed: 0,
          failed: 3,
          skipped: 0,
          errors: 0,
        }),
      );
    }

    it('false-fails on a monorepo layout when no config globs are declared', async () => {
      await seedMonorepoSpecs();
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
    });

    it('passes once the project declares package-prefix globs via config', async () => {
      await seedMonorepoSpecs();
      await seedRedEvidence();
      const result = await checkStepCompletion(dir, 'acceptance_specs', {
        config: { acceptance_spec_globs: ['*/spec/**/*', '*/__tests__/**/*'] },
      });
      expect(result).toEqual({ done: true });
    });

    it('honors a literal package prefix (no wildcard) in config globs too', async () => {
      await seedMonorepoSpecs();
      await seedRedEvidence();
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

  describe('checkStepCompletion: acceptance_specs (RED execution evidence)', () => {
    // The feature's own acceptance specs must actually RUN and FAIL. A generated
    // spec that is never executed — skipped for a missing testcontainer, or left
    // out of a unit-only test scope — must NOT satisfy the gate (regression: a
    // daemon-built PR whose own acceptance specs then failed in CI).
    const EV = '.pipeline/acceptance-specs-red.json';
    const validEvidence = {
      command: 'pytest spec/integration/test_x.py',
      targetSpecs: ['spec/integration/test_x.py'],
      executed: 3,
      passed: 0,
      failed: 3,
      skipped: 0,
      errors: 0,
    };

    it('fails when spec files exist but no RED evidence was recorded', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/is missing/i);
    });

    it('passes when the specs actually ran and failed (valid RED evidence)', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, JSON.stringify(validEvidence));
      expect(await checkStepCompletion(dir, 'acceptance_specs')).toEqual({ done: true });
    });

    it('fails when the specs were SKIPPED (skipped > 0)', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, JSON.stringify({ ...validEvidence, failed: 0, skipped: 3 }));
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/SKIPPED/i);
    });

    it('fails when RED is not established (0 failed)', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, JSON.stringify({ ...validEvidence, failed: 0, passed: 3 }));
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/0 failed|RED not established/i);
    });

    it('fails when the specs errored at collection (errors > 0)', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, JSON.stringify({ ...validEvidence, errors: 1 }));
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/errored at collection/i);
    });

    it('fails when nothing executed (executed = 0)', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, JSON.stringify({ ...validEvidence, executed: 0, failed: 0 }));
      expect((await checkStepCompletion(dir, 'acceptance_specs')).done).toBe(false);
    });

    it('fails on malformed evidence JSON', async () => {
      await createFile('spec/acceptance/x_spec.rb', 'x');
      await createFile(EV, 'not json');
      const result = await checkStepCompletion(dir, 'acceptance_specs');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/invalid JSON/i);
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
      expect(result.missing).toBe('recording');
    });

    it('fails when state.pr_url is set but finish-choice marker is missing', async () => {
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/finish-choice/);
      expect(result.missing).toBe('recording');
    });

    it('fails when neither pr_url nor finish-choice exists', async () => {
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/finish-choice/);
      expect(result.missing).toBe('recording');
    });

    it('fails when finish-choice contains an unrecognized value', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'maybe');
      const result = await checkStepCompletion(dir, 'finish');
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/unrecognized/);
      expect(result.missing).toBe('recording');
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
      expect(result.missing).toBe('recording');
    });

    it('rejects finish-choice="keep" when running in daemon mode', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'keep');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: true,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/keep/);
      expect(result.reason).toMatch(/daemon/i);
      expect(result.missing).toBe('other');
    });

    it('rejects finish-choice="merge-local" when running in daemon mode', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'merge-local');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: true,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/merge-local/);
      expect(result.reason).toMatch(/daemon/i);
    });

    it('rejects finish-choice="discard" when running in daemon mode', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'discard');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: true,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/discard/);
      expect(result.reason).toMatch(/daemon/i);
    });

    it('allows finish-choice="keep" in interactive mode (daemon: false)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'keep');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: false,
      });
      expect(result).toEqual({ done: true });
    });

    it('allows finish-choice="merge-local" in interactive mode (daemon: false)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'merge-local');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: false,
      });
      expect(result).toEqual({ done: true });
    });

    it('allows finish-choice="keep" when daemon property is absent (legacy interactive mode)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'keep');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        // daemon not set
      });
      expect(result).toEqual({ done: true });
    });

    it('allows finish-choice="pr" in daemon mode (pr is safe to ship autonomously)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        daemon: true,
      });
      expect(result).toEqual({ done: true });
    });

    it('passes when finish-choice="pr" and isHeadPushed returns true (happy path: evidence pass)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
      });
      expect(result).toEqual({ done: true });
    });

    it('fails when finish-choice="pr" and isHeadPushed returns false (evidence check)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => false,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/push|push evidence|refs\/remotes/i);
    });

    it('two-phase ordering: does not invoke the presentation (gh) check when push evidence fails', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => false,
      });
      expect(result.done).toBe(false);
      expect(readStaleHaltTitleSpy).not.toHaveBeenCalled();
    });

    it('fails when finish-choice="pr" and isHeadPushed returns null (indeterminate evidence)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => null,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/indeterminate|cannot verify/i);
    });

    it('passes when finish-choice="pr" and isHeadPushed injectable is absent (fail-open legacy)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        // isHeadPushed is undefined/absent
      });
      expect(result).toEqual({ done: true });
    });

    it('ignores isHeadPushed for non-PR choices (e.g., keep)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'keep');
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => false, // Would fail for PR, but ignored for keep
      });
      expect(result).toEqual({ done: true });
    });

    it('fails when finish-choice="pr" and isHeadPushed throws an error (corrupt repo)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: 'https://github.com/foo/bar/pull/1' }),
      );
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => {
          throw new Error('corrupt repo: .git/refs corrupted');
        },
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/push evidence check failed/i);
      expect(result.reason).toMatch(/corrupt repo/i);
    });

    it('Phase 2 presentation: fails when fakeGh returns a needs-remediation-titled PR (through-the-gate stale title check)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that returns a PR with a needs-remediation: title
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              title: 'needs-remediation: fix the build',
            }),
          };
        }
        return { stdout: '{}' };
      };
      // Configure the spy to use the fake gh runner and implement the real logic
      readStaleHaltTitleSpy.mockImplementation(async (gh, cwd, prUrl) => {
        try {
          const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title'], { cwd });
          const title = String((JSON.parse(stdout || '{}') as { title?: unknown }).title ?? '');
          return title.startsWith('needs-remediation:') ? title : null;
        } catch {
          return null;
        }
      });
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      readStaleHaltTitleSpy.mockClear();
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/needs-remediation:/);
      expect(result.reason).toMatch(/rewrite the reused halt PR/i);
    });

    it('Phase 2 presentation: passes when fakeGh returns a clean ready PR (through-the-gate clean title check)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that returns a PR with a clean title (no needs-remediation prefix)
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              title: 'Clean feature title',
            }),
          };
        }
        return { stdout: '{}' };
      };
      // Configure the spy to use the fake gh runner and implement the real logic
      readStaleHaltTitleSpy.mockImplementation(async (gh, cwd, prUrl) => {
        try {
          const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title'], { cwd });
          const title = String((JSON.parse(stdout || '{}') as { title?: unknown }).title ?? '');
          return title.startsWith('needs-remediation:') ? title : null;
        } catch {
          return null;
        }
      });
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      readStaleHaltTitleSpy.mockClear();
      expect(result).toEqual({ done: true });
    });

    it('Phase 2 presentation: fails when fakeGh returns a PR body containing the halt banner (through-the-gate stale banner check)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('title')) {
          return { stdout: JSON.stringify({ title: 'Clean feature title' }) };
        }
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('body')) {
          return {
            stdout: JSON.stringify({
              body: 'This PR was opened automatically after an irrecoverable daemon HALT.\n\nManual remediation is required to unblock this feature.',
            }),
          };
        }
        return { stdout: '{}' };
      };
      readStaleHaltBannerSpy.mockImplementation(async (gh, cwd, prUrlArg) => {
        try {
          const { stdout } = await gh(['pr', 'view', prUrlArg, '--json', 'body'], { cwd });
          const body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
          const sentinel = 'This PR was opened automatically after an irrecoverable daemon HALT.';
          return body.includes(sentinel) ? sentinel : null;
        } catch {
          return null;
        }
      });
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      readStaleHaltBannerSpy.mockClear();
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(new RegExp(prUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      expect(result.reason).toMatch(/halt banner/i);
    });

    it('Phase 2 presentation: passes when the banner-check gh read throws (fail-open, Story 2 negative path)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('title')) {
          return { stdout: JSON.stringify({ title: 'Clean feature title' }) };
        }
        return { stdout: '{}' };
      };
      readStaleHaltBannerSpy.mockImplementation(async () => {
        throw new Error('gh: network unreachable');
      });
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      readStaleHaltBannerSpy.mockClear();
      expect(result).toEqual({ done: true });
    });

    it('Phase 2 presentation: passes when fakeGh returns a clean body with no halt banner (through-the-gate clean banner check)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      const calls: string[][] = [];
      const fakeGh = async (args: string[]) => {
        calls.push(args);
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('title')) {
          return { stdout: JSON.stringify({ title: 'Clean feature title' }) };
        }
        if (args[0] === 'pr' && args[1] === 'view' && args.includes('body')) {
          return { stdout: JSON.stringify({ body: '## Summary\n\nImplemented the thing.' }) };
        }
        return { stdout: '{}' };
      };
      readStaleHaltBannerSpy.mockImplementation(async (gh, cwd, prUrlArg) => {
        try {
          const { stdout } = await gh(['pr', 'view', prUrlArg, '--json', 'body'], { cwd });
          const body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
          const sentinel = 'This PR was opened automatically after an irrecoverable daemon HALT.';
          return body.includes(sentinel) ? sentinel : null;
        } catch {
          return null;
        }
      });
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      readStaleHaltBannerSpy.mockClear();
      expect(result).toEqual({ done: true });
      expect(calls.every((c) => c[0] === 'pr' && c[1] === 'view')).toBe(true);
    });

    it('Story 3: Phase 2 presentation (isDraft): fails when fakeGh returns isDraft=true with clean title (ship-readiness check)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that returns a draft PR with clean title (no needs-remediation prefix)
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              title: 'Clean feature title',
              isDraft: true,
            }),
          };
        }
        return { stdout: '{}' };
      };
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/draft/i);
      expect(result.reason).toMatch(/ship-readiness/i);
      expect(result.missing).toBe('other');
    });

    it('Story 3: Phase 2 presentation (isDraft): passes when fakeGh returns isDraft=false with clean title (ready to ship)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that returns a ready (non-draft) PR with clean title
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: JSON.stringify({
              title: 'Clean feature title',
              isDraft: false,
            }),
          };
        }
        return { stdout: '{}' };
      };
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      expect(result).toEqual({ done: true });
    });
    it('Story 3: Phase 2 fail-open: passes when fakeGh throws during presentation check (gh error → logged warning)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that throws an error (network failure, auth error, etc.)
      const fakeGh = async (args: string[]) => {
        throw new Error('network error: connection refused');
      };
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      expect(result).toEqual({ done: true });
    });

    it('Story 3: Phase 2 fail-open: passes when fakeGh returns malformed JSON (unparseable → logged warning)', async () => {
      const prUrl = 'https://github.com/foo/bar/pull/1';
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      await createFile(
        '.pipeline/conduct-state.json',
        JSON.stringify({ pr_url: prUrl }),
      );
      // fakeGh that returns invalid JSON
      const fakeGh = async (args: string[]) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            stdout: 'not valid json {',
          };
        }
        return { stdout: '{}' };
      };
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      expect(result).toEqual({ done: true });
    });

    it('Story 3: Phase 1 short-circuit: fails at phase 1 when state lacks pr_url under choice="pr" (zero gh calls)', async () => {
      await createFile(FINISH_CHOICE_MARKER, 'pr');
      // No .pipeline/conduct-state.json with pr_url — should fail in Phase 1
      // and NEVER call the gh runner (short-circuit test)
      const ghCallCount = { count: 0 };
      const fakeGh = async (args: string[]) => {
        ghCallCount.count++;
        throw new Error('gh should not be called in this scenario');
      };
      const result = await checkStepCompletion(dir, 'finish', {
        sessionStartedAt: 0,
        isHeadPushed: async () => true,
        gh: fakeGh as any,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/pr_url/);
      expect(result.missing).toBe('recording');
      expect(ghCallCount.count).toBe(0); // Verify Phase 2 was never reached
    });

    describe('Task 8: order-gated repair invocation between phases', () => {
      it('happy path: repair invoked exactly once after phase 1 passes, before phase 2 gh.prView', async () => {
        const prUrl = 'https://github.com/foo/bar/pull/1';
        await createFile(FINISH_CHOICE_MARKER, 'pr');
        await createFile(
          '.pipeline/conduct-state.json',
          JSON.stringify({ pr_url: prUrl }),
        );

        const callLog: string[] = [];
        const repairFinishPr = vi.fn(async () => {
          callLog.push('repair');
        });

        const fakeGh = async (args: string[]) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            callLog.push('gh-prView');
          }
          return {
            stdout: JSON.stringify({
              title: 'Clean feature title',
              isDraft: false,
            }),
          };
        };

        const result = await checkStepCompletion(dir, 'finish', {
          sessionStartedAt: 0,
          isHeadPushed: async () => true,
          gh: fakeGh as any,
          repairFinishPr,
        });

        expect(result).toEqual({ done: true });
        expect(repairFinishPr).toHaveBeenCalledTimes(1);
        expect(repairFinishPr).toHaveBeenCalledWith(prUrl);
        // Verify repair was called before gh.prView (order check)
        const repairIndex = callLog.indexOf('repair');
        const ghIndex = callLog.indexOf('gh-prView');
        expect(repairIndex).toBeLessThan(ghIndex);
        expect(repairIndex).toBeGreaterThanOrEqual(0);
      });

      it('phase 1 miss: repair not invoked when pr_url missing', async () => {
        await createFile(FINISH_CHOICE_MARKER, 'pr');
        // No .pipeline/conduct-state.json with pr_url

        const repairFinishPr = vi.fn(async () => {
          throw new Error('repair should not be called');
        });

        const result = await checkStepCompletion(dir, 'finish', {
          sessionStartedAt: 0,
          isHeadPushed: async () => true,
          repairFinishPr,
        });

        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pr_url/);
        expect(repairFinishPr).not.toHaveBeenCalled();
      });

      it('phase 1 miss: repair not invoked when push verification fails', async () => {
        const prUrl = 'https://github.com/foo/bar/pull/1';
        await createFile(FINISH_CHOICE_MARKER, 'pr');
        await createFile(
          '.pipeline/conduct-state.json',
          JSON.stringify({ pr_url: prUrl }),
        );

        const repairFinishPr = vi.fn(async () => {
          throw new Error('repair should not be called');
        });

        const result = await checkStepCompletion(dir, 'finish', {
          sessionStartedAt: 0,
          isHeadPushed: async () => false,
          repairFinishPr,
        });

        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/push|push evidence/i);
        expect(repairFinishPr).not.toHaveBeenCalled();
      });

      it('repair throws: warning logged, predicate continues to phase 2', async () => {
        const prUrl = 'https://github.com/foo/bar/pull/1';
        await createFile(FINISH_CHOICE_MARKER, 'pr');
        await createFile(
          '.pipeline/conduct-state.json',
          JSON.stringify({ pr_url: prUrl }),
        );

        const repairError = new Error('repair failed: network error');
        const repairFinishPr = vi.fn(async () => {
          throw repairError;
        });

        const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const fakeGh = async (args: string[]) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            return {
              stdout: JSON.stringify({
                title: 'Clean feature title',
                isDraft: false,
              }),
            };
          }
          return { stdout: '{}' };
        };

        const result = await checkStepCompletion(dir, 'finish', {
          sessionStartedAt: 0,
          isHeadPushed: async () => true,
          gh: fakeGh as any,
          repairFinishPr,
        });

        expect(result).toEqual({ done: true });
        expect(repairFinishPr).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalled();
        const warningCall = logSpy.mock.calls.find((call) =>
          String(call[0]).includes('repair'),
        );
        expect(warningCall).toBeDefined();

        logSpy.mockRestore();
      });

      it('legacy mode: absent injectable, repair skipped, phase 2 runs as normal', async () => {
        const prUrl = 'https://github.com/foo/bar/pull/1';
        await createFile(FINISH_CHOICE_MARKER, 'pr');
        await createFile(
          '.pipeline/conduct-state.json',
          JSON.stringify({ pr_url: prUrl }),
        );

        const fakeGh = async (args: string[]) => {
          if (args[0] === 'pr' && args[1] === 'view') {
            return {
              stdout: JSON.stringify({
                title: 'Clean feature title',
                isDraft: false,
              }),
            };
          }
          return { stdout: '{}' };
        };

        const result = await checkStepCompletion(dir, 'finish', {
          sessionStartedAt: 0,
          isHeadPushed: async () => true,
          gh: fakeGh as any,
          // repairFinishPr is undefined (legacy)
        });

        expect(result).toEqual({ done: true });
      });
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

    // NEW TESTS: build predicate recomputes from seeded state + evidence
    describe('reworked build predicate: seed + derive', () => {
      async function writePlan(content: string) {
        await createFile('.docs/plans/phase-1.md', content);
      }

      async function writeTasks(tasks: Array<{ id: string; name?: string; status: string }>) {
        await createFile(
          '.pipeline/task-status.json',
          JSON.stringify({ tasks }),
        );
      }

      it('fails when plan is missing (context.planPath not found)', async () => {
        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/missing.md') };
        // Plan doesn't exist; task-status.json doesn't exist either
        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/plan|missing|unreadable/i);
      });

      it('fails when plan is empty (no tasks to seed)', async () => {
        await writePlan('# Empty Plan\n\nNo tasks defined.\n');
        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/empty|no tasks/i);
      });

      it('re-seeds .pipeline/task-status.json when deleted mid-run', async () => {
        // Use correct task header format: ### Task N: Title
        await writePlan('### Task 1: First task\n**Story:** 1\n\n### Task 2: Second task\n**Story:** 2\n');
        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

        // First check creates the seeded file. Task 10 (#773): the build
        // predicate is now purely structural (plan seeded + all planned
        // tasks present in task-status.json), but a freshly-seeded plan
        // with no completed/skipped rows yet is still pending — it still
        // requires task-status.json rows to actually be completed/skipped,
        // it just no longer cross-checks them against the evidence ledger.
        const result1 = await checkStepCompletion(dir, 'build', ctx);
        expect(result1.done).toBe(false);

        // Verify file was created
        const statusPath = join(dir, '.pipeline/task-status.json');
        const first = JSON.parse(await readFile(statusPath, 'utf-8'));
        expect(first.tasks).toBeDefined();
        expect(first.tasks.length).toBeGreaterThan(0);

        // Delete the file to simulate mid-run deletion
        await rm(statusPath);

        // Re-check should re-seed the file
        const result2 = await checkStepCompletion(dir, 'build', ctx);
        expect(result2.done).toBe(false); // re-seeded, still pending (no completed rows)

        // File should be recreated
        const second = JSON.parse(await readFile(statusPath, 'utf-8'));
        expect(second.tasks).toBeDefined();
        expect(second.tasks.length).toBe(first.tasks.length);
      });

      it('rebuilds corrupt JSON in task-status.json', async () => {
        await writePlan('### Task 1: Task one\n**Story:** 1\n');
        const statusPath = join(dir, '.pipeline/task-status.json');

        // Write corrupt JSON
        await mkdir(dirname(statusPath), { recursive: true });
        await writeFile(statusPath, 'not valid json {');

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

        // Predicate should handle corrupt JSON gracefully and rebuild
        // (still pending — a freshly-reseeded plan has no completed rows).
        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result.done).toBe(false);

        // File should be rebuilt (valid JSON)
        const rebuilt = JSON.parse(await readFile(statusPath, 'utf-8'));
        expect(rebuilt.tasks).toBeDefined();
        expect(Array.isArray(rebuilt.tasks)).toBe(true);
      });

      it('fails with pending tasks (seeded state has pending)', async () => {
        await writePlan('### Task 1: Task one\n**Story:** 1\n\n### Task 2: Task two\n**Story:** 2\n');

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        // After seeding, both tasks are pending (no completed rows yet).
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pending|not completed/i);
      });

      // Task 10 (#773): the build predicate demotes the per-task
      // evidence-ledger gate (deriveCompletion/createTaskEvidence/
      // evidenceStamps) to telemetry. It still trusts task-status.json row
      // status (completed/skipped), exactly like the legacy no-context
      // fallback always has — but it no longer cross-checks that status
      // against an independently re-derived evidence sidecar. The old
      // "forged completed row with no evidenceStamps entry" anti-forgery
      // check is retired: a 'completed' row with NO evidence sidecar at all
      // now passes, since build_review's completeness rubric is what
      // actually judges the real diff on every pass.
      it('passes on a forged-looking completed row with no evidence sidecar at all (anti-forgery check retired)', async () => {
        await writePlan('### Task 1: Task one\n**Story:** 1\n\n### Task 2: Task two\n**Story:** 2\n');
        await writeTasks([
          { id: '1', name: 'Task 1', status: 'completed' },
          { id: '2', name: 'Task 2', status: 'completed' },
        ]);

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result).toEqual({ done: true });
      });

      it('loads a legacy sidecar with migrationGrandfather without error (backward-compat load)', async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/task-evidence.json'),
          JSON.stringify({
            evidenceStamps: {},
            noEvidenceAttempts: 0,
            migrationGrandfather: ['2', '4'],
          }),
        );

        const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
        const evidence = await createTaskEvidence(dir);

        expect(evidence.migrationGrandfather.has('2')).toBe(true);
        expect(evidence.migrationGrandfather.has('4')).toBe(true);
      });

      // Task 10 (#773): a real evidenceStamps entry in the sidecar no
      // longer overrides — or is even consulted alongside — a 'pending' row
      // status. The predicate never reads the evidence sidecar at all now;
      // only the task-status.json row status governs.
      it('ignores the evidence sidecar entirely: a real evidence stamp does not override a pending row', async () => {
        await writePlan('### Task 2: Task two\n**Story:** 2\n');
        await writeTasks([{ id: '2', name: 'Task two', status: 'pending' }]);
        await writeFile(
          join(dir, '.pipeline/task-evidence.json'),
          JSON.stringify({
            evidenceStamps: { '2': { sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', form: 'trailer' } },
            noEvidenceAttempts: 0,
            migrationGrandfather: [],
          }),
        );

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);

        expect(result.done).toBe(false);
      });

      // Regression (Task 10, #773): a task implemented via a real commit
      // AND explicitly marked 'completed' in task-status.json keeps passing
      // the build predicate even with NO evidence sidecar present at all —
      // the predicate no longer calls deriveCompletion/createTaskEvidence,
      // so it never reads or writes `.pipeline/task-evidence.json`. Real
      // commit evidence is no longer this gate's concern; it is now
      // build_review's completeness rubric that judges actual completion.
      it('passes on a structurally-seeded plan with a real commit and a completed row, without ever touching the evidence sidecar', async () => {
        await execa('git', ['init', '-b', 'main'], { cwd: dir });
        await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
        await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
        await writeFile(join(dir, 'README.md'), '# Test\n');
        await execa('git', ['add', 'README.md'], { cwd: dir });
        await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

        const bareDir = await mkdtemp(join(tmpdir(), 'artifacts-origin-'));
        await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
        await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });
        await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

        await writePlan('### Task 1: Real task\n**Story:** 1\nContent with `src/real.ts`\n');
        await execa('git', ['add', '.docs/plans/phase-1.md'], { cwd: dir });
        await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

        // A real commit implementing the task, but with NO Task: N trailer
        // and no evidence sidecar — build_review (not this predicate) is
        // what judges whether the diff is actually complete.
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src/real.ts'), 'export const real = true;\n');
        await execa('git', ['add', 'src/real.ts'], { cwd: dir });
        await execa('git', ['commit', '-m', 'feat: implement real task'], { cwd: dir });

        // Mark the row completed directly — nothing in this predicate's
        // code path does this derivation anymore (that's conductor.ts's
        // own auto-heal call, exercised separately in gate-loop.test.ts).
        await writeTasks([{ id: '1', name: 'Real task', status: 'completed' }]);

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result).toEqual({ done: true });

        // No evidence sidecar should have been created/consulted by this
        // predicate — seedTaskStatus's own defensive sidecar init happened,
        // but its contents are irrelevant to the verdict above.
        const sidecarPath = join(dir, '.pipeline/task-evidence.json');
        const sidecar = JSON.parse(await readFile(sidecarPath, 'utf-8').catch(() => '{"evidenceStamps":{}}'));
        expect(sidecar.evidenceStamps['1']).toBeUndefined();

        await rm(bareDir, { recursive: true, force: true });
      });

      // Regression tests (Task 3): em-dash plan parser—prevent false-positive empty-plan auto-park
      describe('regression: em-dash headings (### Task N — Title) are not false-positives for empty-plan', () => {
        it('Story 1: Em-dash plan with evidence is "done", not "empty"', async () => {
          // Setup: git repo with initial commit
          await execa('git', ['init', '-b', 'main'], { cwd: dir });
          await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
          await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
          await writeFile(join(dir, 'README.md'), '# Test\n');
          await execa('git', ['add', 'README.md'], { cwd: dir });
          await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

          // Setup: bare "origin" so plan + work commits are ahead
          const bareDir = await mkdtemp(join(tmpdir(), 'artifacts-emdash-origin-'));
          await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
          await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });
          await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

          // Seed plan with EM-DASH task headings: "### Task N — Title"
          // (not colon separator, which would be ### Task N: Title)
          await writePlan(
            '# Implementation Plan: Em-dash Test\n\n' +
            '### Task 1 — First em-dash task\n' +
            '**Story:** 1\n' +
            'Content mentioning `src/task1.ts`\n\n' +
            '### Task 2 — Second em-dash task\n' +
            '**Story:** 2\n' +
            'Content mentioning `src/task2.ts`\n',
          );
          await execa('git', ['add', '.docs/plans/phase-1.md'], { cwd: dir });
          await execa('git', ['commit', '-m', 'docs: add em-dash plan'], { cwd: dir });

          // Seed real commits with evidence (Task: N trailers + corroborating paths)
          await mkdir(join(dir, 'src'), { recursive: true });

          await writeFile(join(dir, 'src/task1.ts'), 'export const task1 = true;\n');
          await execa('git', ['add', 'src/task1.ts'], { cwd: dir });
          await execa('git', ['commit', '-m', 'feat: implement task 1\n\nTask: 1\n'], { cwd: dir });

          await writeFile(join(dir, 'src/task2.ts'), 'export const task2 = true;\n');
          await execa('git', ['add', 'src/task2.ts'], { cwd: dir });
          await execa('git', ['commit', '-m', 'feat: implement task 2\n\nTask: 2\n'], { cwd: dir });

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

          // Main assertion: the em-dash plan is recognized as non-empty (it
          // may still report "pending" — Task 10 (#773) retired this
          // predicate's own git-trailer-derived auto-completion, so a real
          // commit alone no longer flips a row to 'completed' here).
          const result = await checkStepCompletion(dir, 'build', ctx);

          // Verify it does NOT report empty-plan or no-tasks-in-plan reason
          if (!result.done && result.reason) {
            expect(result.reason).not.toMatch(/empty|no tasks in plan|plan is empty/i);
          }

          await rm(bareDir, { recursive: true, force: true });
        });

        it('Story 2: Task-less plan (no Task headings) still triggers empty-plan reason', async () => {
          // Seed a plan file with NO task headings — just prose
          await writePlan(
            '# Implementation Plan: Task-less Document\n\n' +
            'This is a prose-only plan with no ### Task N headings.\n' +
            'It should be treated as an empty plan for gating purposes.\n' +
            'The PLAN artifact exists on disk but defines zero tasks.\n',
          );

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

          // Main assertion: task-less plan should FAIL the gate
          const result = await checkStepCompletion(dir, 'build', ctx);
          expect(result.done).toBe(false);

          // Verify the reason mentions empty-plan trigger
          expect(result.reason).toMatch(/empty|no tasks in plan|plan is empty/i);
        });
      });

      // Regression (#578 live-fire follow-up, 2026-07-12): a real build
      // (`2026-07-12-rtk-hook-preservation`) used `### T0 — Title` shorthand
      // headers (no literal "Task" word, ids start at T0 not T1). The
      // already-shipped em-dash fix (Task 1/#590) still requires the literal
      // word "Task" before the id, so this plan parsed to zero task ids and
      // the daemon auto-parked a fully-completed 5/5 build as "empty/missing
      // plan". Uses the actual incident plan file as a fixture.
      describe('regression: bare "T<N>" shorthand headings (### T0 — Title) are not false-positives for empty-plan', () => {
        it('Story 1: T-prefix plan (headers start at T0, no "Task" word) with evidence is "done", not "empty"', async () => {
          await execa('git', ['init', '-b', 'main'], { cwd: dir });
          await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
          await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
          await writeFile(join(dir, 'README.md'), '# Test\n');
          await execa('git', ['add', 'README.md'], { cwd: dir });
          await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

          const bareDir = await mkdtemp(join(tmpdir(), 'artifacts-tprefix-origin-'));
          await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
          await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });
          await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

          // Mirrors the real incident plan's authoring convention:
          // `### T0 — Title` (no "Task" word, starts at T0 not T1).
          await writePlan(
            '# Implementation Plan: T-prefix Test\n\n' +
            '### T0 — First T-prefix task\n' +
            '**Story:** 1\n' +
            '**Files:** `src/t0.ts`\n\n' +
            '### T1 — Second T-prefix task\n' +
            '**Story:** 2\n' +
            '**Files:** `src/t1.ts`\n',
          );
          await execa('git', ['add', '.docs/plans/phase-1.md'], { cwd: dir });
          await execa('git', ['commit', '-m', 'docs: add T-prefix plan'], { cwd: dir });

          await mkdir(join(dir, 'src'), { recursive: true });
          await writeFile(join(dir, 'src/t0.ts'), 'export const t0 = true;\n');
          await execa('git', ['add', 'src/t0.ts'], { cwd: dir });
          await execa('git', ['commit', '-m', 'feat: implement T0\n\nTask: 0\n'], { cwd: dir });

          await writeFile(join(dir, 'src/t1.ts'), 'export const t1 = true;\n');
          await execa('git', ['add', 'src/t1.ts'], { cwd: dir });
          await execa('git', ['commit', '-m', 'feat: implement T1\n\nTask: 1\n'], { cwd: dir });

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

          const result = await checkStepCompletion(dir, 'build', ctx);

          if (!result.done && result.reason) {
            expect(result.reason).not.toMatch(/empty|no tasks in plan|plan is empty/i);
          }

          await rm(bareDir, { recursive: true, force: true });
        });

        it('Story 2: real 2026-07-12-rtk-hook-preservation.md incident fixture is not "no tasks in plan" (presence gate)', async () => {
          // The presence-check gate (artifacts.ts) must recognize the real
          // incident plan as non-empty, independent of evidence/completion.
          const fixturePath = join(
            __dirname,
            '../../../../.docs/plans/2026-07-12-rtk-hook-preservation.md',
          );
          const fixtureText = await readFile(fixturePath, 'utf-8');
          await writePlan(fixtureText);

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
          const result = await checkStepCompletion(dir, 'build', ctx);

          // Must not be the empty/missing-plan false-positive (may still be
          // "pending" since there's no evidence in this test — that's fine).
          if (!result.done && result.reason) {
            expect(result.reason).not.toMatch(/no tasks in plan|plan is empty or contains no tasks/i);
          }
        });
      });

      // Regression (#620): #615's widened presence-gate regex
      // (`Task\s+[A-Za-z0-9._-]+`) accepts any word as an "id" with no
      // terminator requirement, so a structural heading like `## Task Graph`
      // or `## Task Dependency Graph` — present in many committed plans,
      // e.g. .docs/plans/2026-06-30-engineer-worktree-isolation.md — is
      // misread as evidence the plan has a real task. Downstream, the same
      // over-wide id grammar in parsePlanTaskPaths/parsePlanTasks seeds a
      // phantom task ("Graph"/"Dependency") that can never be completed,
      // making build completion permanently unsatisfiable.
      describe('regression #620: structural "## Task Graph" / "## Task Dependency Graph" headings are not real task presence', () => {
        it('a plan with ONLY a "## Task Graph" heading (no real ### Task N) is still "empty"', async () => {
          await writePlan(
            '# Implementation Plan: Graph-only\n\n' +
            '## Task Graph\n\n' +
            'Task 1 -> Task 2\n',
          );

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
          const result = await checkStepCompletion(dir, 'build', ctx);

          expect(result.done).toBe(false);
          expect(result.reason).toMatch(/empty|no tasks in plan|plan is empty/i);
        });

        it('a plan with ONLY a "## Task Dependency Graph" heading (no real ### Task N) is still "empty"', async () => {
          await writePlan(
            '# Implementation Plan: Dependency-graph-only\n\n' +
            '## Task Dependency Graph\n\n' +
            'Task 1 -> Task 2\n',
          );

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
          const result = await checkStepCompletion(dir, 'build', ctx);

          expect(result.done).toBe(false);
          expect(result.reason).toMatch(/empty|no tasks in plan|plan is empty/i);
        });

        it('a plan with real ### Task N headings PLUS a "## Task Dependency Graph" section still recognizes real task presence', async () => {
          await writePlan(
            '# Implementation Plan: Real-plus-graph\n\n' +
            '### Task 1: Real work\n' +
            '**Files:** `src/real.ts`\n\n' +
            '## Task Dependency Graph\n\n' +
            'Task 1 -> done\n',
          );

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
          const result = await checkStepCompletion(dir, 'build', ctx);

          // Not the empty/missing-plan false-negative; may still be
          // "pending" for lack of git evidence in this test.
          if (!result.done && result.reason) {
            expect(result.reason).not.toMatch(/no tasks in plan|plan is empty or contains no tasks/i);
          }
        });

        it('#620 guard: bare title-less headers with a digit in the id ("### Task 1", "### Task t1") still count as task presence', async () => {
          // The #620 tightening must only reject DIGITLESS bare ids
          // (Graph/Breakdown/Dependency), never the widely-used bare
          // title-less shapes whose ids contain a digit.
          await writePlan(
            '# Implementation Plan: Bare digit headers\n\n' +
            '### Task 1\n' +
            '**Files:** `src/a.ts`\n\n' +
            '### Task t2\n' +
            '**Files:** `src/b.ts`\n',
          );

          const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
          const result = await checkStepCompletion(dir, 'build', ctx);

          if (!result.done && result.reason) {
            expect(result.reason).not.toMatch(/no tasks in plan|plan is empty or contains no tasks/i);
          }
        });
      });
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

  describe('isSkipAttempt', () => {
    it('is true when the section contains the manual-test SKIP sentinel', () => {
      const section =
        '<!-- manual-test:skipped -->\n**Result:** SKIPPED — no endpoint/UI stories';
      expect(isSkipAttempt(section)).toBe(true);
    });

    it('is false for a normal PASS/FAIL table section', () => {
      const section = '| Story | Result |\n|---|---|\n| Foo | PASS |\n| Bar | FAIL |\n';
      expect(isSkipAttempt(section)).toBe(false);
    });
  });

  describe('checkStepCompletion: manual_test whitewash guard + attempt sections (#367)', () => {
    const RESULTS = '.pipeline/manual-test-results.md';
    const MARKER = '.pipeline/manual-test-fail-evidence.json';
    const FAIL_FILE = '| Story | Result |\n|---|---|\n| Foo | PASS |\n| Bar | FAIL |\n';
    const PASS_FILE = '| Story | Result |\n|---|---|\n| Foo | PASS |\n| Bar | PASS |\n';
    const sha = (s: string) => async () => s;

    it('observing FAIL rows records fail evidence (HEAD sha + excerpt) and still fails', async () => {
      await createFile(RESULTS, FAIL_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('aaa111'),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/FAIL/);
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf-8'));
      expect(marker.headSha).toBe('aaa111');
      expect(marker.failRows.join('\n')).toMatch(/Bar.*FAIL/);
      expect(typeof marker.observedAt).toBe('number');
    });

    it('refuses a FAIL→PASS flip when HEAD has not moved since the recorded FAIL', async () => {
      await createFile(RESULTS, FAIL_FILE);
      await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0, getHeadSha: sha('aaa111') });
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('aaa111'),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/no new commits|whitewash/i);
    });

    it('accepts a FAIL→PASS flip once HEAD moved, and clears the marker', async () => {
      await createFile(RESULTS, FAIL_FILE);
      await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0, getHeadSha: sha('aaa111') });
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('bbb222'),
      });
      expect(result).toEqual({ done: true });
      // The whitewash-guard fields (headSha/observedAt/failRows) are cleared —
      // codeStamp is additive PASS-path telemetry (#817) written afterward, so
      // the marker file itself may still exist carrying only codeStamp.
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf-8'));
      expect(marker.headSha).toBeUndefined();
      expect(marker.failRows).toBeUndefined();
    });

    it('ignores (and cleans up) a fail-evidence marker from a previous session', async () => {
      await createFile(
        MARKER,
        JSON.stringify({ observedAt: Date.now() - 120_000, headSha: 'aaa111', failRows: ['| Bar | FAIL |'] }),
      );
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: Date.now() - 1_000,
        getHeadSha: sha('aaa111'),
      });
      expect(result).toEqual({ done: true });
      // The stale whitewash-guard fields are cleared — codeStamp is additive
      // PASS-path telemetry (#817) written afterward, so the marker file
      // itself may still exist carrying only codeStamp.
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf-8'));
      expect(marker.headSha).toBeUndefined();
      expect(marker.failRows).toBeUndefined();
    });

    it('fails open when no getHeadSha seam is provided (pre-change behavior preserved)', async () => {
      await createFile(
        MARKER,
        JSON.stringify({ observedAt: Date.now(), headSha: 'aaa111', failRows: [] }),
      );
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result).toEqual({ done: true });
    });

    it('fails open when getHeadSha returns null (no repo)', async () => {
      await createFile(
        MARKER,
        JSON.stringify({ observedAt: Date.now(), headSha: 'aaa111', failRows: [] }),
      );
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: async () => null,
      });
      expect(result).toEqual({ done: true });
    });

    it('evaluates only the LATEST attempt section: old FAIL + new clean attempt passes', async () => {
      await createFile(
        RESULTS,
        '# Manual Test Results\n\n## Attempt 1 — 2026-07-06T10:00:00Z\n\n| Story | Result |\n|---|---|\n| Bar | FAIL |\n\n## Attempt 2 — 2026-07-06T10:30:00Z\n\n| Story | Result |\n|---|---|\n| Bar | PASS |\n',
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result).toEqual({ done: true });
    });

    it('fails when the LATEST attempt section contains FAIL rows even if an earlier one was clean', async () => {
      await createFile(
        RESULTS,
        '## Attempt 1 — 2026-07-06T10:00:00Z\n\n| Bar | PASS |\n\n## Attempt 2 — 2026-07-06T10:30:00Z\n\n| Bar | FAIL |\n',
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/FAIL/);
    });

    it('passes when only the Story/Notes text contains the substring "FAIL" but the Result cell is SKIP (no false-positive whitewash)', async () => {
      await createFile(
        RESULTS,
        '## Attempt 1 — 2026-07-06T10:00:00Z\n\n' +
          '| Story | Criterion | Result | Notes |\n|---|---|---|---|\n' +
          '| FAIL kicks back to build with evidence | N/A | SKIP | engine-internal |\n' +
          '| fail-closed verdict predicate | N/A | SKIP | engine-internal |\n',
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result).toEqual({ done: true });
    });

    it('passes when the latest attempt is a fresh SKIP sentinel (auto mode, no stories to exercise)', async () => {
      await createFile(
        RESULTS,
        `## Attempt 1 — 2026-07-21T00:00:00Z\n${MANUAL_TEST_SKIP_SENTINEL}\n`,
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result).toEqual({ done: true });
    });

    it('passes when an earlier attempt was PASS but the LATEST attempt is a SKIP sentinel', async () => {
      await createFile(
        RESULTS,
        '## Attempt 1 — 2026-07-21T00:00:00Z\n' +
          '| Story | Result |\n|---|---|\n| Foo | PASS |\n' +
          `## Attempt 2 — 2026-07-21T00:01:00Z\n${MANUAL_TEST_SKIP_SENTINEL}\n`,
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result).toEqual({ done: true });
    });

    it('fails when the latest attempt is a SKIP sentinel but the file is stale (mtime predates sessionStartedAt)', async () => {
      await createFile(
        RESULTS,
        `## Attempt 1 — 2026-07-20T00:00:00Z\n${MANUAL_TEST_SKIP_SENTINEL}\n`,
      );
      const past = new Date(Date.now() - 60_000);
      await utimes(join(dir, RESULTS), past, past);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: Date.now(),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/stale/i);
    });

    it('fails when the latest attempt contains both a SKIP sentinel and a FAIL row — FAIL wins', async () => {
      await createFile(
        RESULTS,
        `## Attempt 1 — 2026-07-21T00:00:00Z\n${MANUAL_TEST_SKIP_SENTINEL}\n\n` +
          '| Story | Result |\n|---|---|\n| Bar | FAIL |\n',
      );
      const result = await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0 });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/FAIL/);
    });

    it('a later fresh SKIP attempt cannot launder a FAIL recorded earlier at the same HEAD sha', async () => {
      // Attempt 1 records a real FAIL — this writes the fail-evidence marker
      // (headSha: aaa111).
      await createFile(RESULTS, FAIL_FILE);
      const firstResult = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('aaa111'),
      });
      expect(firstResult.done).toBe(false);

      // Attempt 2 is appended as a fresh SKIP section — HEAD has NOT moved
      // (no fix commits), so this must not launder the recorded FAIL.
      await createFile(
        RESULTS,
        FAIL_FILE + `\n## Attempt 2 — 2026-07-21T00:01:00Z\n${MANUAL_TEST_SKIP_SENTINEL}\n`,
      );
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('aaa111'),
      });
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/whitewash|no new commits/i);

      // The FAIL rows from attempt 1 must remain readable so the
      // manual_test→build kickback path still has concrete bug evidence.
      const failRows = await readManualTestFailRows(dir);
      expect(failRows.join('\n')).toMatch(/Bar.*FAIL/);
    });
  });

  describe('checkStepCompletion: manual_test codeStamp (gate-code-validity, #817)', () => {
    const RESULTS = '.pipeline/manual-test-results.md';
    const MARKER = '.pipeline/manual-test-fail-evidence.json';
    const PASS_FILE = '| Story | Result |\n|---|---|\n| Foo | PASS |\n';
    const sha = (s: string) => async () => s;

    it('on a clean PASS-path completion, writes codeStamp equal to the current head sha', async () => {
      await createFile(RESULTS, PASS_FILE);
      const result = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('ccc333'),
      });
      expect(result).toEqual({ done: true });
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf-8'));
      expect(marker.codeStamp).toBe('ccc333');
    });

    it('does not disturb the pre-existing FAIL→PASS headSha whitewash guard', async () => {
      const FAIL_FILE = '| Story | Result |\n|---|---|\n| Bar | FAIL |\n';
      await createFile(RESULTS, FAIL_FILE);
      await checkStepCompletion(dir, 'manual_test', { sessionStartedAt: 0, getHeadSha: sha('aaa111') });
      await createFile(RESULTS, PASS_FILE);
      // HEAD has not moved — the guard must still block, same as before this change.
      const blocked = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('aaa111'),
      });
      expect(blocked.done).toBe(false);
      expect(blocked.reason).toMatch(/no new commits|whitewash/i);

      // HEAD moves — the guard still allows the flip, and codeStamp is recorded too.
      const allowed = await checkStepCompletion(dir, 'manual_test', {
        sessionStartedAt: 0,
        getHeadSha: sha('bbb222'),
      });
      expect(allowed).toEqual({ done: true });
      const marker = JSON.parse(await readFile(join(dir, MARKER), 'utf-8'));
      expect(marker.codeStamp).toBe('bbb222');
      expect(marker.headSha).toBeUndefined();
    });
  });

  describe('checkStepCompletion: prd_audit codeStamp sidecar (gate-code-validity, #817)', () => {
    const SIDECAR = '.pipeline/prd-audit-code-stamp.json';
    const header = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n';

    it('on true completion, writes a sidecar carrying codeStamp equal to the current head sha', async () => {
      await createFile('.pipeline/prd-audit.md', '# PRD Audit\n\n' + header + '| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n');
      const result = await checkStepCompletion(dir, 'prd_audit', {
        sessionStartedAt: 0,
        getHeadSha: async () => 'ddd444',
      });
      expect(result.done).toBe(true);
      const marker = JSON.parse(await readFile(join(dir, SIDECAR), 'utf-8'));
      expect(marker.codeStamp).toBe('ddd444');
    });
  });

  describe('checkStepCompletion: architecture_review_as_built codeStamp sidecar (gate-code-validity, #817)', () => {
    const SIDECAR = '.pipeline/architecture-review-as-built-code-stamp.json';

    it('on true completion, writes a sidecar carrying codeStamp equal to the current head sha', async () => {
      await createFile('.pipeline/architecture-review-as-built.md', '# As-Built\n\nVerdict: APPROVED\n');
      const result = await checkStepCompletion(dir, 'architecture_review_as_built', {
        sessionStartedAt: 0,
        getHeadSha: async () => 'eee555',
      });
      expect(result.done).toBe(true);
      const marker = JSON.parse(await readFile(join(dir, SIDECAR), 'utf-8'));
      expect(marker.codeStamp).toBe('eee555');
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

  describe('classifyRetryDecision', () => {
    function completion(routeClass?: 'named-route' | 'absent', reason = 'r'): CompletionResult {
      return { done: false, reason, routeClass };
    }

    describe('truth table over architecture_review_as_built / build_review', () => {
      for (const step of ['architecture_review_as_built', 'build_review'] as const) {
        describe(step, () => {
          it('named-route, attempt 1 → route named-route (regardless of reason/inputsUnchanged)', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('named-route'),
              attempt: 1,
              priorReason: undefined,
              inputsUnchanged: false,
            });
            expect(r).toEqual({ decision: 'route', signal: 'named-route' });
          });

          it('named-route, attempt 2, same reason, inputsUnchanged → route named-route (signal a wins)', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('named-route', 'same'),
              attempt: 2,
              priorReason: 'same',
              inputsUnchanged: true,
            });
            expect(r).toEqual({ decision: 'route', signal: 'named-route' });
          });

          it('absent, attempt 1 → rerun', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('absent'),
              attempt: 1,
              priorReason: undefined,
              inputsUnchanged: false,
            });
            expect(r).toEqual({ decision: 'rerun' });
          });

          it('absent, attempt 2, diff reason, inputsUnchanged → rerun', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('absent', 'new'),
              attempt: 2,
              priorReason: 'old',
              inputsUnchanged: true,
            });
            expect(r).toEqual({ decision: 'rerun' });
          });

          it('absent, attempt 2, same reason, inputsUnchanged → route identical-repeat', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('absent', 'same'),
              attempt: 2,
              priorReason: 'same',
              inputsUnchanged: true,
            });
            expect(r).toEqual({ decision: 'route', signal: 'identical-repeat' });
          });

          it('absent, attempt 2, same reason, inputsUnchanged:false → rerun', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion('absent', 'same'),
              attempt: 2,
              priorReason: 'same',
              inputsUnchanged: false,
            });
            expect(r).toEqual({ decision: 'rerun' });
          });

          it('undefined routeClass, attempt 1 → rerun', () => {
            const r = classifyRetryDecision({
              step,
              completion: completion(undefined),
              attempt: 1,
              priorReason: undefined,
              inputsUnchanged: false,
            });
            expect(r).toEqual({ decision: 'rerun' });
          });
        });
      }
    });

    it('build step always reruns (scope guard), even with named-route-like inputs', () => {
      const r = classifyRetryDecision({
        step: 'build',
        completion: completion('named-route', 'same'),
        attempt: 2,
        priorReason: 'same',
        inputsUnchanged: true,
      });
      expect(r).toEqual({ decision: 'rerun' });
    });

    it('prd_audit with prdAuditNonClean:true routes named-route on attempt 1', () => {
      const r = classifyRetryDecision({
        step: 'prd_audit',
        completion: { done: false, reason: 'gap' },
        attempt: 1,
        priorReason: undefined,
        inputsUnchanged: false,
        prdAuditNonClean: true,
      });
      expect(r).toEqual({ decision: 'route', signal: 'named-route' });
    });

    it('prd_audit without prdAuditNonClean does not route on named-route signal', () => {
      const r = classifyRetryDecision({
        step: 'prd_audit',
        completion: { done: false, reason: 'gap' },
        attempt: 1,
        priorReason: undefined,
        inputsUnchanged: false,
        prdAuditNonClean: false,
      });
      expect(r).toEqual({ decision: 'rerun' });
    });

    describe('identical-repeat requires all three conditions', () => {
      it('flips attempt < 2 → rerun', () => {
        const r = classifyRetryDecision({
          step: 'build_review',
          completion: completion('absent', 'same'),
          attempt: 1,
          priorReason: 'same',
          inputsUnchanged: true,
        });
        expect(r).toEqual({ decision: 'rerun' });
      });

      it('flips priorReason undefined → rerun', () => {
        const r = classifyRetryDecision({
          step: 'build_review',
          completion: completion('absent', 'same'),
          attempt: 2,
          priorReason: undefined,
          inputsUnchanged: true,
        });
        expect(r).toEqual({ decision: 'rerun' });
      });

      it('flips inputsUnchanged false → rerun', () => {
        const r = classifyRetryDecision({
          step: 'build_review',
          completion: completion('absent', 'same'),
          attempt: 2,
          priorReason: 'same',
          inputsUnchanged: false,
        });
        expect(r).toEqual({ decision: 'rerun' });
      });
    });
  });

  describe('planStem', () => {
    it('strips the trailing .md extension from an absolute plan path', () => {
      expect(planStem('/x/.docs/plans/phase-9.3b-intake.md')).toBe('phase-9.3b-intake');
    });

    it('strips the trailing .md extension from a relative plan path', () => {
      expect(planStem('a/2026-07-03-foo.md')).toBe('2026-07-03-foo');
    });

    it('does not strip interior dots, only the .md extension', () => {
      const stem = planStem('/x/.docs/plans/phase-9.3b-intake.md');
      expect(stem).not.toBe('phase-9');
      expect(stem).toContain('.');
    });
  });

  describe('sweepStaleReviewArtifacts', () => {
    const SESSION = 1_000_000;
    const stale = new Date(SESSION - 60_000); // mtime before session start
    const freshTs = new Date(SESSION + 60_000); // mtime after session start

    it("deletes a gated step's stale .pipeline artifact so it cannot be reused", async () => {
      await createFile('.pipeline/architecture-review-as-built.md', 'prior-session verdict');
      await utimes(join(dir, '.pipeline/architecture-review-as-built.md'), stale, stale);

      const removed = await sweepStaleReviewArtifacts(dir, 'architecture_review_as_built', SESSION);

      expect(removed).toHaveLength(1);
      // Reuse is now impossible — the step must regenerate it this session.
      expect(await findArtifactFiles(dir, 'architecture_review_as_built')).toHaveLength(0);
    });

    it('keeps an artifact already fresh this session (within-session retry is safe)', async () => {
      await createFile('.pipeline/prd-audit.md', 'written this session');
      await utimes(join(dir, '.pipeline/prd-audit.md'), freshTs, freshTs);

      const removed = await sweepStaleReviewArtifacts(dir, 'prd_audit', SESSION);

      expect(removed).toHaveLength(0);
      expect(await findArtifactFiles(dir, 'prd_audit')).toHaveLength(1);
    });

    it('never sweeps build state (.pipeline/task-status.json is cumulative run state)', async () => {
      await createFile('.pipeline/task-status.json', '{"tasks":[]}');
      await utimes(join(dir, '.pipeline/task-status.json'), stale, stale);

      const removed = await sweepStaleReviewArtifacts(dir, 'build', SESSION);

      expect(removed).toHaveLength(0);
      expect(await findArtifactFiles(dir, 'build')).toHaveLength(1);
    });

    it('is a no-op when sessionStartedAt is undefined (legacy state → fail open)', async () => {
      await createFile('.pipeline/manual-test-results.md', 'old');
      await utimes(join(dir, '.pipeline/manual-test-results.md'), stale, stale);

      const removed = await sweepStaleReviewArtifacts(dir, 'manual_test', undefined);

      expect(removed).toHaveLength(0);
      expect(await findArtifactFiles(dir, 'manual_test')).toHaveLength(1);
    });
  });

  describe('planHasDependencyTree', () => {
    it('returns true when plan has task dependencies with **Dependencies:** field', () => {
      const planWithDependencies = `
# Implementation Plan: Versioned Engine Store

## Tasks

### Task 1: engine-store module — layout + version-id + listing
**Story:** FR-13/FR-14 (foundations)
**Type:** infrastructure
**Dependencies:** none

### Task 2: publish script — staging build + finalize
**Story:** FR-13 happy ("publish flow is staging → finalize")
**Type:** infrastructure
**Dependencies:** Task 1

### Task 3: atomic current flip — never in-place
**Story:** FR-13 neg (mid-load publish → wholly-old or wholly-new)
**Type:** happy-path
**Dependencies:** Task 2
`;
      expect(planHasDependencyTree(planWithDependencies)).toBe(true);
    });

    it('returns true when plan has a Task Dependency Graph section', () => {
      const planWithGraphSection = `
# Implementation Plan: Complex Feature

## Tasks

### Task 1: Foundation work
**Story:** S-1
**Type:** infrastructure

### Task 2: Dependent task
**Story:** S-2
**Type:** feature

## Task Dependency Graph

Task 1 → Task 2 → Task 3
`;
      expect(planHasDependencyTree(planWithGraphSection)).toBe(true);
    });

    it('returns false when plan has no dependency declarations', () => {
      const planWithoutDependencies = `
# Implementation Plan: Simple Feature

## Tasks

### Task 1: First task
**Story:** S-1
**Type:** feature

### Task 2: Second task
**Story:** S-2
**Type:** feature

### Task 3: Third task
**Story:** S-3
**Type:** feature
`;
      expect(planHasDependencyTree(planWithoutDependencies)).toBe(false);
    });

    it('returns false for an empty plan', () => {
      expect(planHasDependencyTree('')).toBe(false);
    });

    it('is case-insensitive for Task Dependency Graph heading', () => {
      const plan = `
# Plan

## task dependency graph

Task 1 → Task 2
`;
      expect(planHasDependencyTree(plan)).toBe(true);
    });

    it('is case-insensitive for Dependencies field', () => {
      const plan = `
# Plan

### Task 1
**dependencies:** Task 0

### Task 2
**DEPENDENCIES:** Task 1
`;
      expect(planHasDependencyTree(plan)).toBe(true);
    });

    it('handles null content gracefully, returning false without throwing', () => {
      expect(planHasDependencyTree(null as any)).toBe(false);
    });

    it('handles undefined content gracefully, returning false without throwing', () => {
      expect(planHasDependencyTree(undefined as any)).toBe(false);
    });
  });

  describe('validateBuildReviewVerdict', () => {
    it('accepts a valid PASS verdict', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false },
      });
      expect(result).toEqual({
        ok: true,
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false },
      });
    });

    it('rejects malformed JSON (non-object) as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict('not an object');
      expect(result.ok).toBe(false);
    });

    it('rejects null as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict(null);
      expect(result.ok).toBe(false);
    });

    it('rejects a verdict missing the "verdict" field as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict({
        rubric: { tautology: false },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a verdict missing the "rubric" field as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict({ verdict: 'PASS' });
      expect(result.ok).toBe(false);
    });

    it('accepts a FAIL verdict with reasons and preserves them', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'FAIL',
        reasons: ['tautological assertion in test', 'scope creep beyond acceptance criteria'],
        rubric: { tautology: true, scope: true, rootCause: false },
      });
      expect(result).toEqual({
        ok: true,
        verdict: 'FAIL',
        reasons: ['tautological assertion in test', 'scope creep beyond acceptance criteria'],
        rubric: { tautology: true, scope: true, rootCause: false },
      });
    });

    it('accepts and round-trips a verdict containing rubric.completeness', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
      });
      expect(result).toEqual({
        ok: true,
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
      });
    });

    it('validates a verdict where only rubric.completeness fails as overall FAIL (all-or-FAIL semantics)', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'FAIL',
        reasons: ['implementation addresses only part of the task scope'],
        rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
      });
      expect(result).toEqual({
        ok: true,
        verdict: 'FAIL',
        reasons: ['implementation addresses only part of the task scope'],
        rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
      });
    });

    it('rejects lowercase "pass" as invalid-or-FAIL (fail-closed, exact match only)', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'pass',
        rubric: {},
      });
      expect(result.ok).toBe(false);
    });

    it('rejects unrecognized string "APPROVED" as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'APPROVED',
        rubric: {},
      });
      expect(result.ok).toBe(false);
    });

    it('rejects an empty string verdict as invalid-or-FAIL', () => {
      const result = validateBuildReviewVerdict({
        verdict: '',
        rubric: {},
      });
      expect(result.ok).toBe(false);
    });

    it('accepts and round-trips a verdict carrying a codeStamp', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false },
        codeStamp: 'abc123def456',
      });
      expect(result).toEqual({
        ok: true,
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false },
        codeStamp: 'abc123def456',
      });
    });

    it('accepts a stamp-less legacy verdict (codeStamp is purely additive)', () => {
      const result = validateBuildReviewVerdict({
        verdict: 'PASS',
        rubric: { tautology: false, scope: false, rootCause: false },
      });
      expect(result.ok).toBe(true);
      expect(result).not.toHaveProperty('codeStamp');
    });
  });

  describe('stampCode', () => {
    it('returns the SHA from ctx.getHeadSha() when present', async () => {
      const ctx = { getHeadSha: async () => 'deadbeef1234' } as unknown as CompletionContext;
      await expect(stampCode(ctx)).resolves.toBe('deadbeef1234');
    });

    it('returns null when ctx.getHeadSha is absent (non-git path)', async () => {
      const ctx = {} as unknown as CompletionContext;
      await expect(stampCode(ctx)).resolves.toBeNull();
    });

    it('returns null when ctx.getHeadSha rejects, never throwing', async () => {
      const ctx = {
        getHeadSha: async () => {
          throw new Error('git not available');
        },
      } as unknown as CompletionContext;
      await expect(stampCode(ctx)).resolves.toBeNull();
    });
  });

  describe('checkStepCompletion: build_review code-validity on re-dispatch (Task 5, #817)', () => {
    const OLD_MTIME = new Date(2000, 0, 1);

    async function makeGitDir(): Promise<string> {
      const d = await mkdtemp(join(tmpdir(), 'artifacts-gate-validity-'));
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: d });
      await execa('git', ['config', 'user.email', 't@t.com'], { cwd: d });
      await execa('git', ['config', 'user.name', 'T'], { cwd: d });
      await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: d });
      await mkdir(join(d, '.pipeline'), { recursive: true });
      await writeFile(join(d, '.gitignore'), '.pipeline/\n');
      await execa('git', ['add', '.gitignore'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', 'chore: gitignore .pipeline'], { cwd: d });
      return d;
    }

    async function commitFile(d: string, rel: string, content: string, message: string): Promise<string> {
      await mkdir(join(d, dirname(rel)), { recursive: true });
      await writeFile(join(d, rel), content);
      await execa('git', ['add', '.'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', message], { cwd: d });
      const r = await execa('git', ['rev-parse', 'HEAD'], { cwd: d });
      return r.stdout.trim();
    }

    async function writeVerdict(d: string, verdict: 'PASS' | 'FAIL', codeStamp?: string): Promise<void> {
      const p = join(d, '.pipeline/build-review.json');
      const body: Record<string, unknown> = { verdict, rubric: {} };
      if (codeStamp !== undefined) body.codeStamp = codeStamp;
      await writeFile(p, JSON.stringify(body, null, 2));
      await utimes(p, OLD_MTIME, OLD_MTIME);
    }

    function ctxFor(d: string): CompletionContext {
      return {
        sessionStartedAt: Date.now(),
        attemptStartedAt: Date.now(),
        getHeadSha: async () => {
          const r = await execa('git', ['rev-parse', 'HEAD'], { cwd: d });
          return r.stdout.trim();
        },
      };
    }

    let gdir: string;
    afterEach(async () => {
      if (gdir) await rm(gdir, { recursive: true, force: true });
    });

    it('preserves a stale-mtime PASS verdict with a codeStamp when the surface since the stamp is unchanged', async () => {
      gdir = await makeGitDir();
      const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      await writeVerdict(gdir, 'PASS', baseline);

      const result = await checkStepCompletion(gdir, 'build_review', ctxFor(gdir));
      expect(result.done).toBe(true);
    });

    it('falls through to mtime rejection when the surface since the stamp changed (code diff)', async () => {
      gdir = await makeGitDir();
      const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      await writeVerdict(gdir, 'PASS', baseline);
      await commitFile(gdir, 'src/a.ts', 'a2\n', 'kickback fix');

      const result = await checkStepCompletion(gdir, 'build_review', ctxFor(gdir));
      expect(result.done).toBe(false);
      expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
    });

    it('falls through to mtime rejection (unchanged legacy behavior) when the PASS verdict has no codeStamp', async () => {
      gdir = await makeGitDir();
      await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      await writeVerdict(gdir, 'PASS', undefined);

      const result = await checkStepCompletion(gdir, 'build_review', ctxFor(gdir));
      expect(result.done).toBe(false);
      expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
    });

    it('a fresh-mtime FAIL verdict still FAILs regardless of codeStamp (existing behavior unaffected)', async () => {
      gdir = await makeGitDir();
      const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      const p = join(gdir, '.pipeline/build-review.json');
      await writeFile(
        p,
        JSON.stringify({ verdict: 'FAIL', reasons: ['nope'], rubric: {}, codeStamp: baseline }, null, 2),
      );
      // Fresh mtime (not backdated) — never touches the preserve path anyway.
      const result = await checkStepCompletion(gdir, 'build_review', ctxFor(gdir));
      expect(result.done).toBe(false);
      expect(result.reason).toMatch(/FAILed: nope/);
    });

    it('gate_code_validity.enabled: false restores pure mtime-freshness — rejects a stale-mtime PASS verdict with an unchanged-surface codeStamp (Task 8, #817)', async () => {
      gdir = await makeGitDir();
      const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      await writeVerdict(gdir, 'PASS', baseline);

      const ctx: CompletionContext = {
        ...ctxFor(gdir),
        config: { gate_code_validity: { enabled: false } },
      };
      const result = await checkStepCompletion(gdir, 'build_review', ctx);
      expect(result.done).toBe(false);
      expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
    });

    it('gate_code_validity.enabled: true (default-equivalent) still preserves a stale-mtime PASS verdict with an unchanged-surface codeStamp (Task 8, #817)', async () => {
      gdir = await makeGitDir();
      const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
      await writeVerdict(gdir, 'PASS', baseline);

      const ctx: CompletionContext = {
        ...ctxFor(gdir),
        config: { gate_code_validity: { enabled: true } },
      };
      const result = await checkStepCompletion(gdir, 'build_review', ctx);
      expect(result.done).toBe(true);
    });
  });

  describe('checkStepCompletion: prd_audit / architecture_review_as_built / manual_test code-validity on re-dispatch (Task 6, #817)', () => {
    const OLD_MTIME = new Date(2000, 0, 1);

    async function makeGitDir(): Promise<string> {
      const d = await mkdtemp(join(tmpdir(), 'artifacts-gate-validity-6-'));
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: d });
      await execa('git', ['config', 'user.email', 't@t.com'], { cwd: d });
      await execa('git', ['config', 'user.name', 'T'], { cwd: d });
      await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: d });
      await mkdir(join(d, '.pipeline'), { recursive: true });
      await writeFile(join(d, '.gitignore'), '.pipeline/\n');
      await execa('git', ['add', '.gitignore'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', 'chore: gitignore .pipeline'], { cwd: d });
      return d;
    }

    async function commitFile(d: string, rel: string, content: string, message: string): Promise<string> {
      await mkdir(join(d, dirname(rel)), { recursive: true });
      await writeFile(join(d, rel), content);
      await execa('git', ['add', '.'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', message], { cwd: d });
      const r = await execa('git', ['rev-parse', 'HEAD'], { cwd: d });
      return r.stdout.trim();
    }

    /** Wires an `origin` remote with a real `refs/remotes/origin/HEAD`, so
     * `deriveFeatureSurface` (feature-runtime gates) can compute a non-empty
     * feature surface `F` in-fixture instead of failing open to `[]`. */
    async function wireOrigin(d: string): Promise<void> {
      const bare = await mkdtemp(join(tmpdir(), 'artifacts-gate-validity-6-origin-'));
      await execa('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
      await execa('git', ['remote', 'add', 'origin', bare], { cwd: d });
      await execa('git', ['push', '-q', 'origin', 'main'], { cwd: d });
      await execa('git', ['remote', 'set-head', 'origin', 'main'], { cwd: d });
    }

    function ctxFor(d: string): CompletionContext {
      return {
        sessionStartedAt: Date.now(),
        attemptStartedAt: Date.now(),
        getHeadSha: async () => {
          const r = await execa('git', ['rev-parse', 'HEAD'], { cwd: d });
          return r.stdout.trim();
        },
      };
    }

    let gdir: string;
    afterEach(async () => {
      if (gdir) await rm(gdir, { recursive: true, force: true });
    });

    describe('prd_audit', () => {
      const PATH = '.pipeline/prd-audit.md';
      const SIDECAR = '.pipeline/prd-audit-code-stamp.json';
      const ALIGNED = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';

      async function writeReport(d: string): Promise<void> {
        const p = join(d, PATH);
        await writeFile(p, ALIGNED);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      async function writeSidecar(d: string, codeStamp: string | undefined): Promise<void> {
        if (codeStamp === undefined) return;
        await writeFile(join(d, SIDECAR), JSON.stringify({ codeStamp }, null, 2));
      }

      it('preserves a stale-mtime report with a codeStamp sidecar when the surface since the stamp is unchanged', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);
        await writeSidecar(gdir, baseline);

        const result = await checkStepCompletion(gdir, 'prd_audit', ctxFor(gdir));
        expect(result.done).toBe(true);
      });

      it('falls through to mtime rejection when the delta touches the feature\'s own runtime source', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);
        await writeSidecar(gdir, baseline);
        await commitFile(gdir, 'featureA.ts', 'f2\n', 'feat: change featureA');

        const result = await checkStepCompletion(gdir, 'prd_audit', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
      });

      it('falls through to mtime rejection (unchanged legacy behavior) when no sidecar/codeStamp is present', async () => {
        gdir = await makeGitDir();
        await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);

        const result = await checkStepCompletion(gdir, 'prd_audit', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
      });

      it('a fresh-mtime un-ALIGNED report still blocks regardless of the sidecar codeStamp', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        const unaligned = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n| FR-1 | DIVERGED | scope | foo.ts:1 | — |\n';
        await writeFile(join(gdir, PATH), unaligned);
        await writeSidecar(gdir, baseline);

        const result = await checkStepCompletion(gdir, 'prd_audit', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/un-ALIGNED/);
      });
    });

    describe('architecture_review_as_built', () => {
      const PATH = '.pipeline/architecture-review-as-built.md';
      const SIDECAR = '.pipeline/architecture-review-as-built-code-stamp.json';
      const APPROVED = '# As-Built Review\n\nVerdict: APPROVED\n';

      async function writeReport(d: string): Promise<void> {
        const p = join(d, PATH);
        await writeFile(p, APPROVED);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      async function writeSidecar(d: string, codeStamp: string | undefined): Promise<void> {
        if (codeStamp === undefined) return;
        await writeFile(join(d, SIDECAR), JSON.stringify({ codeStamp }, null, 2));
      }

      it('preserves a stale-mtime report with a codeStamp sidecar when the surface since the stamp is unchanged', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);
        await writeSidecar(gdir, baseline);

        const result = await checkStepCompletion(gdir, 'architecture_review_as_built', ctxFor(gdir));
        expect(result.done).toBe(true);
      });

      it('falls through to mtime rejection when the delta touches the feature\'s own runtime source', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);
        await writeSidecar(gdir, baseline);
        await commitFile(gdir, 'featureA.ts', 'f2\n', 'feat: change featureA');

        const result = await checkStepCompletion(gdir, 'architecture_review_as_built', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
      });

      it('falls through to mtime rejection (unchanged legacy behavior) when no sidecar/codeStamp is present', async () => {
        gdir = await makeGitDir();
        await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeReport(gdir);

        const result = await checkStepCompletion(gdir, 'architecture_review_as_built', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/not rewritten by this judging session/);
      });

      it('a fresh-mtime BLOCKED report still blocks regardless of the sidecar codeStamp', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeFile(join(gdir, PATH), '# As-Built Review\n\nVerdict: BLOCKED\n');
        await writeSidecar(gdir, baseline);

        const result = await checkStepCompletion(gdir, 'architecture_review_as_built', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/BLOCKED/);
      });
    });

    describe('manual_test', () => {
      const RESULTS = '.pipeline/manual-test-results.md';
      const MARKER = '.pipeline/manual-test-fail-evidence.json';
      const PASS_FILE = '| Story | Result |\n|---|---|\n| Foo | PASS |\n';

      async function writeResults(d: string): Promise<void> {
        const p = join(d, RESULTS);
        await writeFile(p, PASS_FILE);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      it('preserves a stale-mtime clean-PASS marker with a codeStamp when the surface since the stamp is unchanged', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeResults(gdir);
        await writeFile(join(gdir, MARKER), JSON.stringify({ codeStamp: baseline }, null, 2));

        const result = await checkStepCompletion(gdir, 'manual_test', ctxFor(gdir));
        expect(result.done).toBe(true);
      });

      it('falls through to mtime rejection when the delta touches a runtime path since the stamp', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeResults(gdir);
        await writeFile(join(gdir, MARKER), JSON.stringify({ codeStamp: baseline }, null, 2));
        await commitFile(gdir, 'src/a.ts', 'a2\n', 'kickback fix');

        const result = await checkStepCompletion(gdir, 'manual_test', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/stale/);
      });

      it('falls through to mtime rejection (unchanged legacy behavior) when the marker has no codeStamp', async () => {
        gdir = await makeGitDir();
        await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeResults(gdir);

        const result = await checkStepCompletion(gdir, 'manual_test', ctxFor(gdir));
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/stale/);
      });

      it('never launders an unresolved FAIL via the preserve check, even when the marker also carries a codeStamp', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        // Marker records BOTH an unresolved FAIL (headSha/failRows at the
        // current HEAD) AND a codeStamp — a state that must never arise from
        // this predicate's own writes, but the preserve-check must be robust
        // against it (defense in depth against a corrupted/hand-edited
        // marker): the whitewash guard must still fire, never short-circuit
        // via the codeStamp preserve path.
        await writeFile(
          join(gdir, MARKER),
          JSON.stringify(
            { headSha: baseline, observedAt: Date.now(), failRows: ['| Bar | FAIL |'], codeStamp: baseline },
            null,
            2,
          ),
        );
        // Fresh mtime (not backdated) — clean PASS file, HEAD unchanged
        // since the recorded FAIL. A backdated results file would hit the
        // ordinary staleness rejection first and never exercise the
        // whitewash guard this test targets.
        await writeFile(join(gdir, RESULTS), PASS_FILE);

        const result = await checkStepCompletion(gdir, 'manual_test', {
          ...ctxFor(gdir),
          sessionStartedAt: 0,
          attemptStartedAt: undefined,
        });
        expect(result.done).toBe(false);
        expect(result.reason ?? '').toMatch(/no new commits|whitewash/i);
      });
    });
  });

  describe('sweepStaleReviewArtifacts: code-validity preserve before delete (Task 7, #817)', () => {
    const OLD_MTIME = new Date(2000, 0, 1);

    async function makeGitDir(): Promise<string> {
      const d = await mkdtemp(join(tmpdir(), 'artifacts-gate-validity-7-'));
      await execa('git', ['init', '-q', '-b', 'main'], { cwd: d });
      await execa('git', ['config', 'user.email', 't@t.com'], { cwd: d });
      await execa('git', ['config', 'user.name', 'T'], { cwd: d });
      await execa('git', ['config', 'commit.gpgsign', 'false'], { cwd: d });
      await mkdir(join(d, '.pipeline'), { recursive: true });
      await writeFile(join(d, '.gitignore'), '.pipeline/\n');
      await execa('git', ['add', '.gitignore'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', 'chore: gitignore .pipeline'], { cwd: d });
      return d;
    }

    async function commitFile(d: string, rel: string, content: string, message: string): Promise<string> {
      await mkdir(join(d, dirname(rel)), { recursive: true });
      await writeFile(join(d, rel), content);
      await execa('git', ['add', '.'], { cwd: d });
      await execa('git', ['commit', '-q', '-m', message], { cwd: d });
      const r = await execa('git', ['rev-parse', 'HEAD'], { cwd: d });
      return r.stdout.trim();
    }

    /** Wires an `origin` remote with a real `refs/remotes/origin/HEAD`, so
     * `deriveFeatureSurface` (feature-runtime gates) can compute a non-empty
     * feature surface `F` in-fixture instead of failing open to `[]`. */
    async function wireOrigin(d: string): Promise<void> {
      const bare = await mkdtemp(join(tmpdir(), 'artifacts-gate-validity-7-origin-'));
      await execa('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
      await execa('git', ['remote', 'add', 'origin', bare], { cwd: d });
      await execa('git', ['push', '-q', 'origin', 'main'], { cwd: d });
      await execa('git', ['remote', 'set-head', 'origin', 'main'], { cwd: d });
    }

    let gdir: string;
    afterEach(async () => {
      if (gdir) await rm(gdir, { recursive: true, force: true });
    });

    describe('prd_audit', () => {
      const PATH = '.pipeline/prd-audit.md';
      const SIDECAR = '.pipeline/prd-audit-code-stamp.json';
      const ALIGNED =
        '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';

      async function writeStaleReport(d: string): Promise<void> {
        const p = join(d, PATH);
        await writeFile(p, ALIGNED);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      it('spares a stale report whose codeStamp sidecar surface is unchanged', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));

        const removed = await sweepStaleReviewArtifacts(gdir, 'prd_audit', Date.now());

        expect(removed).toEqual([]);
        await expect(readFile(join(gdir, PATH), 'utf-8')).resolves.toBe(ALIGNED);
      });

      it('gate_code_validity.enabled: false restores pure mtime-freshness — deletes a stale report even when the codeStamp sidecar surface is unchanged (Task 8, #817)', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));

        const removed = await sweepStaleReviewArtifacts(gdir, 'prd_audit', Date.now(), {
          gate_code_validity: { enabled: false },
        });

        expect(removed).toEqual([join(gdir, PATH)]);
        await expect(readFile(join(gdir, PATH), 'utf-8')).rejects.toThrow();
      });

      it('deletes a stale report whose codeStamp sidecar surface HAS changed', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));
        await commitFile(gdir, 'featureA.ts', 'f2\n', 'feat: change featureA');

        const removed = await sweepStaleReviewArtifacts(gdir, 'prd_audit', Date.now());

        expect(removed).toEqual([join(gdir, PATH)]);
        await expect(readFile(join(gdir, PATH), 'utf-8')).rejects.toThrow();
      });

      it('deletes a stale report with no codeStamp sidecar at all (legacy, unchanged regression)', async () => {
        gdir = await makeGitDir();
        await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);

        const removed = await sweepStaleReviewArtifacts(gdir, 'prd_audit', Date.now());

        expect(removed).toEqual([join(gdir, PATH)]);
        await expect(readFile(join(gdir, PATH), 'utf-8')).rejects.toThrow();
      });

      it('keeps a FRESH report untouched regardless of the sidecar codeStamp (existing early-continue behavior)', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        const p = join(gdir, PATH);
        await writeFile(p, ALIGNED); // fresh mtime — not backdated
        await commitFile(gdir, 'featureA.ts', 'f2\n', 'feat: change featureA');
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));

        const sessionStart = Date.now() - 60_000; // predates the fresh write above
        const removed = await sweepStaleReviewArtifacts(gdir, 'prd_audit', sessionStart);

        expect(removed).toEqual([]);
        await expect(readFile(p, 'utf-8')).resolves.toBe(ALIGNED);
      });
    });

    describe('architecture_review_as_built', () => {
      const PATH = '.pipeline/architecture-review-as-built.md';
      const SIDECAR = '.pipeline/architecture-review-as-built-code-stamp.json';
      const APPROVED = '# As-Built Review\n\nVerdict: APPROVED\n';

      async function writeStaleReport(d: string): Promise<void> {
        const p = join(d, PATH);
        await writeFile(p, APPROVED);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      it('spares a stale report whose codeStamp sidecar surface is unchanged', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));

        const removed = await sweepStaleReviewArtifacts(gdir, 'architecture_review_as_built', Date.now());

        expect(removed).toEqual([]);
        await expect(readFile(join(gdir, PATH), 'utf-8')).resolves.toBe(APPROVED);
      });

      it('deletes a stale report whose codeStamp sidecar surface HAS changed', async () => {
        gdir = await makeGitDir();
        await wireOrigin(gdir);
        const baseline = await commitFile(gdir, 'featureA.ts', 'f1\n', 'feat: add featureA');
        await writeStaleReport(gdir);
        await writeFile(join(gdir, SIDECAR), JSON.stringify({ codeStamp: baseline }, null, 2));
        await commitFile(gdir, 'featureA.ts', 'f2\n', 'feat: change featureA');

        const removed = await sweepStaleReviewArtifacts(gdir, 'architecture_review_as_built', Date.now());

        expect(removed).toEqual([join(gdir, PATH)]);
      });
    });

    describe('manual_test', () => {
      const RESULTS = '.pipeline/manual-test-results.md';
      const MARKER = '.pipeline/manual-test-fail-evidence.json';
      const PASS_FILE = '| Story | Result |\n|---|---|\n| Foo | PASS |\n';

      async function writeStaleResults(d: string): Promise<void> {
        const p = join(d, RESULTS);
        await writeFile(p, PASS_FILE);
        await utimes(p, OLD_MTIME, OLD_MTIME);
      }

      it('spares a stale clean-PASS marker whose codeStamp surface is unchanged', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeStaleResults(gdir);
        await writeFile(join(gdir, MARKER), JSON.stringify({ codeStamp: baseline }, null, 2));

        const removed = await sweepStaleReviewArtifacts(gdir, 'manual_test', Date.now());

        expect(removed).toEqual([]);
        await expect(readFile(join(gdir, RESULTS), 'utf-8')).resolves.toBe(PASS_FILE);
      });

      it('deletes a stale results file whose codeStamp surface HAS changed', async () => {
        gdir = await makeGitDir();
        const baseline = await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeStaleResults(gdir);
        await writeFile(join(gdir, MARKER), JSON.stringify({ codeStamp: baseline }, null, 2));
        await commitFile(gdir, 'src/a.ts', 'a2\n', 'kickback fix');

        const removed = await sweepStaleReviewArtifacts(gdir, 'manual_test', Date.now());

        expect(removed).toEqual([join(gdir, RESULTS)]);
      });

      it('deletes a stale results file with no fail-evidence marker at all (legacy, unchanged regression)', async () => {
        gdir = await makeGitDir();
        await commitFile(gdir, 'src/a.ts', 'a\n', 'init');
        await writeStaleResults(gdir);

        const removed = await sweepStaleReviewArtifacts(gdir, 'manual_test', Date.now());

        expect(removed).toEqual([join(gdir, RESULTS)]);
      });
    });
  });

  // Task 13 (gate-step-completion-validates-against-code-state-, #817):
  // characterization/regression coverage proving wiring_check, acceptance_specs,
  // and the build (task-status.json resume) predicate are byte-identical to
  // their pre-#817 behavior — the code-validity preserve mechanism
  // (gateVerdictStillValid / codeStamp sidecars) was scoped to build_review,
  // prd_audit, architecture_review_as_built, and manual_test ONLY (Tasks 1-9).
  // These tests would FAIL if a future change accidentally wired the preserve
  // mechanism into any of these three untouched gates.
  describe('Task 13: wiring_check / acceptance_specs / build stay byte-identical (#817 out-of-scope gates)', () => {
    describe('structural regression guard: predicate source never references the preserve mechanism', () => {
      let artifactsSource: string;

      beforeEach(async () => {
        artifactsSource = await readFile(
          join(__dirname, '../../src/engine/artifacts.ts'),
          'utf-8',
        );
      });

      function extractPredicateBody(name: string): string {
        // Predicates are defined as `<name>: async (dir, ctx): Promise<CompletionResult> => {`
        // (or a variant with an explicit `dir: string` param). Extract from the
        // predicate's opening brace to its matching closing brace via simple
        // depth counting — good enough for this file's consistent formatting.
        const re = new RegExp(`\\n  ${name}: async \\([^)]*\\)[^{]*\\{`);
        const match = re.exec(artifactsSource);
        expect(match, `could not locate predicate "${name}" in artifacts.ts`).not.toBeNull();
        const start = match!.index + match![0].length;
        let depth = 1;
        let i = start;
        while (depth > 0 && i < artifactsSource.length) {
          if (artifactsSource[i] === '{') depth++;
          else if (artifactsSource[i] === '}') depth--;
          i++;
        }
        return artifactsSource.slice(start, i);
      }

      it('wiring_check predicate body does not reference gateVerdictStillValid or codeStamp', () => {
        const body = extractPredicateBody('wiring_check');
        expect(body).not.toMatch(/gateVerdictStillValid/);
        expect(body).not.toMatch(/codeStamp/);
      });

      it('acceptance_specs predicate body does not reference gateVerdictStillValid or codeStamp', () => {
        const body = extractPredicateBody('acceptance_specs');
        expect(body).not.toMatch(/gateVerdictStillValid/);
        expect(body).not.toMatch(/codeStamp/);
      });

      it('build predicate body does not reference gateVerdictStillValid or codeStamp', () => {
        const body = extractPredicateBody('build');
        expect(body).not.toMatch(/gateVerdictStillValid/);
        expect(body).not.toMatch(/codeStamp/);
      });
    });

    describe('wiring_check: HEAD-anchored preserve is unaffected — stale (prior-HEAD) evidence is still rejected', () => {
      async function writeWiringEvidence(headSha: string) {
        await createFile(
          '.pipeline/wiring-evidence.json',
          JSON.stringify({
            schema: 1,
            base: 'aaa111',
            head: headSha,
            tasks: [],
            layer2: { applicable: false, reason: 'no layer2 targets' },
            waivers: [],
          }),
        );
      }

      it('rejects evidence recorded at a prior HEAD, even though that evidence is a clean PASS (no gaps)', async () => {
        await writeWiringEvidence('stale-sha-111');
        const ctx = { getHeadSha: async () => 'current-sha-222' };
        const result = await checkStepCompletion(dir, 'wiring_check', ctx);
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/stale/);
      });

      it('accepts evidence recorded at the current HEAD with no gaps (pre-existing HEAD-anchored behavior, unchanged)', async () => {
        await writeWiringEvidence('current-sha-222');
        const ctx = { getHeadSha: async () => 'current-sha-222' };
        const result = await checkStepCompletion(dir, 'wiring_check', ctx);
        expect(result).toEqual({ done: true });
      });
    });

    describe('acceptance_specs: content-validate / RED self-heal behavior is unaffected', () => {
      it('still fails when RED execution evidence is entirely absent (no codeStamp-based preserve short-circuits this)', async () => {
        await createFile('spec/some_feature_spec.rb', 'x');
        const result = await checkStepCompletion(dir, 'acceptance_specs', {
          config: { acceptance_spec_globs: ['spec/**/*'] },
        });
        expect(result.done).toBe(false);
      });

      it('still passes on fresh spec files plus valid RED evidence (unchanged pre-#817 behavior)', async () => {
        await createFile('spec/some_feature_spec.rb', 'x');
        await createFile(
          '.pipeline/acceptance-specs-red.json',
          JSON.stringify({
            command: 'bundle exec rspec spec',
            targetSpecs: ['spec/some_feature_spec.rb'],
            executed: 1,
            passed: 0,
            failed: 1,
            skipped: 0,
            errors: 0,
          }),
        );
        const result = await checkStepCompletion(dir, 'acceptance_specs', {
          config: { acceptance_spec_globs: ['spec/**/*'] },
        });
        expect(result).toEqual({ done: true });
      });
    });

    describe('build: task-status.json resume is unaffected — no codeStamp/gateVerdictStillValid involvement', () => {
      it('resumes correctly from prior task-status.json state with mixed completed/pending rows (no preserve short-circuit)', async () => {
        await createFile(
          '.pipeline/task-status.json',
          JSON.stringify({
            tasks: [
              { id: 'T1', status: 'completed' },
              { id: 'T2', status: 'pending' },
            ],
          }),
        );
        const result = await checkStepCompletion(dir, 'build');
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pending|not completed/i);
      });

      it('resumes correctly and passes once every prior-session row reads completed/skipped (unchanged pre-#817 behavior)', async () => {
        await createFile(
          '.pipeline/task-status.json',
          JSON.stringify({
            tasks: [
              { id: 'T1', status: 'completed' },
              { id: 'T2', status: 'skipped' },
            ],
          }),
        );
        const result = await checkStepCompletion(dir, 'build');
        expect(result).toEqual({ done: true });
      });
    });
  });
});
