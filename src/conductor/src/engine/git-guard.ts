import { access, chmod, lstat, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { GIT_GUARD_SCRIPT } from './git-hook-assets.js';

const pipeline = (cwd: string) => join(cwd, '.pipeline');
export const gitGuardPath = (cwd: string) => join(pipeline(cwd), 'bin', 'git');

export async function resolveRealGit(pathEnv = process.env.PATH ?? ''): Promise<string> {
  for (const entry of pathEnv.split(delimiter)) {
    // A relative entry is relative to whichever directory the eventual child
    // chooses. The guard data must instead name one stable, absolute binary.
    if (!entry || !isAbsolute(entry) || entry.endsWith(join('.pipeline', 'bin'))) continue;
    const candidate = join(entry, 'git');
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  throw new Error('unable to resolve real git executable');
}

export async function writeGitGuard(worktreePath: string): Promise<string> {
  const target = gitGuardPath(worktreePath);
  const dataDir = join(pipeline(worktreePath), 'git-guard');
  try {
    await mkdir(join(pipeline(worktreePath), 'bin'), { recursive: true });
    await mkdir(dataDir, { recursive: true });
  } catch (error) {
    throw new Error(`unable to provision git guard ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const realGit = await resolveRealGit();
  const commonDir = (await execa(realGit, ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
  await writeRegularFile(target, GIT_GUARD_SCRIPT, 0o755);
  await writeRegularFile(join(dataDir, 'real-git'), realGit + '\n');
  await writeRegularFile(join(dataDir, 'common-dir'), commonDir + '\n');
  return join(pipeline(worktreePath), 'bin');
}

/** Replace links and special files rather than following them while repairing. */
async function writeRegularFile(path: string, content: string, mode?: number): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFile(path, content, 'utf8');
  if (mode !== undefined) await chmod(path, mode);
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch { return false; }
}

export async function ensureGitGuardForDispatch(cwd: string | undefined): Promise<string | null> {
  if (!cwd) return null;
  const expectedHooks = join(pipeline(cwd), 'git-hooks');
  // Most adapter-only tests and ordinary consumer invocations are not prepared
  // worktrees. Avoid even spawning git unless the engine-owned marker exists.
  try { await access(expectedHooks); } catch { return null; }
  let configured = '';
  try { configured = (await execa('git', ['-C', cwd, 'config', '--worktree', '--get', 'core.hooksPath'])).stdout.trim(); } catch (error) {
    throw new Error(`unable to verify git guard ${gitGuardPath(cwd)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (configured !== expectedHooks) return null;
  const target = gitGuardPath(cwd);
  let valid = false;
  try {
    const [content, info, scriptRegular, realRegular, commonRegular] = await Promise.all([
      readFile(target, 'utf8'), stat(target), isRegularFile(target),
      isRegularFile(join(pipeline(cwd), 'git-guard', 'real-git')),
      isRegularFile(join(pipeline(cwd), 'git-guard', 'common-dir')),
    ]);
    valid = content === GIT_GUARD_SCRIPT && scriptRegular && realRegular && commonRegular && (info.mode & 0o777) === 0o755;
  } catch { /* repair */ }
  if (!valid) await writeGitGuard(cwd);
  const [info, regular] = await Promise.all([stat(target), isRegularFile(target)]);
  if (!regular || (info.mode & 0o777) !== 0o755) throw new Error(`git guard repair failed: ${target}`);
  return join(pipeline(cwd), 'bin');
}
