import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// Import the real readStaleHaltTitle for use in spy implementation
import { readStaleHaltTitle as realReadStaleHaltTitle } from '../../src/engine/halt-pr-rehabilitation.js';

// Spy target for the finish predicate's Phase 2 presentation check
// (readStaleHaltTitle, invoked with a gh runner). Mocked so tests can assert
// it is never reached when a Phase 1 evidence condition (e.g. push
// verification) already failed the gate. Default behavior returns null (fail-open);
// tests can override via mockImplementation to call the real implementation.
const readStaleHaltTitleSpy = vi.fn(async () => null);
vi.mock('../../src/engine/halt-pr-rehabilitation.js', () => ({
  readStaleHaltTitle: (...args: unknown[]) => readStaleHaltTitleSpy(...args),
}));

import {
  STEP_ARTIFACT_GLOBS,
  findArtifactFiles,
  stepHasArtifacts,
  getArtifactStatus,
  checkStepCompletion,
  isStoriesApproved,
  classifyPrdAuditGaps,
  sweepStaleReviewArtifacts,
  FINISH_CHOICE_MARKER,
  HALT_MARKER,
  planStem,
  planHasDependencyTree,
  validateBuildReviewVerdict,
} from '../../src/engine/artifacts.js';

describe('engine/artifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-test-'));
    readStaleHaltTitleSpy.mockClear();
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

        // First check creates the seeded file
        const result1 = await checkStepCompletion(dir, 'build', ctx);
        expect(result1.done).toBe(false); // pending tasks exist

        // Verify file was created
        const statusPath = join(dir, '.pipeline/task-status.json');
        const first = JSON.parse(await readFile(statusPath, 'utf-8'));
        expect(first.tasks).toBeDefined();
        expect(first.tasks.length).toBeGreaterThan(0);

        // Delete the file to simulate mid-run deletion
        await rm(statusPath);

        // Re-check should re-seed the file
        const result2 = await checkStepCompletion(dir, 'build', ctx);
        expect(result2.done).toBe(false); // still has pending

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
        const result = await checkStepCompletion(dir, 'build', ctx);
        expect(result.done).toBe(false); // has pending tasks

        // File should be rebuilt (valid JSON)
        const rebuilt = JSON.parse(await readFile(statusPath, 'utf-8'));
        expect(rebuilt.tasks).toBeDefined();
        expect(Array.isArray(rebuilt.tasks)).toBe(true);
      });

      it('fails with pending tasks (seeded state has pending)', async () => {
        await writePlan('### Task 1: Task one\n**Story:** 1\n\n### Task 2: Task two\n**Story:** 2\n');

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        // After seeding, both tasks are pending (no evidence/commits)
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pending|not completed/i);
      });

      it('marks tasks as pending after seeding (without evidence commits)', async () => {
        await writePlan('### Task 1: Task one\n**Story:** 1\n\n### Task 2: Task two\n**Story:** 2\n');
        // Pre-write some completed tasks (forged state, no commit evidence).
        // A PRESENT sidecar makes this a post-cutover state: without it, the
        // first-seed H8 migration grandfather would (by design) preserve
        // pre-cutover terminal rows — forgery detection is a post-cutover
        // contract.
        await writeTasks([
          { id: '1', name: 'Task 1', status: 'completed' },
          { id: '2', name: 'Task 2', status: 'completed' },
        ]);
        await writeFile(
          join(dir, '.pipeline/task-evidence.json'),
          JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
        );

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        // seedTaskStatus resets tasks without evidence to pending
        // So gate should fail with pending tasks
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pending|not completed/i);
      });

      it('detects all-completed forged rows as incomplete (no evidence)', async () => {
        // This tests the acceptance criterion: forged all-completed rows + zero commits → gate fails
        await writePlan('### Task 1: Task one\n**Story:** 1\n');
        // Post-cutover state (sidecar present) — see the sibling test's note.
        // Write task-status showing completed but no evidence commits
        await writeTasks([{ id: '1', name: 'Task 1', status: 'completed' }]);
        await writeFile(
          join(dir, '.pipeline/task-evidence.json'),
          JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [] }),
        );

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);
        // seedTaskStatus resets to pending → gate fails
        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/pending|not completed/i);
      });

      it('rejects tasks resolved only via legacy migrationGrandfather, even with completed rows (#463)', async () => {
        // Legacy sidecar: no evidenceStamps at all, but tasks 2 and 4 were
        // grandfathered during the H8 migration. Their task-status.json rows
        // are (forged/stale) 'completed'. Evidence stamps are the ONLY
        // completion currency now — the grandfather escape hatch must be
        // inert for gate resolution, regardless of row status.
        await writePlan('### Task 2: Task two\n**Story:** 2\n\n### Task 4: Task four\n**Story:** 4\n');
        await writeTasks([
          { id: '2', name: 'Task two', status: 'completed' },
          { id: '4', name: 'Task four', status: 'completed' },
        ]);
        await writeFile(
          join(dir, '.pipeline/task-evidence.json'),
          JSON.stringify({
            evidenceStamps: {},
            noEvidenceAttempts: 0,
            migrationGrandfather: ['2', '4'],
          }),
        );

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };
        const result = await checkStepCompletion(dir, 'build', ctx);

        expect(result.done).toBe(false);
        expect(result.reason).toMatch(/2/);
        expect(result.reason).toMatch(/4/);
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

      it('accepts a task with a real evidence stamp regardless of row status', async () => {
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

        expect(result).toEqual({ done: true });
      });

      // Regression (Task 10): a task legitimately completed via a real commit
      // (Task: N trailer + path-corroborating changes) must keep passing the
      // gate even if the mutable `.pipeline/task-evidence.json` sidecar is
      // deleted out from under it. deriveCompletion re-derives evidence from
      // git (the immutable source of truth) on every gate evaluation and
      // re-writes the sidecar — the sidecar is a cache, never the source.
      it('re-stamps and still passes the gate after the evidence sidecar is deleted (real commit)', async () => {
        await execa('git', ['init', '-b', 'main'], { cwd: dir });
        await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
        await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
        await writeFile(join(dir, 'README.md'), '# Test\n');
        await execa('git', ['add', 'README.md'], { cwd: dir });
        await execa('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

        // getEvidenceRange requires a resolvable origin default branch to
        // bound the commit range — set up a bare "origin" the way a real
        // clone would have one, pushed at the initial commit so the plan +
        // work commits below are ahead of it.
        const bareDir = await mkdtemp(join(tmpdir(), 'artifacts-origin-'));
        await execa('git', ['init', '--bare', '-b', 'main'], { cwd: bareDir });
        await execa('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });
        await execa('git', ['push', '-u', 'origin', 'main'], { cwd: dir });

        await writePlan('### Task 1: Real task\n**Story:** 1\nContent with `src/real.ts`\n');
        await execa('git', ['add', '.docs/plans/phase-1.md'], { cwd: dir });
        await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

        // A real commit with a corroborating path change and the Task: N trailer.
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src/real.ts'), 'export const real = true;\n');
        await execa('git', ['add', 'src/real.ts'], { cwd: dir });
        await execa('git', ['commit', '-m', 'feat: implement real task\n\nTask: 1\n'], { cwd: dir });

        const ctx = { projectRoot: dir, planPath: join(dir, '.docs/plans/phase-1.md') };

        // First pass: seed + derive should stamp the task from the commit and pass.
        const first = await checkStepCompletion(dir, 'build', ctx);
        expect(first).toEqual({ done: true });

        const sidecarPath = join(dir, '.pipeline/task-evidence.json');
        const beforeDelete = JSON.parse(await readFile(sidecarPath, 'utf-8'));
        expect(beforeDelete.evidenceStamps['1']).toBeDefined();

        // Delete the mutable sidecar entirely.
        await rm(sidecarPath, { force: true });

        // Re-run seed + derive + gate: the task must be re-stamped from git
        // and still count as completed, even though the sidecar was wiped.
        const second = await checkStepCompletion(dir, 'build', ctx);
        expect(second).toEqual({ done: true });

        const restamped = JSON.parse(await readFile(sidecarPath, 'utf-8'));
        expect(restamped.evidenceStamps['1']).toBeDefined();

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

          // Main assertion: em-dash plan with evidence should PASS the gate
          const result = await checkStepCompletion(dir, 'build', ctx);
          expect(result).toEqual({ done: true });

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
      await expect(readFile(join(dir, MARKER), 'utf-8')).rejects.toThrow();
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
      await expect(readFile(join(dir, MARKER), 'utf-8')).rejects.toThrow();
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
  });
});
