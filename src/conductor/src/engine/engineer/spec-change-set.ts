import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveDefaultBranch } from './spec-branch.js';

const execFile = promisify(execFileCb);

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
    'git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktreePath },
  );
  const committed = diffOut.trim() === '' ? [] : diffOut.trim().split('\n');
  const untracked = porcelainOut.trim() === '' ? [] : porcelainOut.trim().split('\n')
    .filter((line) => line.slice(0, 2) === '??')
    .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, '$1'));
  return new Set([...committed, ...untracked]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path.startsWith('.docs/')));
}
