import type { GitRunner } from '../rebase.js';
import { parseCommitSha, type CommitSha } from './restack-types.js';

export interface AuthorIdentity {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

export function requiredCommitSha(raw: string, context: string): CommitSha {
  const value = parseCommitSha(raw.trim());
  if (!value) throw new Error(`${context} did not return a full Git object name`);
  return value;
}

export async function authorOf(git: GitRunner, commit: CommitSha): Promise<AuthorIdentity> {
  const result = await git(['show', '-s', '--format=%an%x00%ae%x00%aI', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read author for ${commit}: ${result.stderr}`);
  const [name, email, date, extra] = result.stdout.split('\0');
  if (!name || !email || !date || extra !== undefined) throw new Error(`could not parse author for ${commit}`);
  return { name, email, date: date.trim() };
}

export async function messageOf(git: GitRunner, commit: CommitSha): Promise<string> {
  const result = await git(['show', '-s', '--format=%B', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read message for ${commit}: ${result.stderr}`);
  return result.stdout;
}

export async function mergeParents(git: GitRunner, commit: CommitSha): Promise<readonly CommitSha[]> {
  const result = await git(['rev-list', '--parents', '-n', '1', commit]);
  if (result.exitCode !== 0) throw new Error(`could not read parents for ${commit}: ${result.stderr}`);
  return result.stdout.trim().split(/\s+/).slice(1).map((parent) => requiredCommitSha(parent, `parent for ${commit}`));
}

export async function sideLineageCount(git: GitRunner, firstParent: CommitSha, secondParent: CommitSha): Promise<number> {
  const result = await git(['rev-list', `${firstParent}..${secondParent}`]);
  if (result.exitCode !== 0) throw new Error(`could not list side lineage for ${secondParent}: ${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean).length;
}
