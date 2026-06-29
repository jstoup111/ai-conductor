// land-spec.ts — deterministic spec-branch landing primitive (Phase 9.3, ADR-008).
//
// PURPOSE:
//   Commit the full DECIDE artifact set the REAL skills already wrote into the target
//   repo's .docs/ dirs, onto a spec/<slug> branch. The engineer authors the WHOLE DECIDE
//   phase, so this lands brainstorm/stories/plan + the complexity marker, and (for a
//   non-Small tier) conflict-check/architecture-diagram/architecture-review + ADRs.
//   It validates (stories approved, tier-vs-artifacts consistent, no DRAFT ADR), guards,
//   commits, and returns. It does NOT author (no decide seam, no subprocess).
//
// CONTRACT: landSpec(target, idea) → Promise<{slug, branch, repoPath}>
//
//   1. Validate target.canonicalPath exists (TargetPathMissingError on failure).
//   2. Guard a clean working tree (fail fast on dirty, no stash/reset).
//   3. Identify the newest file in each of .docs/specs, .docs/stories, .docs/plans.
//      Use AuthoringGuard(target.canonicalPath).assertWriteAllowed(path) on each path (C1).
//   4. C2 regression guards — reject if ANY of:
//      - a required artifact dir/file is missing (at least one spec, one stories, one plan must exist)
//      - any artifact's content is empty/whitespace
//      - any artifact contains "Status: DRAFT" (case-insensitive)
//      - the stories artifact equals the known stub string
//   5. deriveDefaultBranch + chooseBranchName → git checkout -b <branch> <default>
//      git add .docs/specs .docs/stories .docs/plans, commit, git checkout <default>.
//   6. On any error: restore HEAD, delete the dangling branch, re-throw.

import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { TargetPathMissingError } from './target.js';
import { AuthoringGuard } from './authoring-guard.js';
import { deriveDefaultBranch, chooseBranchName, slugify } from './authoring.js';
import { isStoriesApproved, hasDraftAdr, parseComplexityTier, parseTrack } from '../artifacts.js';
import { writeIntakeMarker } from './intake-marker.js';

const execFile = promisify(execFileCb);

// ── Public types ──────────────────────────────────────────────────────────────

export interface LandSpecTarget {
  name: string;
  canonicalPath: string;
}

export interface LandSpecResult {
  slug: string;
  branch: string;
  repoPath: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Land the pre-written spec artifacts from .docs/ onto a spec/<slug> branch.
 *
 * Does NOT author anything — the real /brainstorm, /stories, /plan skills must
 * have already written the artifacts before this is called.
 */
export async function landSpec(
  target: LandSpecTarget,
  idea: string,
  sourceRef?: string,
): Promise<LandSpecResult> {
  const repoPath = target.canonicalPath;

  // 1. Validate the target path exists.
  try {
    await access(repoPath);
  } catch {
    throw new TargetPathMissingError(repoPath);
  }

  // 2. Guard against dirty tracked changes. No stash, no reset — fail fast.
  //
  //    We permit untracked files under .docs/ (these are the skills' output artifacts
  //    that landSpec is about to commit). We reject any other uncommitted change to
  //    tracked files — staged, modified, deleted, or renamed.
  //
  //    Implementation: `git status --porcelain` prefixes:
  //      '??' = untracked   → allowed if path starts with .docs/
  //      Any other prefix   → dirty tracked change → fail
  {
    const { stdout: porcelain } = await execFile('git', ['status', '--porcelain'], {
      cwd: repoPath,
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
        `landSpec: target repo at "${repoPath}" has uncommitted (dirty) changes outside .docs/: ${summary}. ` +
          'Commit or discard all tracked changes before running landSpec.',
      );
    }
  }

  // 3. Identify candidate artifacts.
  const guard = new AuthoringGuard(repoPath);
  const specsDir = join(repoPath, '.docs', 'specs');
  const storiesDir = join(repoPath, '.docs', 'stories');
  const plansDir = join(repoPath, '.docs', 'plans');

  // Guard the dir paths (C1: must be inside target prefix).
  guard.assertWriteAllowed(specsDir);
  guard.assertWriteAllowed(storiesDir);
  guard.assertWriteAllowed(plansDir);

  // Resolve the work track (ADR-015/017): a PRD/spec is required only on the
  // PRODUCT track. Technical-only features carry acceptance criteria in stories
  // and have no PRD. Track is read from `.docs/track/<slug>.md` (written by
  // /explore); a missing marker defaults to `product` (back-compat).
  const trackDir = join(repoPath, '.docs', 'track');
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
        `in ".docs/" under "${repoPath}". Run the /explore, /prd (product track), /stories, /plan skills first.`,
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
  const complexityDir = join(repoPath, '.docs', 'complexity');
  const decisionsDir = join(repoPath, '.docs', 'decisions');
  const complexityFile = await findNewestFile(complexityDir);
  const tier = complexityFile
    ? parseComplexityTier(await readFile(complexityFile, 'utf-8'))
    : undefined;

  if (tier && tier !== 'S') {
    const conflictsFile = await findNewestFile(join(repoPath, '.docs', 'conflicts'));
    const architectureFile = await findNewestFile(join(repoPath, '.docs', 'architecture'));
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

  // 5. Branch, add, commit, return to default.
  const defaultBranch = await deriveDefaultBranch(repoPath);
  const slug = slugify(idea);
  const branch = await chooseBranchName(repoPath, slug);

  try {
    await execFile('git', ['checkout', '-b', branch, defaultBranch], { cwd: repoPath });

    // Persist the intake origin alongside the spec so it survives the spec-PR
    // merge and reaches the daemon. No-op for hand-authored specs (no sourceRef).
    await writeIntakeMarker(repoPath, slug, sourceRef, guard);

    // Stage the whole `.docs` tree: the engineer authors specs/stories/plans +
    // complexity + (non-Small) conflicts/architecture/decisions + (intake) the
    // origin marker, and the dirty-tree guard above permits only `.docs/`
    // untracked files — so this commits exactly the DECIDE artifacts and leaves a
    // clean tree on checkout.
    await execFile('git', ['add', '.docs'], {
      cwd: repoPath,
    });
    await execFile(
      'git',
      ['commit', '-m', `spec: land authored artifacts for "${idea}" [engineer/land]`],
      { cwd: repoPath },
    );
  } catch (err) {
    // Restore HEAD and delete the dangling branch on failure.
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

  // Leave the repo on the default branch.
  await execFile('git', ['checkout', defaultBranch], { cwd: repoPath });

  return { slug, branch, repoPath };
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
