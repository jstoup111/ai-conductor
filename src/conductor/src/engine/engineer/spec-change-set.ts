import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveDefaultBranch } from './spec-branch.js';

const execFile = promisify(execFileCb);

/**
 * Reads requested paths as they existed at the feature branch's merge base.
 * `undefined` means the base itself could not be resolved; `null` means an
 * individual path did not exist there or could not be read.
 */
export async function readMergeBaseTexts(
  worktreePath: string,
  canonicalPath: string,
  paths: readonly string[],
): Promise<Record<string, string | null> | undefined> {
  let base: string;
  try {
    const defaultBranch = await deriveDefaultBranch(canonicalPath);
    const { stdout } = await execFile(
      'git', ['merge-base', 'HEAD', defaultBranch], { cwd: worktreePath },
    );
    base = stdout.trim();
    if (!base) return undefined;
  } catch {
    return undefined;
  }

  const texts: Record<string, string | null> = {};
  for (const path of paths) {
    try {
      const { stdout } = await execFile('git', ['show', `${base}:${path}`], { cwd: worktreePath });
      texts[path] = stdout;
    } catch {
      texts[path] = null;
    }
  }
  return texts;
}

/**
 * Resolves the `.docs/` paths attributable to an engineer spec: committed
 * branch changes since its canonical default branch plus untracked artifacts.
 * Both plan-review creation and its land gate consume this one scope.
 */
export async function resolveIdeaFiles(
  worktreePath: string,
  canonicalPath: string,
): Promise<Set<string>> {
  const defaultBranch = await deriveDefaultBranch(canonicalPath);
  const { stdout: baseOut } = await execFile(
    'git', ['merge-base', 'HEAD', defaultBranch], { cwd: worktreePath },
  );
  const { stdout: diffOut } = await execFile(
    'git', ['diff', '--name-only', baseOut.trim(), 'HEAD'], { cwd: worktreePath },
  );
  const { stdout: porcelainOut } = await execFile(
    'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: worktreePath },
  );
  const committed = diffOut.trim() === '' ? [] : diffOut.trim().split('\n');
  const worktreePaths: string[] = [];
  const entries = porcelainOut.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (!entry || entry.slice(0, 2) === '!!') continue;
    const status = entry.slice(0, 2);
    worktreePaths.push(entry.slice(3));
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return new Set([...committed, ...worktreePaths]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path.startsWith('.docs/')));
}
