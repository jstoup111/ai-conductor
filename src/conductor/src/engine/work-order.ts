import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { ComplexityTier, Track } from '../types/steps.js';

/** A document carried across the dispatcher-to-executor boundary. */
export interface ManifestEntry {
  ref: string;
  contentHash: string;
}

/**
 * Plain serializable input for one feature executor.
 *
 * The manifest transports the dispatcher-resolved governing documents; it is
 * not persisted as an artifact-resolution authority.
 */
export interface WorkOrder {
  repository: string;
  slug: string;
  /** Immutable base commit captured when the dispatcher claims this work. */
  baseSha: string;
  manifest: ManifestEntry[];
  /** Executor inputs formerly recovered from dispatcher-local bookkeeping. */
  tier?: ComplexityTier;
  sourceRef?: string;
  track?: Track;
  band?: string;
  resolutionMode?: 'banded' | 'fallback' | 'off';
}

export interface WorkOrderGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injected Git boundary so work-order construction remains unit-testable. */
export type WorkOrderGitRunner = (args: readonly string[]) => Promise<WorkOrderGitResult>;

export class WorkOrderManifestMismatchError extends Error {
  constructor(ref: string) {
    super(`work-order manifest content hash mismatch: ${ref}`);
    this.name = 'WorkOrderManifestMismatchError';
  }
}

export class WorkOrderBaseShaMissingError extends Error {
  constructor(baseSha: string) {
    super(`work-order base SHA does not exist: ${baseSha}`);
    this.name = 'WorkOrderBaseShaMissingError';
  }
}

export interface BuildWorkOrderInput {
  repository: string;
  slug: string;
  baseSha: string;
  documentRefs: readonly string[];
  tier?: ComplexityTier;
  sourceRef?: string;
  track?: Track;
  band?: string;
  resolutionMode?: 'banded' | 'fallback' | 'off';
}

/**
 * Resolves the governing specification documents at the pinned base and
 * creates the serializable dispatcher-to-executor work order.
 */
export async function buildWorkOrder(
  input: BuildWorkOrderInput,
  git: WorkOrderGitRunner,
): Promise<WorkOrder> {
  for (const ref of input.documentRefs) {
    if (posix.isAbsolute(ref) || win32.isAbsolute(ref)) {
      throw new Error(`document ref must be repository-relative: ${ref}`);
    }
  }

  const manifest = await Promise.all(input.documentRefs.map(async (ref) => {
    const result = await git(['show', `${input.baseSha}:${ref}`]);
    if (result.exitCode !== 0) {
      throw new Error(`could not resolve work-order document ${ref}: ${result.stderr}`);
    }
    return {
      ref,
      contentHash: `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`,
    };
  }));

  return {
    repository: input.repository,
    slug: input.slug,
    baseSha: input.baseSha,
    manifest,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.track ? { track: input.track } : {}),
    ...(input.band ? { band: input.band } : {}),
    ...(input.resolutionMode ? { resolutionMode: input.resolutionMode } : {}),
  };
}

/** Verifies a dispatcher-built order before any executor worktree is created. */
export async function verifyWorkOrder(
  order: WorkOrder,
  git: WorkOrderGitRunner,
): Promise<void> {
  const baseResult = await git(['cat-file', '-e', order.baseSha]);
  if (baseResult.exitCode !== 0) {
    throw new WorkOrderBaseShaMissingError(order.baseSha);
  }

  for (const entry of order.manifest) {
    const result = await git(['show', `${order.baseSha}:${entry.ref}`]);
    const contentHash = `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`;
    if (result.exitCode !== 0 || contentHash !== entry.contentHash) {
      throw new WorkOrderManifestMismatchError(entry.ref);
    }
  }
}
