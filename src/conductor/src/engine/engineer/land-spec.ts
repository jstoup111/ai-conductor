// land-spec.ts — deterministic spec-branch landing primitive (Phase 9.3, ADR-008).
//
// PURPOSE:
//   Commit the artifacts that the REAL /brainstorm, /stories, /plan skills already wrote
//   into the target repo's .docs/ dirs, onto a spec/<slug> branch. This primitive does
//   NOT author (no decide seam, no subprocess). It validates, guards, commits, and returns.
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

  // 4. C2: require at least one file in each artifact dir.
  const specFile = await findNewestFile(specsDir);
  const storiesFile = await findNewestFile(storiesDir);
  const planFile = await findNewestFile(plansDir);

  if (!specFile || !storiesFile || !planFile) {
    const missing: string[] = [];
    if (!specFile) missing.push('spec');
    if (!storiesFile) missing.push('stories');
    if (!planFile) missing.push('plan');
    throw new Error(
      `landSpec: required artifact ${missing.join(', ')} ${missing.length === 1 ? 'file is' : 'files are'} missing ` +
        `in ".docs/" under "${repoPath}". Run the /brainstorm, /stories, /plan skills first.`,
    );
  }

  // Guard the file paths (C1).
  guard.assertWriteAllowed(specFile);
  guard.assertWriteAllowed(storiesFile);
  guard.assertWriteAllowed(planFile);

  // 4b. Read contents and validate.
  const specContent = await readFile(specFile, 'utf-8');
  const storiesContent = await readFile(storiesFile, 'utf-8');
  const planContent = await readFile(planFile, 'utf-8');

  validateArtifactContent('spec', specContent, idea);
  validateArtifactContent('stories', storiesContent, idea);
  validateArtifactContent('plan', planContent, idea);

  // 5. Branch, add, commit, return to default.
  const defaultBranch = await deriveDefaultBranch(repoPath);
  const slug = slugify(idea);
  const branch = await chooseBranchName(repoPath, slug);

  try {
    await execFile('git', ['checkout', '-b', branch, defaultBranch], { cwd: repoPath });

    await execFile('git', ['add', '.docs/specs', '.docs/stories', '.docs/plans'], {
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
