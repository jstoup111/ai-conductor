import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { parseChildId, type ChildId } from './child-context.js';
import { loadConfig } from './config.js';
import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  readCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { childBranchFor, leafBranchFor } from './feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import type { ConductorEventEmitter } from '../ui/events.js';

export type StartChildGitRunner = GitRunner;

export type StartChildResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface StartChildDependencies {
  readonly git?: StartChildGitRunner;
}

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

function sealedPositions(
  envelope: Awaited<ReturnType<typeof readCoverageBindingEnvelope>>,
): ChildId[] {
  if (!envelope?.sliceMembership || !COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status)) {
    return [];
  }
  return [...new Set(Object.values(envelope.sliceMembership.taskSlices))]
    .map((position) => parseChildId(position))
    .filter((position): position is ChildId => position !== undefined)
    .sort((left, right) => left - right);
}

function refused(reason: string): StartChildResult {
  return { kind: 'refused', reason };
}

async function runGit(
  git: StartChildGitRunner,
  args: string[],
  input?: string,
): Promise<Awaited<ReturnType<StartChildGitRunner>> | undefined> {
  try {
    return await git(args, input === undefined ? undefined : { input });
  } catch {
    return undefined;
  }
}

/**
 * Creates the active non-leaf child's local branch from its declared parent.
 *
 * `emitter` is intentionally unused: lifecycle events are emitted only after a
 * successful checkout by switchToChild (Task 7), preserving their persisted
 * order around child closure and switching.
 */
export async function startChild(
  worktree: string,
  slug: string,
  child: ChildId,
  _emitter: ConductorEventEmitter,
  dependencies: StartChildDependencies = {},
): Promise<StartChildResult> {
  const envelope = await readCoverageBindingEnvelope(worktree, envelopeFilesystem);
  const positions = sealedPositions(envelope);
  const positionIndex = positions.indexOf(child);
  if (positionIndex === -1 || positions.length < 2) {
    return refused(`child ${child} is not a declared stacked position`);
  }

  const loaded = await loadConfig(worktree);
  if (!loaded.ok) return refused(`cannot load project config: ${loaded.error.message}`);
  const maxSlices = loaded.config.stacked_prs?.max_slices ?? 1;
  if (positions.length > maxSlices) {
    return refused(`sealed position count ${positions.length} exceeds stacked_prs.max_slices ${maxSlices}`);
  }

  const leaf = positions.at(-1)!;
  if (child === leaf) {
    await mkdir(`${worktree}/.pipeline/children/${child}`, { recursive: true });
    return { kind: 'started' };
  }

  const branch = childBranchFor(slug, child);
  if (!branch.ok) return refused(branch.reason);
  const git = dependencies.git ?? makeGitRunner(worktree);
  const namespaceRef = `refs/heads/feat/c${child}`;
  const namespace = await runGit(git, ['show-ref', '--verify', '--quiet', namespaceRef]);
  if (namespace === undefined || (namespace.exitCode !== 0 && namespace.exitCode !== 1)) {
    return refused(`cannot probe reserved child namespace ${namespaceRef}`);
  }
  if (namespace.exitCode === 0) return refused(`reserved child namespace already exists: ${namespaceRef}`);

  const sourceRef = positionIndex === 0
    ? `refs/heads/${leafBranchFor(slug)}`
    : `refs/conductor/${slug}/closed/c${positions[positionIndex - 1]}`;
  const source = await runGit(git, ['rev-parse', '--verify', sourceRef]);
  const sha = source?.stdout.trim();
  if (source === undefined || source.exitCode !== 0 || sha === '') {
    return refused(`cannot resolve declared parent ref ${sourceRef}`);
  }

  const ref = `refs/heads/${branch.branch}`;
  const created = await runGit(git, ['update-ref', ref, sha, '']);
  if (created === undefined || created.exitCode !== 0) {
    return refused(`cannot create child branch ${ref}`);
  }

  await mkdir(`${worktree}/.pipeline/children/${child}`, { recursive: true });
  if (positionIndex !== 0) return { kind: 'started' };

  const blob = await runGit(git, ['hash-object', '-w', '--stdin'], JSON.stringify(positions));
  const blobSha = blob?.stdout.trim();
  if (blob === undefined || blob.exitCode !== 0 || blobSha === '') {
    return refused(`cannot write sealed positions for ${slug}`);
  }
  const positionsRef = `refs/conductor/${slug}/positions`;
  const recorded = await runGit(git, ['update-ref', positionsRef, blobSha, '']);
  if (recorded === undefined || recorded.exitCode !== 0) {
    return refused(`cannot record sealed positions at ${positionsRef}`);
  }

  return { kind: 'started' };
}
