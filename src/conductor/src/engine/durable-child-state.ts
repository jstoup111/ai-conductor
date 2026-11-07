import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFeatureBranch, parseFeatureRef } from './feature-branch-identity.js';

export type DurableChildStateGitRunner = (
  args: string[],
  options?: {
    input?: string;
    credential?: 'operator' | 'write';
    endpoint?: 'https' | 'ssh';
    env?: NodeJS.ProcessEnv;
  },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface DurableChildStateDependencies {
  readonly git?: DurableChildStateGitRunner;
}

function makeDurableChildStateGitRunner(cwd: string): DurableChildStateGitRunner {
  return async (args, options) => {
    const result = await execa('git', args, {
      cwd,
      reject: false,
      ...(options?.input === undefined ? {} : { input: options.input }),
      ...(options?.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
    });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
}

async function runGit(git: DurableChildStateGitRunner, args: string[]) {
  try {
    return await git(args);
  } catch {
    return undefined;
  }
}

const STACK_OWNED_CONDUCTOR_REFS = ['positions', 'publication', 'leaf-moved', 'cascades'] as const;
const STACK_OWNED_CONDUCTOR_REF_DIRS = ['closed/', 'restack/'] as const;
const STACK_PUSH_RECEIPT_DIRS = ['pushed/', 'push-intent/'] as const;

function isStackOwnedConductorRef(name: string, slug: string): boolean {
  const receiptBranch = STACK_PUSH_RECEIPT_DIRS.find((dir) => name.startsWith(dir));
  if (receiptBranch !== undefined) {
    const identity = parseFeatureBranch(name.slice(receiptBranch.length));
    return identity.kind === 'child' && identity.slug === slug;
  }
  return (STACK_OWNED_CONDUCTOR_REFS as readonly string[]).includes(name) ||
    STACK_OWNED_CONDUCTOR_REF_DIRS.some((dir) => name.startsWith(dir));
}

/**
 * Whether durable child state survives for this feature, independent of the
 * current stacked-prs setting. A recreated worktree can lose
 * `.pipeline/children` while retaining the child branches and closure refs.
 */
export async function hasDurableChildState(
  worktree: string,
  slug: string,
  dependencies: DurableChildStateDependencies = {},
): Promise<boolean | 'git-error'> {
  const git = dependencies.git ?? makeDurableChildStateGitRunner(worktree);
  try {
    if ((await readdir(join(worktree, '.pipeline', 'children'))).length > 0) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'git-error';
  }
  // Legacy N=1 callers and unit fixtures may intentionally have no Git
  // boundary. Without child state on disk they cannot have durable child refs.
  if (!existsSync(join(worktree, '.git'))) return false;
  const refs = await runGit(git, ['for-each-ref', '--format=%(refname)', 'refs/heads/feat']);
  if (!refs || refs.exitCode !== 0) return 'git-error';
  if (refs.stdout.split('\n').some((ref) => {
    const identity = parseFeatureRef(ref.trim());
    return identity.kind === 'child' && identity.slug === slug;
  })) return true;
  const conductorRefs = await runGit(git, ['for-each-ref', '--format=%(refname)', `refs/conductor/${slug}/`]);
  if (!conductorRefs || conductorRefs.exitCode !== 0) return 'git-error';
  const prefix = `refs/conductor/${slug}/`;
  return conductorRefs.stdout.split('\n').some((line) => {
    const ref = line.trim();
    return ref.startsWith(prefix) && isStackOwnedConductorRef(ref.slice(prefix.length), slug);
  });
}
