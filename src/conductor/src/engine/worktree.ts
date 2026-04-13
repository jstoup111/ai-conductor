import { mkdir, readdir, readFile } from 'fs/promises';
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
    const slug = slugify(featureDesc);
    const worktreesDir = join(this.projectRoot, '.worktrees');
    const worktreePath = join(worktreesDir, slug);
    const branch = `feature/${slug}`;

    await mkdir(worktreesDir, { recursive: true });
    await git(this.projectRoot, 'worktree', 'add', '-b', branch, worktreePath);

    return { path: worktreePath, branch };
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
      try {
        const stateRaw = await readFile(join(wtPath, 'conduct-state.json'), 'utf-8');
        const state = JSON.parse(stateRaw);
        featureStatus = state.feature_status;
      } catch {
        // no state file — that's fine
      }

      if (featureStatus !== 'complete') {
        results.push({ name, path: wtPath, branch, featureStatus });
      }
    }

    return results;
  }
}
