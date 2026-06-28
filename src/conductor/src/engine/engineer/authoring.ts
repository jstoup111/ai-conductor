// authoring.ts — Prompt builder + gated authoring runner (Tasks 14 & 32/33, FR-5/FR-6).
//
// `buildAuthoringPrompt` (Task 14, FR-5):
//   Embeds the LessonDigest into the prompt text so that a downstream reader
//   (LLM or evaluator) can observe prior lessons directly in the prompt context
//   without requiring a separate retrieval step.
//
// `runAuthoring` (Tasks 32/33, FR-6, C2, ADR-008):
//   Runs the DECIDE authoring via an AGENT-HOSTED seam (no subprocess).
//   - deps.decide is INJECTABLE — called once per step (brainstorm/stories/plan).
//   - Creates a spec/<slug> branch off the repo's DEFAULT branch. The default
//     branch is derived via `git rev-parse --abbrev-ref HEAD` for local repos
//     (no remote) — never hardcoded to 'main'.
//   - On branch-name collision, adds a numeric suffix disambiguator.
//   - The authored artifacts (.docs/specs, .docs/stories, .docs/plans) are
//     committed ON that spec/<slug> branch in the target repo.
//   - Returns { branch, project } so the caller can open a PR or report back.
//
// Design decisions:
//   • Returns a plain `string` for simplicity; callers can wrap in {prompt} if
//     needed — the shape is forward-compatible because the test accepts either.
//   • Digest is rendered section-by-section (kickbacks, halts, retryHotspots,
//     narrativeRefs). Each section lists lesson texts as numbered bullets.
//   • When ALL groups are empty the lessons block says "No prior lessons for
//     this project." explicitly — the absence is observable (FR-5 requirement).
//   • Lesson texts are embedded verbatim; no escaping — special characters
//     must survive intact for downstream consumers.

import { execFile as execFileCb } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LessonDigest, RetrievedLesson } from './lesson-store.js';
import { AuthoringGuard } from './authoring-guard.js';
import { TargetPathMissingError } from './target.js';
import { isStoriesApproved } from '../artifacts.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types — buildAuthoringPrompt (Task 14)
// ---------------------------------------------------------------------------

/**
 * Options for buildAuthoringPrompt.
 * Reserved for future extension (e.g. custom section titles).
 */
export interface AuthoringPromptOpts {
  /** Override the section header label. Defaults to "Prior Lessons". */
  lessonsSectionTitle?: string;
}

/**
 * The return shape of buildAuthoringPrompt.
 * Returning an object keeps the door open for structured callers (Task 19).
 */
export interface AuthoringPromptResult {
  prompt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers — buildAuthoringPrompt (Task 14)
// ---------------------------------------------------------------------------

/**
 * Render a group of lessons as a numbered bullet list.
 * Returns an empty string when the group is empty (callers decide what to show).
 */
function renderLessonGroup(title: string, lessons: RetrievedLesson[]): string {
  if (lessons.length === 0) return '';
  const bullets = lessons
    .map((l, i) => `  ${i + 1}. ${l.text}`)
    .join('\n');
  return `### ${title}\n${bullets}`;
}

/**
 * Determine whether ALL groups in the digest are empty.
 */
function isEmptyDigest(digest: LessonDigest): boolean {
  return (
    digest.kickbacks.length === 0 &&
    digest.halts.length === 0 &&
    digest.retryHotspots.length === 0 &&
    digest.narrativeRefs.length === 0
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the authoring/planning prompt for the engineer.
 *
 * The prompt contains:
 *   1. The idea to be planned.
 *   2. The target project name.
 *   3. A "Prior Lessons" section that embeds all lesson texts from the digest.
 *      - When the digest is empty the section explicitly states
 *        "No prior lessons for this project." so the absence is observable.
 *
 * @param idea    The feature idea / planning request.
 * @param project The target project name.
 * @param digest  The LessonDigest assembled by selectLessons (FR-5).
 * @param opts    Optional overrides (e.g. custom section title).
 * @returns       An AuthoringPromptResult whose `.prompt` field is the full prompt string.
 */
export function buildAuthoringPrompt(
  idea: string,
  project: string,
  digest: LessonDigest,
  opts: AuthoringPromptOpts = {},
): AuthoringPromptResult {
  const sectionTitle = opts.lessonsSectionTitle ?? 'Prior Lessons';

  // Build the lessons block
  let lessonsBlock: string;
  if (isEmptyDigest(digest)) {
    lessonsBlock = `## ${sectionTitle}\n\nNo prior lessons for this project.`;
  } else {
    const sections: string[] = [];

    const kickbacksSection = renderLessonGroup('Kickbacks', digest.kickbacks);
    if (kickbacksSection) sections.push(kickbacksSection);

    const haltsSection = renderLessonGroup('Halts', digest.halts);
    if (haltsSection) sections.push(haltsSection);

    const retrySection = renderLessonGroup('Retry Hotspots', digest.retryHotspots);
    if (retrySection) sections.push(retrySection);

    const narrativeSection = renderLessonGroup('Narrative References', digest.narrativeRefs);
    if (narrativeSection) sections.push(narrativeSection);

    lessonsBlock = `## ${sectionTitle}\n\n${sections.join('\n\n')}`;
  }

  const prompt = [
    `# Authoring Prompt`,
    ``,
    `## Idea`,
    ``,
    idea,
    ``,
    `## Target Project`,
    ``,
    project,
    ``,
    lessonsBlock,
  ].join('\n');

  return { prompt };
}

// ---------------------------------------------------------------------------
// Internal helpers — branch derivation + naming (shared by runAuthoring)
// ---------------------------------------------------------------------------

/**
 * Slugify an idea string into a safe git branch name segment.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims edge hyphens.
 * Truncated to 50 chars so branch names stay readable.
 */
export function slugify(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Derive the repo's current HEAD branch via `git rev-parse --abbrev-ref HEAD`.
 * Works for local repos with no remote — never hardcodes 'main'.
 * Throws if the repo has no commits (HEAD is unborn/detached).
 */
export async function deriveDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoPath,
    });
    const branch = stdout.trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch {
    // fall through to throw below
  }
  throw new Error(
    `runAuthoring: could not derive default branch for repo at "${repoPath}". ` +
      'Ensure the repo has at least one commit and is not in a detached HEAD state.',
  );
}

/**
 * Check whether a local branch already exists in the repo.
 */
export async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('git', ['branch', '--list', branchName], {
      cwd: repoPath,
    });
    return stdout.trim() === branchName;
  } catch {
    return false;
  }
}

/**
 * Choose a unique branch name starting from `spec/<slug>`.
 * If that already exists, tries `spec/<slug>-2`, `spec/<slug>-3`, etc.
 */
export async function chooseBranchName(repoPath: string, slug: string): Promise<string> {
  const base = `spec/${slug}`;
  if (!(await branchExists(repoPath, base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await branchExists(repoPath, candidate))) return candidate;
  }
  throw new Error(
    `runAuthoring: could not find a unique branch name after 1000 attempts for slug "${slug}"`,
  );
}

// ---------------------------------------------------------------------------
// runAuthoring — gated DECIDE seam (FR-6, C2, ADR-008, Task 32/33)
// ---------------------------------------------------------------------------

/**
 * A single DECIDE step result returned by the injected host-agent seam.
 * approved:false on ANY step causes runAuthoring to throw (gate blocks).
 */
export interface DecideResult {
  approved: boolean;
  artifact: string;
}

/**
 * Dependencies injected into runAuthoring.
 *
 * `decide` is the host-agent DECIDE seam — it is called once per step
 * ('brainstorm' | 'stories' | 'plan') and returns the human-gated artifact.
 *
 * `spawn` is the optional child-process spawn shim (repo convention).
 * runAuthoring never calls it — the field exists only so the acceptance-test
 * spawn spy can confirm that no `claude` subprocess was launched.
 */
export interface RunAuthoringDeps {
  decide: (step: string) => Promise<DecideResult>;
  spawn?: (...args: any[]) => any;
}

/**
 * Return value of runAuthoring — mirrors AuthoringResult for consistency.
 */
export interface RunAuthoringResult {
  branch: string;
  project: string;
}

/**
 * runAuthoring — real DECIDE seam → Status:Accepted artifacts on spec/<slug> (FR-6, C2).
 *
 * Contract:
 *  1. Validates target.canonicalPath exists on disk (TargetPathMissingError on failure).
 *  2. Calls deps.decide('brainstorm'), then 'stories', then 'plan' IN ORDER.
 *     If ANY returns { approved: false } → throws (gate blocks); nothing is written.
 *  3. On all-approved: creates spec/<slug> branch, writes artifacts via AuthoringGuard,
 *     commits on that branch, returns { branch, project }.
 *  4. NEVER spawns claude or any other subprocess (except git via execFile).
 *  5. All filesystem writes are guarded by AuthoringGuard(target.canonicalPath).
 *
 * @param target  { name, canonicalPath } — the target project.
 * @param idea    The feature idea to author.
 * @param deps    Injected dependencies: decide seam + optional spawn shim.
 */
export async function runAuthoring(
  target: { name: string; canonicalPath: string },
  idea: string,
  deps: RunAuthoringDeps,
): Promise<RunAuthoringResult> {
  const repoPath = target.canonicalPath;

  // 1. Validate the target path exists — fail fast, no cwd fallback.
  try {
    await access(repoPath);
  } catch {
    throw new TargetPathMissingError(repoPath);
  }

  // 1b. Guard: reject a dirty working tree BEFORE running any DECIDE step.
  //     Uses `git status --porcelain` — any non-empty output means dirty.
  //     We do NOT stash, force-checkout, or reset. Fail fast, leave the
  //     tree exactly as found (no data loss, no orphan branch).
  {
    const { stdout: porcelain } = await execFile('git', ['status', '--porcelain'], {
      cwd: repoPath,
    });
    if (porcelain.trim() !== '') {
      const dirtyFiles = porcelain
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .join(', ');
      throw new Error(
        `runAuthoring: target repo at "${repoPath}" has uncommitted (dirty) changes: ${dirtyFiles}. ` +
          'Commit or discard all changes before running runAuthoring.',
      );
    }
  }

  // 2. Run DECIDE steps IN ORDER. Any unapproved gate throws immediately;
  //    nothing is written to the filesystem below that point.
  const brainstormResult = await deps.decide('brainstorm');
  if (!brainstormResult.approved) {
    throw new Error(
      `runAuthoring: DECIDE gate "brainstorm" was not approved. Authoring blocked — no artifacts written.`,
    );
  }

  const storiesResult = await deps.decide('stories');
  if (!storiesResult.approved) {
    throw new Error(
      `runAuthoring: DECIDE gate "stories" was not approved. Authoring blocked — no artifacts written.`,
    );
  }

  const planResult = await deps.decide('plan');
  if (!planResult.approved) {
    throw new Error(
      `runAuthoring: DECIDE gate "plan" was not approved. Authoring blocked — no artifacts written.`,
    );
  }

  // All gates approved. Now write artifacts.

  // 3a. Derive default branch and create spec/<slug> branch.
  const defaultBranch = await deriveDefaultBranch(repoPath);
  const slug = slugify(idea);
  const branch = await chooseBranchName(repoPath, slug);

  try {
    await execFile('git', ['checkout', '-b', branch, defaultBranch], { cwd: repoPath });

    // 3b. Instantiate AuthoringGuard — all writes must be descendants of repoPath.
    const guard = new AuthoringGuard(repoPath);

    // Derive a slug-based filename for stories and plans.
    const fileSlug = slug;

    // Paths under target repo
    const storiesDir = join(repoPath, '.docs', 'stories');
    const plansDir = join(repoPath, '.docs', 'plans');
    const specsDir = join(repoPath, '.docs', 'specs');
    const storiesFile = join(storiesDir, `${fileSlug}.md`);
    const plansFile = join(plansDir, `${fileSlug}.md`);
    const specsFile = join(specsDir, `${fileSlug}.md`);

    // Guard every path before any write.
    guard.assertWriteAllowed(storiesDir);
    guard.assertWriteAllowed(plansDir);
    guard.assertWriteAllowed(specsDir);
    guard.assertWriteAllowed(storiesFile);
    guard.assertWriteAllowed(plansFile);
    guard.assertWriteAllowed(specsFile);

    // Create directories and write artifact files.
    await mkdir(storiesDir, { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });

    // Stories from DECIDE MUST carry the canonical approval marker — the
    // /stories skill stamps "Status: Accepted" on operator approval. Enforce the
    // assumption rather than trusting it: a no-status (or DRAFT) artifact would
    // commit a spec the daemon then skips forever. Fail before any write.
    if (!isStoriesApproved(storiesResult.artifact)) {
      throw new Error(
        'runAuthoring: stories artifact from DECIDE is not approved — it must declare ' +
          '"Status: Accepted" (and no "Status: DRAFT"). The /stories skill stamps this on approval.',
      );
    }

    // Write stories verbatim from DECIDE (contains "Status: Accepted").
    await writeFile(storiesFile, storiesResult.artifact, 'utf8');

    // Write plan verbatim from DECIDE (contains "## Task Dependency Graph").
    await writeFile(plansFile, planResult.artifact, 'utf8');

    // Write brainstorm/PRD as the spec artifact.
    await writeFile(specsFile, brainstormResult.artifact, 'utf8');

    // 3c. Stage and commit all spec artifacts on the spec branch.
    //     All three dirs are committed so the repo returns to a clean state
    //     after checkout back to defaultBranch (no untracked leftovers).
    await execFile('git', ['add', '.docs/plans', '.docs/specs', '.docs/stories'], {
      cwd: repoPath,
    });
    await execFile(
      'git',
      ['commit', '-m', `spec: author artifacts for "${idea}" [engineer/runAuthoring]`],
      { cwd: repoPath },
    );
  } catch (err) {
    // Restore HEAD to defaultBranch and clean up the dangling branch.
    try {
      await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });
    } catch {
      // ignore restore errors
    }
    try {
      await execFile('git', ['branch', '-D', branch], { cwd: repoPath });
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }

  // 4. Return to the default branch so the repo is left in a clean state.
  await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });

  return { branch, project: target.name };
}
