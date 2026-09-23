/** The self-host release-metadata flow's configured state. */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessConfig } from '../../types/config.js';
import {
  executeGithubOperation,
  type GithubOperationRunner,
} from '../github-operations.js';
import { runTrackerUrlRead, type GhRunner } from '../tracker-client.js';
import { mergeReleaseMetadataBlock, snapshotReleaseMetadataBlock } from '../release-metadata.js';

export type ReleaseMetadataFlow = 'inactive' | 'active' | 'step-missing';

/** The repository-local step that authors release metadata. */
export const RELEASE_DISPOSITION_STEP = 'release-disposition';

/** Inputs supplied by the existing self-build detector and resolved config. */
export interface ReleaseMetadataFlowInput {
  readonly isSelfBuild: boolean;
  readonly releaseArtifactGateEnabled: boolean;
  readonly steps?: HarnessConfig['steps'];
}

/** Exact repository-local block retained across a finish body rewrite. */
export interface ReleaseMetadataSnapshot {
  readonly prUrl: string;
  readonly block: string;
}

/** The injected GitHub and repository identity required by snapshot operations. */
export interface ReleaseMetadataSnapshotInput {
  readonly gh: GhRunner;
  readonly projectRoot: string;
  readonly prUrl: string;
}

/**
 * Guarded operation authority required to restore a retained draft body.
 * `operations` is absent when the composition root could not bind the guard;
 * an intact block still needs no write, so the absence is only a failure once
 * a rewrite is actually required.
 */
export interface ReleaseMetadataRestoreInput extends ReleaseMetadataSnapshotInput {
  readonly snapshot: ReleaseMetadataSnapshot;
  readonly operations: GithubOperationRunner | undefined;
}

export function releaseMetadataSnapshotPath(projectRoot: string): string {
  return join(projectRoot, '.pipeline', 'release-metadata-snapshot.json');
}

/** Read a durable capture only when its block remains canonical and restorable. */
export async function readPersistedReleaseMetadataSnapshot(
  projectRoot: string,
): Promise<ReleaseMetadataSnapshot | undefined> {
  try {
    const raw = await readFile(releaseMetadataSnapshotPath(projectRoot), 'utf-8');
    const value = JSON.parse(raw) as { prUrl?: unknown; block?: unknown };
    if (typeof value.prUrl !== 'string' || typeof value.block !== 'string') return undefined;
    if (snapshotReleaseMetadataBlock(value.block) !== value.block) return undefined;
    return { prUrl: value.prUrl, block: value.block };
  } catch {
    return undefined;
  }
}

/** Drop a durable capture before the release-disposition step supersedes it. */
export async function clearPersistedReleaseMetadataSnapshot(projectRoot: string): Promise<void> {
  await unlink(releaseMetadataSnapshotPath(projectRoot)).catch(() => {});
}

/** Capture a canonical release block through the caller's injected GitHub runner. */
export async function snapshotReleaseMetadata(
  input: ReleaseMetadataSnapshotInput & { readonly retained?: ReleaseMetadataSnapshot },
): Promise<ReleaseMetadataSnapshot> {
  const retained = input.retained ?? await readPersistedReleaseMetadataSnapshot(input.projectRoot);
  if (retained?.prUrl === input.prUrl) return retained;

  try {
    const stdout = await runTrackerUrlRead(
      input.gh,
      input.projectRoot,
      'pull-request',
      input.prUrl,
      ['pr', 'view', input.prUrl, '--json', 'body'],
    );
    const body = (JSON.parse(stdout) as { body?: unknown }).body;
    if (typeof body !== 'string') throw new Error('PR body is absent');
    const block = snapshotReleaseMetadataBlock(body);
    if (block === null) throw new Error('release metadata is malformed or non-canonical');
    const snapshot = { prUrl: input.prUrl, block };
    await mkdir(join(input.projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
    await writeFile(
      releaseMetadataSnapshotPath(input.projectRoot),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf-8',
    ).catch(() => {});
    return snapshot;
  } catch (error) {
    throw new Error(
      `pre-finish snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Restore a capture after finish rewrites the PR body, then verify the remote result. */
export async function restoreReleaseMetadata(
  input: ReleaseMetadataRestoreInput,
): Promise<void> {
  if (input.snapshot.prUrl !== input.prUrl) {
    throw new Error('pre-finish snapshot unavailable for the retained draft PR');
  }

  try {
    const readBody = async (): Promise<string> => {
      const stdout = await runTrackerUrlRead(
        input.gh,
        input.projectRoot,
        'pull-request',
        input.prUrl,
        ['pr', 'view', input.prUrl, '--json', 'body'],
      );
      const body = (JSON.parse(stdout) as { body?: unknown }).body;
      if (typeof body !== 'string') throw new Error('PR body is absent');
      return body;
    };
    const before = await readBody();
    if (snapshotReleaseMetadataBlock(before) === input.snapshot.block) return;
    const merged = mergeReleaseMetadataBlock(before, input.snapshot.block);
    if (merged === null) throw new Error('captured release metadata is no longer valid');
    if (!input.operations) {
      throw new Error('guarded release metadata restore is unavailable at this composition boundary');
    }
    const target = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)$/.exec(input.prUrl);
    if (!target) throw new Error('PR URL is not a canonical github.com pull-request URL');
    const result = await executeGithubOperation({
      operation: 'pull-request.edit',
      repository: target[1],
      resource: { kind: 'pull-request', number: Number(target[2]) },
      context: { actor: 'finish-release-metadata-restore' },
      payload: { body: merged },
    }, input.operations);
    if (result.kind !== 'executed') throw new Error('guarded release metadata restore was refused or failed');
    const after = await readBody();
    if (snapshotReleaseMetadataBlock(after) !== input.snapshot.block) {
      throw new Error('release metadata restore could not be verified');
    }
  } catch (error) {
    throw new Error(
      `post-finish restore unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Activates release metadata handling only for this repository's declared
 * self-host flow. Step identity is its configured name, not its skill location.
 */
export function resolveReleaseMetadataFlow(input: ReleaseMetadataFlowInput): ReleaseMetadataFlow {
  if (!input.isSelfBuild || !input.releaseArtifactGateEnabled) return 'inactive';
  return Object.prototype.hasOwnProperty.call(input.steps ?? {}, RELEASE_DISPOSITION_STEP)
    ? 'active'
    : 'step-missing';
}

/** Whether a dispatched step supersedes this flow's retained metadata capture. */
export function isReleaseMetadataFlowStep(stepName: string): boolean {
  return stepName === RELEASE_DISPOSITION_STEP;
}

/** Cleanup belongs only to an active self-host flow's metadata-writing step. */
export function supersedesReleaseMetadataSnapshot(
  flow: ReleaseMetadataFlow,
  stepName: string,
): boolean {
  return flow === 'active' && isReleaseMetadataFlowStep(stepName);
}
