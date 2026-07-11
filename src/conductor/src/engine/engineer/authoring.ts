// authoring.ts — Prompt builder + gated authoring runner (Tasks 14 & 32/33, FR-5/FR-6).
//
// `buildAuthoringPrompt` (Task 14, FR-5):
//   Embeds the LessonDigest into the prompt text so that a downstream reader
//   (LLM or evaluator) can observe prior lessons directly in the prompt context
//   without requiring a separate retrieval step.
//
// `runAuthoring` (Tasks 32/33, FR-6, C2, ADR-008):
//   Runs the FULL DECIDE phase via an AGENT-HOSTED seam (no subprocess), in
//   canonical conduct order: explore → complexity → prd → architecture_diagram →
//   architecture_review → stories → conflict_check → plan. The complexity tier
//   gates architecture + conflict-check (Small skips them); the track gates the
//   PRD (technical skips it).
//   - deps.decide is INJECTABLE — called once per markdown step.
//   - deps.assessComplexity is INJECTABLE — called once after explore; its
//     tier is persisted to `.docs/complexity/<slug>.md` for the daemon.
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
import { isStoriesApproved, hasDraftAdr } from '../artifacts.js';
import { writeIntakeMarker } from './intake-marker.js';
import { resolveDaemonOwner, type OwnerConfig, type GhRunner } from '../owner-gate/identity.js';
import { writeTrackMarker } from './track-marker.js';
import type { ComplexityTier, Track } from '../../types/index.js';
import { withEngineCommitEnv } from '../engine-commit-env.js';

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
 * The markdown-producing DECIDE steps the `decide` seam is called for, in
 * canonical conduct order. `complexity` is NOT here — it produces a tier, not a
 * markdown artifact, and flows through the separate `assessComplexity` seam.
 */
export type DecideStep =
  | 'explore'
  | 'prd'
  | 'stories'
  | 'conflict_check'
  | 'architecture_diagram'
  | 'architecture_review'
  | 'plan';

/**
 * Result of the complexity-assessment seam. Unlike `decide` (which returns a
 * markdown artifact), complexity yields a tier that gates which later DECIDE
 * steps run (Small skips conflict-check + architecture) and is persisted to
 * `.docs/complexity/<slug>.md` so the daemon can consume it at build time.
 */
export interface AssessComplexityResult {
  approved: boolean;
  tier: ComplexityTier;
}

/**
 * Dependencies injected into runAuthoring.
 *
 * `decide` is the host-agent DECIDE seam — it is called once per markdown step
 * (explore → prd → architecture_diagram →
 * architecture_review → plan) and returns the human-gated artifact.
 *
 * `assessComplexity` is the host-agent complexity seam — called once, after
 * explore and before prd, returning the operator-approved tier.
 *
 * `spawn` is the optional child-process spawn shim (repo convention).
 * runAuthoring never calls it — the field exists only so the acceptance-test
 * spawn spy can confirm that no `claude` subprocess was launched.
 */
export interface RunAuthoringDeps {
  decide: (step: DecideStep) => Promise<DecideResult>;
  /**
   * Complexity seam. OPTIONAL at this layer: when absent, runAuthoring defaults
   * to an approved Small assessment (which skips conflict-check + architecture),
   * so a seam-less call behaves like the lightweight explore→stories→plan flow.
   * Production NEVER relies on this default — `processIdea` (loop.ts) requires
   * the seam and fails closed if it is missing.
   */
  assessComplexity?: (recommended: ComplexityTier | null) => Promise<AssessComplexityResult>;
  spawn?: (...args: any[]) => any;
  /**
   * Originating intake reference (`owner/repo#N`). When present and valid, a
   * `.docs/intake/<slug>.md` marker is committed with the spec so the daemon can
   * later link/close the issue. Absent/malformed → no marker (hand-authored
   * specs are unchanged).
   */
  sourceRef?: string;
  /**
   * Owner-resolution injectables (ADR-1 identity chain), mirroring landSpec
   * (Task 16). Both are OPTIONAL so existing callers are unchanged; `processIdea`
   * (loop.ts) threads the target repo's config + the in-scope gh runner. When
   * neither resolves an owner, the spec is stamped un-owned (the `Owner:` line is
   * omitted — NOT blank/falsely-owned).
   *
   * `ownerConfig` — config surface for owner resolution (reads `spec_owner`).
   * `gh` — gh runner for the login fallback; injected in tests / by the caller.
   */
  ownerConfig?: OwnerConfig;
  gh?: GhRunner;
  /**
   * Work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). When provided, a `.docs/track/<slug>.md` marker is
   * committed with the spec. Defaults to `product` (preserves legacy behavior).
   */
  track?: Track;
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
 *  2. Runs the full DECIDE phase IN CANONICAL ORDER: decide('explore') →
 *     assessComplexity() → decide('stories') → (when tier !== 'S')
 *     decide('conflict_check') → decide('architecture_diagram') →
 *     decide('architecture_review') → decide('plan'). If ANY gate returns
 *     { approved: false } (or a DRAFT ADR is detected) → throws; nothing is written.
 *  3. On all-approved: creates spec/<slug> branch, writes artifacts via AuthoringGuard
 *     (always specs/stories/plans + `.docs/complexity/<slug>.md`; non-Small also
 *     conflicts/architecture/decisions), commits on that branch, returns { branch, project }.
 *  4. NEVER spawns claude or any other subprocess (except git via execFile).
 *  5. All filesystem writes are guarded by AuthoringGuard(target.canonicalPath).
 *
 * @param target  { name, canonicalPath } — the target project.
 * @param idea    The feature idea to author.
 * @param deps    Injected dependencies: decide + assessComplexity seams + optional spawn shim.
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

  // 2. Run the full DECIDE phase IN CANONICAL ORDER. Any unapproved gate throws
  //    immediately; NOTHING is written to the filesystem below this block, so a
  //    late rejection never leaves a half-authored spec. The tier (from the
  //    complexity seam) gates whether conflict-check + architecture run — Small
  //    skips them, exactly mirroring the conductor's `skippableForTiers: ['S']`.
  const gate = async (step: DecideStep): Promise<DecideResult> => {
    const result = await deps.decide(step);
    if (!result.approved) {
      throw new Error(
        `runAuthoring: DECIDE gate "${step}" was not approved. Authoring blocked — no artifacts written.`,
      );
    }
    return result;
  };

  // Divergent step — context + approaches; decides the track. Its output is not
  // the spec (the PRD is authored by the `prd` gate on the product track).
  await gate('explore');

  // Default (no seam): an approved Small tier — skips conflict-check + architecture,
  // preserving the lightweight explore→stories→plan flow. Production supplies a real seam.
  const assessComplexity =
    deps.assessComplexity ?? (async () => ({ approved: true, tier: 'S' as const }));
  const complexity = await assessComplexity(null);
  if (!complexity.approved) {
    throw new Error(
      `runAuthoring: complexity assessment was not approved. Authoring blocked — no artifacts written.`,
    );
  }
  const tier = complexity.tier;
  const track = deps.track ?? 'product';

  // PRD — product track only (adr-2026-06-29-explore-prd-split-track-in-explore). The PRD artifact becomes the spec.
  let prdResult: DecideResult | null = null;
  if (track === 'product') {
    prdResult = await gate('prd');
  }

  // Tier-conditional architecture — now BEFORE stories (adr-2026-06-29-architecture-before-stories-convergent-kickback), so the design
  // (and its ADRs) is settled before behavior is enumerated. Small skips it.
  let architectureDiagramResult: DecideResult | null = null;
  let architectureReviewResult: DecideResult | null = null;
  if (tier !== 'S') {
    architectureDiagramResult = await gate('architecture_diagram');
    architectureReviewResult = await gate('architecture_review');
    // ADR hard gate: no spec lands with a DRAFT ADR (mirrors the conduct
    // architecture-review gate). The review artifact embeds the ADRs.
    if (hasDraftAdr(architectureReviewResult.artifact)) {
      throw new Error(
        'runAuthoring: architecture-review artifact contains a DRAFT ADR — all ADRs must be ' +
          'APPROVED before landing. Approve the ADRs and re-run architecture-review.',
      );
    }
  }

  // Stories follow architecture (the always-present acceptance-criteria artifact).
  const storiesResult = await gate('stories');
  if (!isStoriesApproved(storiesResult.artifact)) {
    throw new Error(
      'runAuthoring: stories artifact from DECIDE is not approved — it must declare ' +
        '"Status: Accepted" (and no "Status: DRAFT"). The /stories skill stamps this on approval.',
    );
  }

  // Conflict-check runs AFTER stories (it operates on them); Small skips it.
  let conflictResult: DecideResult | null = null;
  if (tier !== 'S') {
    conflictResult = await gate('conflict_check');
  }

  const planResult = await gate('plan');

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

    // Date stamp for date-named artifacts (conflicts / architecture-review).
    // `new Date()` is fine here — this is conductor TS, not a sandboxed workflow.
    const date = new Date().toISOString().slice(0, 10);

    // Paths under target repo. Always: specs/stories/plans + the complexity
    // marker. Tier-conditional (non-Small): conflicts/architecture/decisions.
    const storiesDir = join(repoPath, '.docs', 'stories');
    const plansDir = join(repoPath, '.docs', 'plans');
    const specsDir = join(repoPath, '.docs', 'specs');
    const complexityDir = join(repoPath, '.docs', 'complexity');
    const storiesFile = join(storiesDir, `${fileSlug}.md`);
    const plansFile = join(plansDir, `${fileSlug}.md`);
    const specsFile = join(specsDir, `${fileSlug}.md`);
    const complexityFile = join(complexityDir, `${fileSlug}.md`);

    // Guard every path before any write.
    guard.assertWriteAllowed(storiesDir);
    guard.assertWriteAllowed(plansDir);
    guard.assertWriteAllowed(complexityDir);
    guard.assertWriteAllowed(storiesFile);
    guard.assertWriteAllowed(plansFile);
    guard.assertWriteAllowed(complexityFile);

    // Create directories and write artifact files.
    await mkdir(storiesDir, { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await mkdir(complexityDir, { recursive: true });

    // Write stories verbatim from DECIDE (contains "Status: Accepted"). The
    // approval marker was already enforced in the gate block above.
    await writeFile(storiesFile, storiesResult.artifact, 'utf8');

    // Write plan verbatim from DECIDE (contains "## Task Dependency Graph").
    await writeFile(plansFile, planResult.artifact, 'utf8');

    // Write the PRD as the spec artifact — PRODUCT track only. On the technical
    // track there is no PRD; acceptance criteria live in the stories.
    if (prdResult) {
      guard.assertWriteAllowed(specsDir);
      guard.assertWriteAllowed(specsFile);
      await mkdir(specsDir, { recursive: true });
      await writeFile(specsFile, prdResult.artifact, 'utf8');
    }

    // Write the complexity marker — keyed by the SAME stem as the plan so the
    // daemon resolves it deterministically (`.docs/complexity/<plan-stem>.md`).
    await writeFile(
      complexityFile,
      `# Complexity Assessment: ${idea}\n\nTier: ${tier}\n`,
      'utf8',
    );

    // Tier-conditional artifacts (skipped for Small).
    if (tier !== 'S') {
      const conflictsDir = join(repoPath, '.docs', 'conflicts');
      const architectureDir = join(repoPath, '.docs', 'architecture');
      const decisionsDir = join(repoPath, '.docs', 'decisions');
      const conflictsFile = join(conflictsDir, `${date}-${fileSlug}.md`);
      const architectureFile = join(architectureDir, `${fileSlug}.md`);
      const reviewFile = join(decisionsDir, `architecture-review-${date}-${fileSlug}.md`);

      guard.assertWriteAllowed(conflictsDir);
      guard.assertWriteAllowed(architectureDir);
      guard.assertWriteAllowed(decisionsDir);
      guard.assertWriteAllowed(conflictsFile);
      guard.assertWriteAllowed(architectureFile);
      guard.assertWriteAllowed(reviewFile);

      await mkdir(conflictsDir, { recursive: true });
      await mkdir(architectureDir, { recursive: true });
      await mkdir(decisionsDir, { recursive: true });

      await writeFile(conflictsFile, conflictResult!.artifact, 'utf8');
      await writeFile(architectureFile, architectureDiagramResult!.artifact, 'utf8');
      await writeFile(reviewFile, architectureReviewResult!.artifact, 'utf8');
    }

    // Resolve the authoring owner via the identity chain (configured → gh →
    // unresolved), mirroring landSpec (Task 16). Unresolved yields a null owner →
    // un-owned (the `Owner:` line is omitted, NOT blank/falsely-owned). A gh
    // runner is required only for the login fallback; when none is injected, an
    // unresolvable stub degrades to unresolved rather than throwing.
    const unresolvableGh: GhRunner = async () => {
      throw new Error('runAuthoring: no gh runner injected for owner resolution');
    };
    const ownerResolution = await resolveDaemonOwner(
      deps.ownerConfig ?? {},
      deps.gh ?? unresolvableGh,
      repoPath,
    );
    const specOwner = ownerResolution.resolved ? ownerResolution.id : null;

    // Intake origin marker: persists the originating issue ref AND the resolved
    // owner WITH the spec so both survive the spec-PR merge and reach the daemon
    // (which closes the issue on merge and gates the build by owner). The owner is
    // stamped when resolved and the `Owner:` line is OMITTED when unresolved — a
    // no-op only when NEITHER a valid sourceRef nor an owner is present
    // (hand-authored, un-owned spec).
    await writeIntakeMarker(repoPath, slug, deps.sourceRef, specOwner, guard);

    // Track marker (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location): persists the product/technical classification
    // WITH the spec so the daemon knows whether to expect a PRD / run prd-audit.
    // Defaults to `product` (preserves the legacy PRD-authoring behavior).
    await writeTrackMarker(repoPath, slug, deps.track ?? 'product', guard);

    // 3c. Stage and commit all spec artifacts on the spec branch. Staging the
    //     whole `.docs` tree commits exactly the artifacts written above (the
    //     dirty-tree guard at the top guarantees nothing else is uncommitted),
    //     and returns the repo to a clean state after checkout back to default.
    await execFile('git', ['add', '.docs'], {
      cwd: repoPath,
    });
    await execFile(
      'git',
      ['commit', '-m', `spec: author artifacts for "${idea}" [engineer/runAuthoring]`],
      { cwd: repoPath, env: withEngineCommitEnv() },
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
