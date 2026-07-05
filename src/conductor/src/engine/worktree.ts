import { mkdir, readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

/**
 * Run a git command in the given directory, returning stdout.
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/**
 * Slugify a feature description into a URL-safe directory/branch name.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/-$/g, '')
    .slice(0, 50);
}

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  featureStatus?: string;
}

export class WorktreeManager {
  constructor(private projectRoot: string) {}

  async create(featureDesc: string): Promise<{ path: string; branch: string }> {
    const baseSlug = slugify(featureDesc);
    const worktreesDir = join(this.projectRoot, '.worktrees');

    await mkdir(worktreesDir, { recursive: true });

    // Check if worktree already exists for this slug
    let slug = baseSlug;
    let worktreePath = join(worktreesDir, slug);
    let branch = `feature/${slug}`;

    if (await this.dirExists(worktreePath)) {
      // Check if same branch — reuse
      try {
        const existingBranch = await git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD');
        if (existingBranch === branch) {
          return { path: worktreePath, branch };
        }
      } catch {
        // directory exists but isn't a valid worktree — fall through to collision handling
      }
      // Slug collision with different branch — append suffix
      let suffix = 2;
      while (await this.dirExists(join(worktreesDir, `${baseSlug}-${suffix}`))) {
        suffix++;
      }
      slug = `${baseSlug}-${suffix}`;
      worktreePath = join(worktreesDir, slug);
      branch = `feature/${slug}`;
    }

    await git(this.projectRoot, 'worktree', 'add', '-b', branch, worktreePath);

    return { path: worktreePath, branch };
  }

  async cleanup(name: string): Promise<void> {
    const worktreePath = join(this.projectRoot, '.worktrees', name);
    const branch = `feature/${name}`;

    // Remove worktree (--force handles dirty worktrees)
    try {
      await git(this.projectRoot, 'worktree', 'remove', '--force', worktreePath);
    } catch {
      // If worktree remove fails (e.g., already removed), clean up manually
      const { rm } = await import('fs/promises');
      await rm(worktreePath, { recursive: true, force: true });
      // Prune stale worktree entries
      await git(this.projectRoot, 'worktree', 'prune');
    }

    // Delete the branch
    try {
      await git(this.projectRoot, 'branch', '-D', branch);
    } catch {
      // Branch may already be deleted — ignore
    }
  }

  private async dirExists(path: string): Promise<boolean> {
    try {
      const s = await stat(path);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if a PR is merged and clean up the worktree if so.
   * Returns true if the worktree was cleaned up.
   */
  async cleanupIfMerged(
    name: string,
    prUrl: string,
    ghRunner?: (url: string) => Promise<string>,
  ): Promise<boolean> {
    const merged = await checkPrMerged(prUrl, ghRunner);
    if (merged) {
      await this.cleanup(name);
      return true;
    }
    return false;
  }

  async scan(): Promise<WorktreeInfo[]> {
    const worktreesDir = join(this.projectRoot, '.worktrees');
    let entries: string[];
    try {
      const dirents = await readdir(worktreesDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }

    const results: WorktreeInfo[] = [];
    for (const name of entries) {
      const wtPath = join(worktreesDir, name);
      const branch = `feature/${name}`;

      let featureStatus: string | undefined;
      let isCorrupt = false;
      try {
        const stateRaw = await readFile(join(wtPath, 'conduct-state.json'), 'utf-8');
        const state = JSON.parse(stateRaw);
        featureStatus = state.feature_status;
      } catch (err: any) {
        // If file doesn't exist, that's fine (no state yet)
        // If file exists but is corrupt (parse error), mark as corrupt
        if (err.code !== 'ENOENT') {
          isCorrupt = true;
        }
      }

      // Skip worktrees with corrupt state files
      if (isCorrupt) {
        continue;
      }

      if (featureStatus !== 'complete') {
        results.push({ name, path: wtPath, branch, featureStatus });
      }
    }

    return results;
  }
}

/**
 * Check if a PR has been merged using `gh pr view`.
 * Accepts an optional runner for testability (avoids mocking child_process globally).
 */
export async function checkPrMerged(
  prUrl: string,
  ghRunner?: (url: string) => Promise<string>,
): Promise<boolean> {
  try {
    const runner = ghRunner ?? defaultGhRunner;
    const output = await runner(prUrl);
    const data = JSON.parse(output);
    return data.state === 'MERGED';
  } catch {
    return false;
  }
}

async function defaultGhRunner(prUrl: string): Promise<string> {
  const { stdout } = await execFile('gh', ['pr', 'view', prUrl, '--json', 'state']);
  return stdout;
}
