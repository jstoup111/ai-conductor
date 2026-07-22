// land-spec.ts — deterministic spec-branch landing primitive (Phase 9.3, ADR-008).
//
// PURPOSE:
//   Commit the full DECIDE artifact set the REAL skills already wrote into the target
//   repo's .docs/ dirs, onto a spec/<slug> branch. The engineer authors the WHOLE DECIDE
//   phase, so this lands the PRD/stories/plan + the complexity marker, and (for a
//   non-Small tier) conflict-check/architecture-diagram/architecture-review + ADRs.
//   It validates (stories approved, tier-vs-artifacts consistent, no DRAFT ADR), guards,
//   commits, and returns. It does NOT author (no decide seam, no subprocess).
//
// CONTRACT: landSpec(target, idea, worktreePath, sourceRef?) → Promise<{slug, branch, repoPath}>
//
//   WORKTREE ISOLATION (FR-1/2/9): landSpec operates ENTIRELY inside the per-idea
//   worktree (`worktreePath`) the caller created on the idea's `spec/<slug>` branch.
//   The target's PRIMARY working tree is never touched — no `git checkout` against it.
//   The old `checkout -b <branch> <default>` → commit → `checkout <default>` dance in
//   the shared checkout is GONE; the branch already exists as the worktree's branch, so
//   `land` commits in place.
//
//   1. Validate worktreePath exists (the worktree primitive must have created it) and
//      the registry canonicalPath exists (TargetPathMissingError on failure).
//   2. Guard a clean worktree (fail fast on dirty tracked files; untracked .docs allowed).
//   3. Identify the newest file in each of worktreePath/.docs/{specs,stories,plans}.
//      Use AuthoringGuard(target.canonicalPath) on each path (C1 — worktree ⊂ target).
//   4. C2 regression guards — reject if ANY of:
//      - a required artifact dir/file is missing (at least one spec, one stories, one plan must exist)
//      - any artifact's content is empty/whitespace
//      - any artifact contains "Status: DRAFT" (case-insensitive)
//      - the stories artifact equals the known stub string
//   5. Commit in place: write the intake marker, `git add .docs`, `git commit` — all with
//      cwd = worktreePath. No branch creation, no checkout of the primary tree.
//   6. On failure: leave the worktree in place (keep-on-failure, FR-6) and re-throw. The
//      branch is the worktree's branch — never deleted here.

import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { TargetPathMissingError } from './target.js';
import { AuthoringGuard } from './authoring-guard.js';
import { slugify } from './authoring.js';
import { isStoriesApproved, hasDraftAdr, parseComplexityTier, parseTrack, planStem } from '../artifacts.js';
import { deriveDefaultBranch } from './authoring.js';
import { withEngineCommitEnv } from '../engine-commit-env.js';
import { writeIntakeMarker } from './intake-marker.js';
import { resolveDaemonOwner, type OwnerConfig, type GhRunner } from '../owner-gate/identity.js';

const execFile = promisify(execFileCb);

// ── Public types ──────────────────────────────────────────────────────────────

export interface LandSpecTarget {
  name: string;
  canonicalPath: string;
}

/**
 * Owner-resolution injectables (ADR-1 identity chain). Both are optional at the
 * type level; Task 17 threads real config + a gh runner from the CLI. When
 * neither resolves an owner, landSpec FAILS CLOSED (slice B, D3): it throws
 * before any write — a spec is never landed un-owned.
 */
export interface LandSpecOptions {
  /** Config surface for owner resolution (reads `spec_owner`). */
  ownerConfig?: OwnerConfig;
  /** gh runner for the login fallback; injected in tests / by the CLI. */
  gh?: GhRunner;
}

export interface LandSpecResult {
  slug: string;
  branch: string;
  repoPath: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Land the pre-written spec artifacts from the per-idea worktree's .docs/ onto its
 * `spec/<slug>` branch (in place — the branch already exists as the worktree branch).
 *
 * Does NOT author anything — the real /explore, /prd, /stories, /plan skills must
 * have already written the artifacts into the worktree before this is called.
 *
 * @param worktreePath - The per-idea worktree (cwd for ALL git/fs ops). The target's
 *   primary working tree is never touched (FR-2).
 * @param opts - Owner-resolution injectables (owner-gate identity chain).
 */
export async function landSpec(
  target: LandSpecTarget,
  idea: string,
  worktreePath: string,
  sourceRef?: string,
  opts: LandSpecOptions = {},
): Promise<LandSpecResult> {
  const canonical = target.canonicalPath;

  // 1. Validate the worktree exists (the worktree primitive must have created it) and
  //    the registry's canonical target path still exists.
  try {
    await access(worktreePath);
  } catch {
    throw new Error(
      `landSpec: per-idea worktree "${worktreePath}" does not exist. ` +
        'Create the worktree (conduct-ts engineer worktree) before landing — landSpec never ' +
        'falls back to the primary checkout.',
    );
  }
  try {
    await access(canonical);
  } catch {
    throw new TargetPathMissingError(canonical);
  }

  // 2. Guard against dirty tracked changes IN THE WORKTREE. No stash, no reset — fail fast.
  //
  //    We permit untracked files under .docs/ (the skills' output artifacts that
  //    landSpec is about to commit). We reject any other uncommitted change to
  //    tracked files — staged, modified, deleted, or renamed — so a dirty leftover
  //    worktree never yields a silent stale-artifact land (FR-11 negative).
  //
  //    Implementation: `git status --porcelain` prefixes:
  //      '??' = untracked   → allowed if path starts with .docs/
  //      Any other prefix   → dirty tracked change → fail
  {
    const { stdout: porcelain } = await execFile('git', ['status', '--porcelain'], {
      cwd: worktreePath,
    });
    const lines = porcelain.trim() === '' ? [] : porcelain.trim().split('\n');
    const dirtyLines = lines.filter((line) => {
      const prefix = line.slice(0, 2);
      const path = line.slice(3).trim().replace(/^"(.*)"$/, '$1'); // strip optional git-quoting
      if (prefix === '??') {
        // Untracked: allowed if under .docs/
        return !path.startsWith('.docs/') && !path.startsWith('.docs\\');
      }
      // Any other status (staged, modified, deleted, renamed) → dirty
      return true;
    });

    if (dirtyLines.length > 0) {
      const summary = dirtyLines.map((l) => l.trim()).join(', ');
      throw new Error(
        `landSpec: per-idea worktree at "${worktreePath}" has uncommitted (dirty) changes outside .docs/: ${summary}. ` +
          'Recreate the worktree or discard tracked changes before running landSpec.',
      );
    }
  }

  // 2a. Identity resolution gate (fail-closed). The authoring owner must be resolvable
  //     before any write (writeIntakeMarker / git add / commit). This runs early (before
  //     artifact guards) so identity issues are surfaced first, and unresolved identity
  //     never reaches any other validation check.
  const unresolvableGh: GhRunner = async () => {
    throw new Error('landSpec: no gh runner injected for owner resolution');
  };
  const ownerResolution = await resolveDaemonOwner(
    opts.ownerConfig ?? {},
    opts.gh ?? unresolvableGh,
    canonical,
  );
  if (!ownerResolution.resolved) {
    throw new Error(
      'landSpec: identity is unresolved — spec cannot be authored without a known owner. ' +
      'To resolve, either: (1) configure `spec_owner` in ~/.ai-conductor/config.yml, or ' +
      '(2) run `gh auth login` to authenticate.',
    );
  }
  const specOwner = ownerResolution.id;

  // 3. Identify candidate artifacts inside the worktree. The AuthoringGuard is rooted
  //    at the registry canonical path (C1 cross-repo isolation, ADR-004); the worktree
  //    is a descendant of it, so every worktree/.docs path passes the guard while any
  //    path escaping the target repo is still rejected.
  const guard = new AuthoringGuard(canonical);
  const specsDir = join(worktreePath, '.docs', 'specs');
  const storiesDir = join(worktreePath, '.docs', 'stories');
  const plansDir = join(worktreePath, '.docs', 'plans');

  // Guard the dir paths (C1: must be inside target prefix).
  guard.assertWriteAllowed(specsDir);
  guard.assertWriteAllowed(storiesDir);
  guard.assertWriteAllowed(plansDir);

  // Resolve the work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location): a PRD/spec is required only on the
  // PRODUCT track. Technical-only features carry acceptance criteria in stories
  // and have no PRD. Track is read from `.docs/track/<slug>.md` (written by
  // /explore); a missing marker defaults to `product` (back-compat).
  const trackDir = join(worktreePath, '.docs', 'track');
  const trackFile = await findNewestFile(trackDir);
  const track = parseTrack(trackFile ? await readFile(trackFile, 'utf-8') : null) ?? 'product';
  const specRequired = track === 'product';

  // 4. C2: require stories + plan always; spec only on the product track.
  const specFile = await findNewestFile(specsDir);
  const storiesFile = await findNewestFile(storiesDir);
  const planFile = await findNewestFile(plansDir);

  if ((specRequired && !specFile) || !storiesFile || !planFile) {
    const missing: string[] = [];
    if (specRequired && !specFile) missing.push('spec (product track)');
    if (!storiesFile) missing.push('stories');
    if (!planFile) missing.push('plan');
    throw new Error(
      `landSpec: required artifact ${missing.join(', ')} ${missing.length === 1 ? 'file is' : 'files are'} missing ` +
        `in ".docs/" under "${worktreePath}". Run the /explore, /prd (product track), /stories, /plan skills first.`,
    );
  }

  // Guard the file paths (C1). spec may be absent on the technical track.
  if (specFile) guard.assertWriteAllowed(specFile);
  guard.assertWriteAllowed(storiesFile);
  guard.assertWriteAllowed(planFile);

  // 4b. Read contents and validate. The spec is validated only when present
  // (always present on product; absent on technical).
  const storiesContent = await readFile(storiesFile, 'utf-8');
  const planContent = await readFile(planFile, 'utf-8');

  if (specFile) {
    validateArtifactContent('spec', await readFile(specFile, 'utf-8'), idea);
  }
  validateArtifactContent('stories', storiesContent, idea);
  validateArtifactContent('plan', planContent, idea);

  // 4c. Stories MUST carry the canonical approval marker — not merely "not DRAFT".
  // validateArtifactContent only rejects DRAFT/empty/stub, so a stories file with
  // NO status line lands fine here yet is skipped FOREVER by the daemon (which
  // requires "Status: Accepted"). Require the marker at land time so that
  // mismatch can never reach a silently-skipping daemon. (Applied to stories
  // only — the PRD/spec uses "Status: Approved" and the plan has no status.)
  if (!isStoriesApproved(storiesContent)) {
    throw new Error(
      'landSpec: stories artifact is not approved — it must declare "Status: Accepted" ' +
        '(and no "Status: DRAFT"). Run the /stories skill and approve before landing.',
    );
  }

  // 4d. Tier-conditional DECIDE completeness. The engineer authors the full
  //     DECIDE phase; the daemon pre-seeds conflict_check + architecture_* as
  //     done and reads the tier from `.docs/complexity/`. Enforce that what the
  //     engineer CLAIMED (the tier) matches what it produced, so a non-Small
  //     spec can never reach the daemon missing conflict-check or architecture.
  const complexityDir = join(worktreePath, '.docs', 'complexity');
  const decisionsDir = join(worktreePath, '.docs', 'decisions');
  const complexityFile = await findNewestFile(complexityDir);
  const tier = complexityFile
    ? parseComplexityTier(await readFile(complexityFile, 'utf-8'))
    : undefined;

  if (tier && tier !== 'S') {
    const conflictsFile = await findNewestFile(join(worktreePath, '.docs', 'conflicts'));
    const architectureFile = await findNewestFile(join(worktreePath, '.docs', 'architecture'));
    const reviewFile = await findNewestFile(decisionsDir);
    const missing: string[] = [];
    if (!conflictsFile) missing.push('conflicts');
    if (!architectureFile) missing.push('architecture');
    if (!reviewFile) missing.push('decisions (architecture-review/ADRs)');
    if (missing.length > 0) {
      throw new Error(
        `landSpec: complexity tier is "${tier}" (non-Small) but required DECIDE artifact ` +
          `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing in ".docs/". ` +
          'Run /conflict-check, /architecture-diagram, and /architecture-review before landing.',
      );
    }
  }

  // 4e. ADR hard gate — no spec lands with a DRAFT ADR (mirrors the conduct
  //     architecture-review gate). Scan every `.docs/decisions/adr-*.md`.
  for (const adrFile of await listAdrFiles(decisionsDir)) {
    const adrContent = await readFile(adrFile, 'utf-8');
    if (hasDraftAdr(adrContent)) {
      throw new Error(
        `landSpec: ADR "${adrFile}" still carries "Status: DRAFT". All ADRs must be ` +
          'APPROVED before landing. Approve the ADRs via /architecture-review, then land.',
      );
    }
  }

  // 5. Commit in place on the worktree's branch. The branch already exists (it is the
  //    worktree's checked-out branch) — no `checkout -b`, no `checkout back`, and the
  //    primary working tree is never touched (FR-2). On failure we leave the worktree
  //    for inspection (FR-6) and never delete its branch.
  const slug = slugify(idea);
  const { stdout: headRef } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
  });
  const branch = headRef.trim();

  // Persist the intake origin + owner alongside the spec (inside the worktree) so both
  // survive the spec-PR merge and reach the daemon. The owner is already resolved above
  // (fail-closed gate at step 2a), so specOwner is guaranteed to be non-null here.
  const markerSlug = planStem(planFile);
  await writeIntakeMarker(worktreePath, markerSlug, sourceRef, specOwner, guard);

  // Stage ONLY the `.docs` tree (never `add -A`): the per-idea worktree holds exactly
  // this idea's artifacts, so the commit is idea-scoped and no foreign untracked file
  // can bleed in (FR-9). Commit in place on the worktree's branch — no checkout of the
  // primary tree (FR-2).
  await execFile('git', ['add', '.docs'], { cwd: worktreePath });
  await execFile(
    'git',
    ['commit', '-m', `spec: land authored artifacts for "${idea}" [engineer/land]`],
    { cwd: worktreePath, env: withEngineCommitEnv() },
  );

  return { slug, branch, repoPath: worktreePath };
}

// ── Idea-scoped attribution (foundational helper; wired in later tasks) ───────

/**
 * Resolve the set of `.docs/`-relative paths attributable to THIS idea's worktree
 * — the union of artifacts committed on the idea's branch (since it diverged from
 * the target's default branch) and artifacts left untracked in the worktree.
 *
 * This is the attribution universe later pickers (Tasks 2-3) filter candidates
 * against, so a corpus-wide directory scan can never pick up a legacy file that
 * merely happens to live on `main`.
 *
 * @param worktreePath - cwd for all git ops (shares the target repo's object store).
 * @param canonicalPath - the target's registry canonical path, used to derive the
 *   default branch the same way the worktree primitive did at creation time.
 */
export async function resolveIdeaFiles(
  worktreePath: string,
  canonicalPath: string,
): Promise<Set<string>> {
  const defaultBranch = await deriveDefaultBranch(canonicalPath);

  const { stdout: baseOut } = await execFile(
    'git',
    ['merge-base', 'HEAD', defaultBranch],
    { cwd: worktreePath },
  );
  const base = baseOut.trim();

  const { stdout: diffOut } = await execFile(
    'git',
    ['diff', '--name-only', base, 'HEAD'],
    { cwd: worktreePath },
  );
  const committed = diffOut.trim() === '' ? [] : diffOut.trim().split('\n');

  const { stdout: porcelainOut } = await execFile(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: worktreePath },
  );
  const porcelainLines = porcelainOut.trim() === '' ? [] : porcelainOut.trim().split('\n');
  const untracked = porcelainLines
    .filter((line) => line.slice(0, 2) === '??')
    .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, '$1'));

  const all = [...committed, ...untracked];
  const ideaFiles = new Set<string>();
  for (const p of all) {
    if (p.startsWith('.docs/') || p.startsWith('.docs\\')) {
      ideaFiles.add(p);
    }
  }
  return ideaFiles;
}

/**
 * Pick the artifact `.md` file in `dir` to use, restricted to files ALSO present
 * in `ideaFiles` (the attribution universe from `resolveIdeaFiles`). Zero matching
 * candidates → `null` (missing-artifact semantics, unchanged from `findNewestFile`).
 * Multiple candidates → newest mtime, but ONLY among the idea's own candidates —
 * mtime is never used to compare against a legacy file outside the attribution set.
 */
export async function pickIdeaFile(dir: string, ideaFiles: Set<string>): Promise<string | null> {
  try {
    await access(dir);
  } catch {
    return null;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // ideaFiles paths are `.docs/...`-relative to the worktree root. `dir` is an
  // absolute path somewhere under `<worktreeRoot>/.docs/...`, so recover each
  // candidate's `.docs/`-relative path by slicing from the last `.docs` segment.
  const docsRel = (abs: string): string | null => {
    const normalized = abs.split('\\').join('/');
    const idx = normalized.lastIndexOf('/.docs/');
    if (idx === -1) return null;
    return normalized.slice(idx + 1);
  };

  const matches: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !String(e.name).endsWith('.md')) continue;
    const abs = join(dir, String(e.name));
    const rel = docsRel(abs);
    if (rel !== null && ideaFiles.has(rel)) {
      matches.push(abs);
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  let newest = matches[0];
  let newestMtime = 0;
  for (const m of matches) {
    try {
      const { mtimeMs } = await import('node:fs/promises').then((mod) => mod.stat(m));
      if (mtimeMs > newestMtime) {
        newestMtime = mtimeMs;
        newest = m;
      }
    } catch {
      // ignore stat errors; keep current best
    }
  }
  return newest;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Find the newest .md file in a directory (by mtime). Returns null if the
 * directory does not exist or contains no .md files.
 */
async function findNewestFile(dir: string): Promise<string | null> {
  try {
    await access(dir);
  } catch {
    return null;
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Filter to markdown files only. Coerce e.name to string so the result is
  // overload-independent (some @types/node versions type Dirent.name as Buffer).
  const mdFiles = entries
    .filter((e) => e.isFile() && String(e.name).endsWith('.md'))
    .map((e) => join(dir, String(e.name)));

  if (mdFiles.length === 0) return null;

  // With a single file (the common case) return it directly; otherwise pick newest.
  if (mdFiles.length === 1) return mdFiles[0];

  // For multiple files, pick the one with the highest mtime.
  let newest = mdFiles[0];
  let newestMtime = 0;
  for (const f of mdFiles) {
    try {
      const { mtimeMs } = await import('node:fs/promises').then((m) => m.stat(f));
      if (mtimeMs > newestMtime) {
        newestMtime = mtimeMs;
        newest = f;
      }
    } catch {
      // ignore stat errors; keep current best
    }
  }
  return newest;
}

/**
 * List `.docs/decisions/adr-*.md` files (absolute paths). Returns [] when the
 * directory is absent or holds no ADR files.
 */
async function listAdrFiles(decisionsDir: string): Promise<string[]> {
  try {
    await access(decisionsDir);
  } catch {
    return [];
  }
  let entries;
  try {
    entries = await readdir(decisionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /^adr-.*\.md$/i.test(String(e.name)))
    .map((e) => join(decisionsDir, String(e.name)));
}

/** Known stub string fragments (the shipped bug). */
const STUB_PATTERN = /_Generated by engineer\._/i;

/**
 * Validate a single artifact's content per C2 rules.
 * Throws a field-named error on any violation.
 */
function validateArtifactContent(label: string, content: string, _idea: string): void {
  if (content.trim() === '') {
    throw new Error(
      `landSpec: ${label} artifact is empty/blank. Run the corresponding DECIDE skill to produce real content.`,
    );
  }

  // Match "Status: DRAFT" in plain YAML (`status: draft`), markdown bold
  // (`**Status:** DRAFT`), or any variant — the DECIDE skills use different formats.
  // We match "status" followed (on the same line) by "draft", ignoring markdown
  // bold/italic markers and arbitrary whitespace/punctuation between them.
  if (/status[^:\n]*:\s*[\*_]*\s*draft/i.test(content)) {
    throw new Error(
      `landSpec: ${label} artifact contains "Status: DRAFT" and has not been approved. ` +
        'The artifact must be accepted/approved before landing.',
    );
  }

  if (STUB_PATTERN.test(content)) {
    throw new Error(
      `landSpec: ${label} artifact contains a stub/generated placeholder ("_Generated by engineer._"). ` +
        'Replace it with real content from the /stories skill before landing.',
    );
  }
}
