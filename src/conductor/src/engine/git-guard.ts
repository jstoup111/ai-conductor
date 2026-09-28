import { access, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { GIT_GUARD_SCRIPT } from './git-hook-assets.js';

const pipeline = (cwd: string) => join(cwd, '.pipeline');
export const gitGuardPath = (cwd: string) => join(pipeline(cwd), 'bin', 'git');

export async function resolveRealGit(pathEnv = process.env.PATH ?? ''): Promise<string> {
  for (const entry of pathEnv.split(delimiter)) {
    if (!entry || entry.endsWith(join('.pipeline', 'bin'))) continue;
    const candidate = join(entry, 'git');
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  throw new Error('unable to resolve real git executable');
}

export async function writeGitGuard(worktreePath: string): Promise<string> {
  const target = gitGuardPath(worktreePath);
  const dataDir = join(pipeline(worktreePath), 'git-guard');
  await mkdir(join(pipeline(worktreePath), 'bin'), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const realGit = await resolveRealGit();
  const commonDir = (await execa(realGit, ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
  await writeFile(target, GIT_GUARD_SCRIPT, 'utf8'); await chmod(target, 0o755);
  await writeFile(join(dataDir, 'real-git'), realGit + '\n', 'utf8');
  await writeFile(join(dataDir, 'common-dir'), commonDir + '\n', 'utf8');
  return join(pipeline(worktreePath), 'bin');
}

export async function ensureGitGuardForDispatch(cwd: string | undefined): Promise<string | null> {
  if (!cwd) return null;
  const expectedHooks = join(pipeline(cwd), 'git-hooks');
  // Most adapter-only tests and ordinary consumer invocations are not prepared
  // worktrees. Avoid even spawning git unless the engine-owned marker exists.
  try { await access(expectedHooks); } catch { return null; }
  let configured = '';
  try { configured = (await execa('git', ['-C', cwd, 'config', '--worktree', '--get', 'core.hooksPath'])).stdout.trim(); } catch { return null; }
  if (configured !== expectedHooks) return null;
  const target = gitGuardPath(cwd);
  let valid = false;
  try { const [content, info] = await Promise.all([readFile(target, 'utf8'), stat(target)]); valid = content === GIT_GUARD_SCRIPT && (info.mode & 0o777) === 0o755; } catch { /* repair */ }
  if (!valid) await writeGitGuard(cwd);
  const info = await stat(target);
  if ((info.mode & 0o777) !== 0o755) throw new Error(`git guard repair failed: ${target}`);
  return join(pipeline(cwd), 'bin');
}
