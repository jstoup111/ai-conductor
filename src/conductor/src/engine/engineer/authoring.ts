// authoring.ts — Prompt builder + subprocess authoring runner (Tasks 14 & 20, FR-5/FR-6).
//
// `buildAuthoringPrompt` (Task 14, FR-5):
//   Embeds the LessonDigest into the prompt text so that a downstream reader
//   (LLM or evaluator) can observe prior lessons directly in the prompt context
//   without requiring a separate retrieval step.
//
// `authorSpec` (Task 20, FR-6):
//   Runs the DECIDE authoring as a subprocess with the TARGET repo as cwd.
//   - provider is INJECTABLE — tests supply a fake; production wraps a real
//     conduct invocation.
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
import { promisify } from 'node:util';
import type { LessonDigest, RetrievedLesson } from './lesson-store.js';
import type { TargetRepo } from './target.js';

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
// Types — authorSpec (Task 20)
// ---------------------------------------------------------------------------

/**
 * The argument shape passed to AuthoringProvider.invoke.
 * All fields are present — the provider never needs to infer cwd from globals.
 */
export interface AuthoringInvokeOpts {
  /** Absolute path to the target repo — must be used as cwd. */
  cwd: string;
  /** The raw idea text being authored. */
  idea: string;
  /** The spec/<slug> branch that was created for this authoring run. */
  branch: string;
}

/**
 * Injectable provider for the subprocess DECIDE step.
 *
 * Production wraps a real `conduct` / LLM invocation.
 * Tests supply a fake that writes .docs/specs|stories|plans directly.
 */
export interface AuthoringProvider {
  invoke(opts: AuthoringInvokeOpts): Promise<void>;
}

/**
 * Return value of authorSpec.
 */
export interface AuthoringResult {
  /** The spec/<slug> branch created in the target repo. */
  branch: string;
  /** The target project name (from target.name). */
  project: string;
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
// Internal helpers — authorSpec (Task 20)
// ---------------------------------------------------------------------------

/**
 * Slugify an idea string into a safe git branch name segment.
 * Lowercases, replaces non-alphanumeric runs with hyphens, trims edge hyphens.
 * Truncated to 50 chars so branch names stay readable.
 */
function slugify(idea: string): string {
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
async function deriveDefaultBranch(repoPath: string): Promise<string> {
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
    `authorSpec: could not derive default branch for repo at "${repoPath}". ` +
      'Ensure the repo has at least one commit and is not in a detached HEAD state.',
  );
}

/**
 * Check whether a local branch already exists in the repo.
 */
async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
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
async function chooseBranchName(repoPath: string, slug: string): Promise<string> {
  const base = `spec/${slug}`;
  if (!(await branchExists(repoPath, base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await branchExists(repoPath, candidate))) return candidate;
  }
  throw new Error(
    `authorSpec: could not find a unique branch name after 1000 attempts for slug "${slug}"`,
  );
}

// ---------------------------------------------------------------------------
// Public API — authorSpec (Task 20, FR-6)
// ---------------------------------------------------------------------------

/**
 * authorSpec — subprocess DECIDE authoring runner (Task 20, FR-6).
 *
 * Creates a `spec/<slug>` branch in the target repo off the repo's actual
 * default branch (derived — never hardcoded), delegates artifact writing to
 * the injectable `provider`, commits the artifacts on that branch, and
 * returns `{ branch, project }` for the caller.
 *
 * @param target   The resolved TargetRepo (name + canonicalPath).
 * @param idea     The feature idea to author.
 * @param _digest  The LessonDigest (available to provider via prompt; not used
 *                 for branching logic here).
 * @param provider Injectable authoring provider — writes .docs/specs|stories|plans.
 * @returns        { branch, project } — the branch created and the project name.
 */
export async function authorSpec(
  target: TargetRepo,
  idea: string,
  _digest: LessonDigest,
  provider: AuthoringProvider,
): Promise<AuthoringResult> {
  const repoPath = target.canonicalPath;

  // 0. Guard: reject a dirty working tree before touching anything.
  //    Uses `git status --porcelain` — any non-empty output means dirty.
  //    We do NOT stash, force-checkout, or reset. Fail fast, leave the
  //    tree exactly as found (no data loss, no orphan branches).
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
        `authorSpec: target repo at "${repoPath}" has uncommitted (dirty) changes: ${dirtyFiles}. ` +
          'Commit or discard all changes before running authorSpec.',
      );
    }
  }

  // 1. Derive the default branch — never hardcode 'main'.
  const defaultBranch = await deriveDefaultBranch(repoPath);

  // 2. Compute slug and find a unique branch name.
  const slug = slugify(idea);
  const branch = await chooseBranchName(repoPath, slug);

  // 3–5. Create the branch, invoke provider, commit artifacts.
  //       Wrapped in try/catch: on any failure, restore HEAD to defaultBranch
  //       and delete the dangling spec branch so deriveDefaultBranch() returns
  //       the correct branch on the next call (not spec/<slug>).
  try {
    // 3. Create the spec/<slug> branch off the default branch.
    await execFile('git', ['checkout', '-b', branch, defaultBranch], { cwd: repoPath });

    // 4. Invoke the provider (fake in tests, real conduct in production).
    //    The provider writes .docs/specs|stories|plans into repoPath.
    await provider.invoke({ cwd: repoPath, idea, branch });

    // 5. Stage the authored artifacts and commit on the spec branch.
    //    Use specific paths — never `git add -A`.
    await execFile('git', ['add', '.docs/specs', '.docs/stories', '.docs/plans'], {
      cwd: repoPath,
    });
    await execFile(
      'git',
      ['commit', '-m', `spec: author artifacts for "${idea}" [engineer/authorSpec]`],
      { cwd: repoPath },
    );
  } catch (err) {
    // Best-effort: restore HEAD to defaultBranch so deriveDefaultBranch() is
    // correct on the next call. Wrap in its own try/catch so a restore failure
    // doesn't mask the original error.
    try {
      await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });
    } catch {
      // restore failed — original error is still re-thrown below
    }
    // Best-effort: delete the dangling spec branch to prevent contamination.
    try {
      await execFile('git', ['branch', '-D', branch], { cwd: repoPath });
    } catch {
      // delete failed — original error is still re-thrown below
    }
    // Re-throw the original error verbatim (preserves message + name + stack).
    throw err;
  }

  // 6. Return to the default branch so the repo is left in a clean state.
  await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });

  return { branch, project: target.name };
}
