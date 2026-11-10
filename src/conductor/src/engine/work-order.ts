import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { ComplexityTier, Track } from '../types/steps.js';
import type { FeatureApplicabilityDeclaration, FeatureApplicabilityIgnored } from '../types/state.js';
import type { EnginePin, EnginePinFallbackReason } from './engine-pin.js';
import { versionIdFromEngineDir, type EngineVersionId } from './engine-version-id.js';
import type { ReadOnlyReviewCapability } from './build-review-read-only-capability.js';

/** Increment when the serializable dispatcher-to-executor contract changes. */
export const WORK_ORDER_SCHEMA_VERSION = 1;

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
  /** Version of the serialized dispatcher-to-executor contract. */
  schemaVersion: typeof WORK_ORDER_SCHEMA_VERSION;
  repository: string;
  slug: string;
  /** Immutable base commit captured when the dispatcher claims this work. */
  baseSha: string;
  /** Supervisor-configured base branch for child-side resume and publication. */
  baseBranch?: string;
  /** Immutable engine build selected for this individual dispatch. */
  engineVersionId: EngineVersionId;
  /** Identity of the supervisor that issued this order (diagnostic only). */
  supervisorEngineVersionId?: EngineVersionId;
  /** Why this order uses the supervisor build rather than the floating dist link. */
  pinFallbackReason?: EnginePinFallbackReason;
  /** Supervisor pool width, retained for child-mode legacy safety guards. */
  effectiveConcurrency?: number;
  /** Whether this order was issued by the harness self-host supervisor. */
  selfHost?: boolean;
  /** Frozen at daemon startup so a child does not re-probe build-review support. */
  readOnlyReviewCapabilities?: Readonly<Record<string, ReadOnlyReviewCapability>>;
  manifest: ManifestEntry[];
  /** Executor inputs formerly recovered from dispatcher-local bookkeeping. */
  tier?: ComplexityTier;
  sourceRef?: string;
  track?: Track;
  band?: string;
  resolutionMode?: 'banded' | 'fallback' | 'off';
  applicabilityDeclarations?: FeatureApplicabilityDeclaration[];
  applicabilityBaseContentSha256?: string;
  applicabilityIgnored?: FeatureApplicabilityIgnored;
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
  /** Supervisor-configured base branch carried across the executor boundary. */
  baseBranch?: string;
  /** Immutable engine selected at claim time; its path stays dispatcher-local. */
  enginePin: EnginePin;
  /** Supervisor pool width retained for child-mode legacy safety guards. */
  effectiveConcurrency?: number;
  /** Preserve the supervisor's self-host mode across the process boundary. */
  selfHost?: boolean;
  /** Daemon-start snapshot carried to the child lifecycle unchanged. */
  readOnlyReviewCapabilities?: Readonly<Record<string, ReadOnlyReviewCapability>>;
  documentRefs: readonly string[];
  tier?: ComplexityTier;
  sourceRef?: string;
  track?: Track;
  band?: string;
  resolutionMode?: 'banded' | 'fallback' | 'off';
  applicabilityDeclarations?: FeatureApplicabilityDeclaration[];
  applicabilityBaseContentSha256?: string;
  applicabilityIgnored?: FeatureApplicabilityIgnored;
}

/**
 * Resolves the governing specification documents at the pinned base and
 * creates the serializable dispatcher-to-executor work order.
 */
export async function buildWorkOrder(input: BuildWorkOrderInput, git: WorkOrderGitRunner): Promise<WorkOrder> {
  for (const ref of input.documentRefs) {
    if (posix.isAbsolute(ref) || win32.isAbsolute(ref)) {
      throw new Error(`document ref must be repository-relative: ${ref}`);
    }
  }

  const manifest = await Promise.all(
    input.documentRefs.map(async (ref) => {
      const result = await git(['show', `${input.baseSha}:${ref}`]);
      if (result.exitCode !== 0) {
        throw new Error(`could not resolve work-order document ${ref}: ${result.stderr}`);
      }
      return {
        ref,
        contentHash: `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`,
      };
    }),
  );

  return {
    schemaVersion: WORK_ORDER_SCHEMA_VERSION,
    repository: input.repository,
    slug: input.slug,
    baseSha: input.baseSha,
    ...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
    engineVersionId: input.enginePin.engineVersionId,
    ...(input.enginePin.fallbackReason === undefined ? {} : { pinFallbackReason: input.enginePin.fallbackReason }),
    ...(input.effectiveConcurrency === undefined ? {} : { effectiveConcurrency: input.effectiveConcurrency }),
    ...(input.selfHost === undefined ? {} : { selfHost: input.selfHost }),
    ...(input.readOnlyReviewCapabilities === undefined
      ? {}
      : { readOnlyReviewCapabilities: input.readOnlyReviewCapabilities }),
    manifest,
    ...(input.tier ? { tier: input.tier } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.track ? { track: input.track } : {}),
    ...(input.band ? { band: input.band } : {}),
    ...(input.resolutionMode ? { resolutionMode: input.resolutionMode } : {}),
    ...(input.applicabilityDeclarations ? { applicabilityDeclarations: input.applicabilityDeclarations } : {}),
    ...(input.applicabilityBaseContentSha256
      ? { applicabilityBaseContentSha256: input.applicabilityBaseContentSha256 }
      : {}),
    ...(input.applicabilityIgnored ? { applicabilityIgnored: input.applicabilityIgnored } : {}),
  };
}

/** Verifies a dispatcher-built order before any executor worktree is created. */
export async function verifyWorkOrder(order: WorkOrder, git: WorkOrderGitRunner): Promise<void> {
  if (order.schemaVersion !== WORK_ORDER_SCHEMA_VERSION) {
    throw new Error(
      `work-order schemaVersion ${order.schemaVersion} is incompatible with ${WORK_ORDER_SCHEMA_VERSION}`,
    );
  }
  if (versionIdFromEngineDir(order.engineVersionId) !== order.engineVersionId) {
    throw new Error(`work-order engineVersionId is invalid: ${order.engineVersionId}`);
  }

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
