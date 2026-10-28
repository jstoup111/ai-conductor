import { dirname, join, normalize } from 'node:path';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { StepName } from '../../types/steps.js';
import type { SelfHostProviderId } from './provider-home.js';
import { BUILT_IN_PROVIDERS, isBuiltInProviderId, providerDescriptor } from '../../execution/provider-catalog.js';
import { isStepName } from '../execution-identity.js';
import { LEGACY_TRANSCRIPT_OWNER_STEP, type ConductorEvent, type TranscriptOwnerStep } from '../../types/events.js';
import type { ConductorEventEmitter } from '../conductor-event-emitter.js';
import {
  emitTranscriptHarvest as emitTranscriptHarvestEvent,
  harvestProviderHome,
  harvestThenRemove,
  harvestTranscripts,
  transcriptCapture,
  type HarvestTranscriptsOptions,
  type TranscriptHarvestResult,
} from './transcript-harvest.js';
import { sanitizeProviderMember } from './provider-member.js';
import { TranscriptRetention } from './transcript-retention.js';

export { writeScratchSchema } from '../../execution/scratch-schema.js';

const OWNER_LEASE_FILE = 'owner.json';
const LEGACY_SCRATCH_PREFIXES = ['self-host-', 'harness-selfbuild-'] as const;
const collectedLegacyScratchRoots = new Set<string>();

export interface ResolveScratchHomeOptions {
  readonly worktreeRoot: string;
  readonly runId: string;
  readonly attempt: number;
  /** Owning conductor step, retained for post-interruption transcript capture. */
  readonly step?: StepName;
  readonly provider: SelfHostProviderId;
  /**
   * Concurrent auxiliary member (e.g. a build_review rubric) sharing this run
   * and attempt. Members fan out in parallel, so each needs its own home: one
   * member's release must never remove a sibling's live home.
   */
  readonly member?: string;
}

/** Minimal filesystem boundary for acquiring and reading a scratch-home lease. */
export interface ScratchFs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  readdir(path: string): Promise<string[]>;
  /** Optional so pre-existing focused fixtures remain valid; absence fails closed for legacy collection. */
  stat?(path: string): Promise<{ readonly mtime: Date; isDirectory(): boolean }>;
  rm(path: string, options: { recursive: boolean; force: true }): Promise<void>;
  rmdir(path: string): Promise<void>;
}

const realScratchFs: ScratchFs = {
  mkdir: (path, options) => fsp.mkdir(path, options).then(() => {}),
  writeFile: (path, content) => fsp.writeFile(path, content, 'utf8'),
  readFile: (path) => fsp.readFile(path, 'utf8').then((content) => content, () => null),
  readdir: (path) => fsp.readdir(path),
  stat: (path) => fsp.stat(path),
  rm: (path, options) => fsp.rm(path, options),
  rmdir: (path) => fsp.rmdir(path),
};

export interface ScratchLease {
  readonly repository: string;
  readonly featureSlug: string;
  readonly runId: string;
  readonly attempt: number;
  /** Optional so leases written before transcript retention remain readable. */
  readonly step?: StepName;
  readonly provider?: SelfHostProviderId;
  readonly member?: string;
  readonly ownerPid: number;
  readonly startedAt: string;
}

export type ScratchLeaseReadResult =
  | { readonly kind: 'present'; readonly lease: ScratchLease }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'incomplete' };

export interface AcquireScratchHomeOptions extends ResolveScratchHomeOptions {
  readonly repository: string;
  readonly featureSlug: string;
  readonly ownerPid?: number;
  readonly now?: () => Date;
  readonly fs?: ScratchFs;
}

export interface ReleaseScratchHomeOptions extends ResolveScratchHomeOptions {
  readonly fs?: ScratchFs;
}

export type ReleaseScratchHomeResult =
  | { readonly kind: 'released' }
  | { readonly kind: 'failed'; readonly error: string };

export type ScratchOwnerLiveness = 'dead' | 'live' | 'unknown';

export interface SweepScratchOptions {
  readonly worktreeRoot: string;
  readonly fs?: ScratchFs;
  readonly ownerLiveness?: (ownerPid: number) => ScratchOwnerLiveness;
  readonly events?: ConductorEventEmitter;
  /** Daemon-owned build token, included only when it reached the interrupted child. */
  readonly daemonBuildToken?: string;
  /** Injectable harvest boundary for isolated reclaim tests. */
  readonly harvest?: (options: HarvestTranscriptsOptions) => Promise<TranscriptHarvestResult>;
}

/**
 * Sweep every feature worktree at the daemon dispatch boundary. Enumeration
 * and individual worktree failures are deliberately contained: a stale
 * scratch directory must never prevent the daemon from dispatching work.
 */
export async function sweepFeatureWorktreeScratch(options: {
  readonly worktreeBase: string;
  readonly events: ConductorEventEmitter;
  readonly log: (message: string) => void;
  /** Daemon build token that was made available to self-host children, if any. */
  readonly daemonBuildToken?: string;
  /**
   * The daemon supplies a per-worktree scope so each cleanup decision reaches
   * that feature's ledger before it is forwarded to daemon-wide rendering.
   */
  readonly startFeatureEventScope?: (worktreePath: string, featureSlug: string) => {
    readonly events: ConductorEventEmitter;
    stop(): void;
  };
}): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(options.worktreeBase);
  } catch (error) {
    options.log(`provider scratch worktree enumeration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const slug of entries) {
    const worktreePath = join(options.worktreeBase, slug);
    const scope = options.startFeatureEventScope?.(worktreePath, slug);
    // This listener must see only captures recovered by this sweep. Reconciling
    // the ledger here would mistake another live worker's pending capture for
    // an abandoned one and settle it before that worker receives a verdict.
    const retention = new TranscriptRetention(worktreePath, scope?.events ?? options.events, { reconcile: false });
    try {
      await retention.ready();
      await sweepScratch({
        worktreeRoot: worktreePath,
        events: scope?.events ?? options.events,
        daemonBuildToken: options.daemonBuildToken,
      });
    } catch (error) {
      options.log(`provider scratch sweep failed for ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      retention.stop();
      scope?.stop();
    }
  }
  await collectLegacyScratch({ events: options.events });
}

export type ScratchSweepDecision =
  | { readonly kind: 'reclaimed'; readonly home: string }
  | { readonly kind: 'failed'; readonly home: string; readonly error: string }
  | {
    readonly kind: 'retained';
    readonly home: string;
    readonly reason: 'no-lease' | 'malformed-lease' | 'incomplete-lease' | 'live-owner' | 'unknown-owner' | 'concurrent-acquisition';
  };

export interface CollectLegacyScratchOptions {
  /** Injectable only for fixture isolation; production uses the system temporary directory. */
  readonly tempRoot?: string;
  readonly fs?: ScratchFs;
  readonly events?: ConductorEventEmitter;
  /** Injectable only for fixture isolation; production derives the current process start. */
  readonly processStartedAt?: Date;
  readonly ownerLiveness?: (ownerPid: number) => ScratchOwnerLiveness;
}

export type LegacyScratchCollectionDecision =
  | { readonly kind: 'reclaimed'; readonly home: string }
  | { readonly kind: 'failed'; readonly home: string; readonly error: string }
  | {
    readonly kind: 'retained';
    readonly home: string;
    readonly reason: 'legacy-nonmatching' | 'legacy-not-directory' | 'legacy-mtime-unavailable' | 'legacy-newer-than-process-start' | 'legacy-unreadable-lease' | 'legacy-live-owner' | 'legacy-unknown-owner';
  };

/**
 * One-time migration collector for historical provider homes created before
 * scratch became worktree-local. The daemon invokes it beside the regular
 * sweep; a root guard makes subsequent dispatch boundaries a no-op.
 */
export async function collectLegacyScratch(options: CollectLegacyScratchOptions = {}): Promise<readonly LegacyScratchCollectionDecision[]> {
  const fs = options.fs ?? realScratchFs;
  const tempRoot = normalize(options.tempRoot ?? tmpdir());
  if (collectedLegacyScratchRoots.has(tempRoot)) return [];
  collectedLegacyScratchRoots.add(tempRoot);

  const decisions: LegacyScratchCollectionDecision[] = [];
  let names: readonly string[];
  try {
    names = await fs.readdir(tempRoot);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    decisions.push({ kind: 'failed', home: tempRoot, error: reason });
    await emitScratchCleanup(options.events, {
      type: 'scratch_cleanup_failed',
      ...scratchCleanupIdentity(undefined),
      path: tempRoot,
      reason,
    });
    return decisions;
  }

  const processStartedAt = options.processStartedAt ?? new Date(Date.now() - process.uptime() * 1_000);
  const ownerLiveness = options.ownerLiveness ?? probeScratchOwnerLiveness;
  for (const name of [...names].sort()) {
    const home = join(tempRoot, name);
    if (!LEGACY_SCRATCH_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      await retainLegacyScratch(home, 'legacy-nonmatching', decisions, options.events);
      continue;
    }

    let stat: { readonly mtime: Date; isDirectory(): boolean };
    try {
      if (fs.stat === undefined) throw new Error('mtime unavailable');
      stat = await fs.stat(home);
    } catch {
      await retainLegacyScratch(home, 'legacy-mtime-unavailable', decisions, options.events);
      continue;
    }
    if (!stat.isDirectory()) {
      await retainLegacyScratch(home, 'legacy-not-directory', decisions, options.events);
      continue;
    }
    if (stat.mtime >= processStartedAt) {
      await retainLegacyScratch(home, 'legacy-newer-than-process-start', decisions, options.events);
      continue;
    }

    if (await retainLegacyScratchForLease(home, fs, ownerLiveness, decisions, options.events)) continue;

    // A lease can appear between the first read and removal. Re-read at the
    // authority boundary so collection never removes a newly live home.
    if (await retainLegacyScratchForLease(home, fs, ownerLiveness, decisions, options.events)) continue;

    try {
      await fs.rm(home, { recursive: true, force: true });
      decisions.push({ kind: 'reclaimed', home });
      await emitScratchCleanup(options.events, {
        type: 'scratch_cleanup_reclaimed',
        ...scratchCleanupIdentity(undefined),
        path: home,
        reason: 'legacy-preexisting',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      decisions.push({ kind: 'failed', home, error: reason });
      await emitScratchCleanup(options.events, {
        type: 'scratch_cleanup_failed',
        ...scratchCleanupIdentity(undefined),
        path: home,
        reason,
      });
    }
  }
  return decisions;
}

async function retainLegacyScratch(
  home: string,
  reason: Extract<LegacyScratchCollectionDecision, { kind: 'retained' }>['reason'],
  decisions: LegacyScratchCollectionDecision[],
  events: ConductorEventEmitter | undefined,
  lease?: ScratchLease,
): Promise<void> {
  decisions.push({ kind: 'retained', home, reason });
  await emitScratchCleanup(events, {
    type: 'scratch_cleanup_retained',
    ...scratchCleanupIdentity(lease),
    path: home,
    reason,
  });
}

async function retainLegacyScratchForLease(
  home: string,
  fs: ScratchFs,
  ownerLiveness: (ownerPid: number) => ScratchOwnerLiveness,
  decisions: LegacyScratchCollectionDecision[],
  events: ConductorEventEmitter | undefined,
): Promise<boolean> {
  const lease = await readScratchLease(home, { fs });
  if (lease.kind === 'missing') return false;
  if (lease.kind === 'malformed' || lease.kind === 'incomplete') {
    await retainLegacyScratch(home, 'legacy-unreadable-lease', decisions, events);
    return true;
  }
  const liveness = ownerLiveness(lease.lease.ownerPid);
  if (liveness === 'dead') return false;
  await retainLegacyScratch(
    home,
    liveness === 'live' ? 'legacy-live-owner' : 'legacy-unknown-owner',
    decisions,
    events,
    lease.lease,
  );
  return true;
}

export async function acquireScratchHome(options: AcquireScratchHomeOptions): Promise<string> {
  const home = resolveScratchHome(options);
  const fs = options.fs ?? realScratchFs;
  const lease: ScratchLease = {
    repository: options.repository,
    featureSlug: options.featureSlug,
    runId: options.runId,
    attempt: options.attempt,
    ...(options.step === undefined ? {} : { step: options.step }),
    provider: options.provider,
    ...(options.member === undefined ? {} : { member: options.member }),
    ownerPid: options.ownerPid ?? process.pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
  };

  await fs.mkdir(home, { recursive: true });
  try {
    await fs.writeFile(join(home, OWNER_LEASE_FILE), serializeScratchLease(lease));
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return home;
}

/** Removes an attempt's scratch home and its run directory once no attempts remain. */
export async function releaseScratchHome(options: ReleaseScratchHomeOptions): Promise<ReleaseScratchHomeResult> {
  const fs = options.fs ?? realScratchFs;
  const home = resolveScratchHome(options);
  try {
    await fs.rm(home, { recursive: true, force: true });
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  try {
    await fs.rmdir(dirname(home));
  } catch (error) {
    if (isNonEmptyOrMissingDirectory(error)) return { kind: 'released' };
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  return { kind: 'released' };
}

/** Reclaims only scratch homes whose owner lease names a process known to be dead. */
export async function sweepScratch(options: SweepScratchOptions): Promise<readonly ScratchSweepDecision[]> {
  const fs = options.fs ?? realScratchFs;
  const ownerLiveness = options.ownerLiveness ?? probeScratchOwnerLiveness;
  const scratchRoot = join(normalize(options.worktreeRoot), '.daemon', 'scratch');
  const decisions: ScratchSweepDecision[] = [];

  for (const runId of await readDirectory(scratchRoot, fs)) {
    const runDirectory = join(scratchRoot, runId);
    for (const attempt of await readDirectory(runDirectory, fs)) {
      const home = join(runDirectory, attempt);
      const lease = await readScratchLease(home, { fs });
      if (lease.kind !== 'present') {
        const concurrentLease = lease.kind === 'missing' ? await readScratchLease(home, { fs }) : undefined;
        const reason = concurrentLease?.kind === 'present'
          ? 'concurrent-acquisition'
          : leaseReason(lease.kind);
        const identity = concurrentLease?.kind === 'present' ? concurrentLease.lease : undefined;
        decisions.push({ kind: 'retained', home, reason });
        await emitScratchCleanup(options.events, {
          type: 'scratch_cleanup_retained',
          ...scratchCleanupIdentity(identity),
          path: home,
          reason,
        });
        continue;
      }

      switch (ownerLiveness(lease.lease.ownerPid)) {
        case 'dead':
          try {
            await harvestThenRemove({
              harvest: () => harvestInterruptedHome({
                home,
                attemptDirectory: attempt,
                lease: lease.lease,
                worktreeRoot: options.worktreeRoot,
                daemonBuildToken: options.daemonBuildToken,
                harvest: options.harvest,
                useProductionFilesystem: options.fs === undefined,
              }),
              report: async (results) => {
                for (const result of results) {
                  await emitTranscriptHarvest(options.events, result);
                }
              },
              remove: () => fs.rm(home, { recursive: true, force: true }),
            });
            decisions.push({ kind: 'reclaimed', home });
            await emitScratchCleanup(options.events, {
              type: 'scratch_cleanup_reclaimed',
              repository: lease.lease.repository,
              featureSlug: lease.lease.featureSlug,
              runId: lease.lease.runId,
              attempt: lease.lease.attempt,
              path: home,
              reason: 'dead-owner',
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            decisions.push({ kind: 'failed', home, error: reason });
            await emitScratchCleanup(options.events, {
              type: 'scratch_cleanup_failed',
              repository: lease.lease.repository,
              featureSlug: lease.lease.featureSlug,
              runId: lease.lease.runId,
              attempt: lease.lease.attempt,
              path: home,
              reason,
            });
          }
          break;
        case 'live':
          decisions.push({ kind: 'retained', home, reason: 'live-owner' });
          await emitScratchCleanup(options.events, {
            type: 'scratch_cleanup_retained',
            repository: lease.lease.repository,
            featureSlug: lease.lease.featureSlug,
            runId: lease.lease.runId,
            attempt: lease.lease.attempt,
            path: home,
            reason: 'live-owner',
          });
          break;
        case 'unknown':
          decisions.push({ kind: 'retained', home, reason: 'unknown-owner' });
          await emitScratchCleanup(options.events, {
            type: 'scratch_cleanup_retained',
            repository: lease.lease.repository,
            featureSlug: lease.lease.featureSlug,
            runId: lease.lease.runId,
            attempt: lease.lease.attempt,
            path: home,
            reason: 'unknown-owner',
          });
          break;
      }
    }
  }
  return decisions;
}

type InterruptedHarvest = {
  readonly result: TranscriptHarvestResult;
  readonly step: TranscriptOwnerStep;
  readonly runId: string;
  readonly attempt: number;
  readonly member?: string;
  readonly provider: SelfHostProviderId;
  readonly path: string;
};

async function harvestInterruptedHome(options: {
  readonly home: string;
  readonly attemptDirectory: string;
  readonly lease: ScratchLease;
  readonly worktreeRoot: string;
  readonly daemonBuildToken?: string;
  readonly harvest?: (options: HarvestTranscriptsOptions) => Promise<TranscriptHarvestResult>;
  readonly useProductionFilesystem: boolean;
}): Promise<readonly InterruptedHarvest[]> {
  // Injected ScratchFs fixtures model only leases and removal. They do not model
  // provider-home contents, so preserve their existing cleanup-only boundary.
  if (!options.useProductionFilesystem && options.harvest === undefined) return [];

  const provider = options.lease.provider ?? providerFromAttemptDirectory(options.attemptDirectory, options.lease.attempt);
  if (provider === undefined) return [];
  const descriptor = providerDescriptor(provider);
  const step: TranscriptOwnerStep = options.lease.step ?? LEGACY_TRANSCRIPT_OWNER_STEP;
  const capture = transcriptCapture({ worktreeRoot: options.worktreeRoot, step, runId: options.lease.runId, attempt: options.lease.attempt, ...(options.lease.member === undefined ? {} : { auxiliaryMember: options.lease.member }), provider });
  const childPrefixes = descriptor.selfHostShape.isolation === 'claude-config-sandbox'
    ? ['harness-selfbuild-', `self-host-${provider}-`]
    : [`self-host-${provider}-`];
  const children = (await fsp.readdir(options.home, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && childPrefixes.some((prefix) => entry.name.startsWith(prefix)));
  const harvest = options.harvest ?? harvestTranscripts;

  if (children.length === 0) return [];

  let files = 0;
  let bytes = 0;
  let omittedLines = 0;
  const skipped: string[] = [];
  for (const child of children) {
    const childHome = join(options.home, child.name);
    const result = await harvestProviderHome({
      home: childHome,
      selectedAuthPath: descriptor.selfHostShape.selectedAuthPath,
      globs: descriptor.selfHostShape.transcripts.globs,
      destination: capture.destination,
      extraSecrets: options.daemonBuildToken === undefined ? [] : [options.daemonBuildToken],
      harvest,
    });
    if (result.kind === 'failed') {
      return [{
        result,
        step,
        runId: options.lease.runId,
        attempt: options.lease.attempt,
        ...(options.lease.member === undefined ? {} : { member: options.lease.member }),
        provider,
        path: capture.path,
      }];
    }
    files += result.files;
    bytes += result.bytes;
    omittedLines += result.omittedLines;
    skipped.push(...result.skipped);
  }

  return [{
    result: { kind: 'captured', files, bytes, skipped, omittedLines },
    step,
    runId: options.lease.runId,
    attempt: options.lease.attempt,
    ...(options.lease.member === undefined ? {} : { member: options.lease.member }),
    provider,
    path: capture.path,
  }];
}

/** Inverse of resolveScratchHome's `<attempt>-<provider>[-<member>]` leaf. */
function providerFromAttemptDirectory(attemptDirectory: string, attempt: number): SelfHostProviderId | undefined {
  const prefix = `${attempt}-`;
  if (!attemptDirectory.startsWith(prefix)) return undefined;
  const remainder = attemptDirectory.slice(prefix.length);
  return BUILT_IN_PROVIDERS
    .filter((provider): provider is typeof provider & { readonly selfHostShape: NonNullable<typeof provider.selfHostShape> } => provider.selfHostShape !== undefined)
    .map((provider) => provider.id as SelfHostProviderId)
    .find((provider) => remainder === provider || remainder.startsWith(`${provider}-`));
}

function isSelfHostProviderId(value: unknown): value is SelfHostProviderId {
  return typeof value === 'string'
    && isBuiltInProviderId(value)
    && providerDescriptor(value).capabilities.selfHost === true;
}

async function emitTranscriptHarvest(
  events: ConductorEventEmitter | undefined,
  harvest: InterruptedHarvest,
): Promise<void> {
  await emitTranscriptHarvestEvent(events, {
    step: harvest.step, runId: harvest.runId, attempt: harvest.attempt,
    ...(harvest.member === undefined ? {} : { auxiliaryMember: harvest.member }),
    provider: harvest.provider, path: harvest.path, interrupted: true,
  }, harvest.result);
}

function scratchCleanupIdentity(lease: ScratchLease | undefined): {
  repository: string | 'unknown';
  featureSlug: string | 'unknown';
  runId: string | 'unknown';
  attempt: number | 'unknown';
} {
  return lease === undefined
    ? { repository: 'unknown', featureSlug: 'unknown', runId: 'unknown', attempt: 'unknown' }
    : {
      repository: lease.repository,
      featureSlug: lease.featureSlug,
      runId: lease.runId,
      attempt: lease.attempt,
    };
}

async function emitScratchCleanup(events: ConductorEventEmitter | undefined, event: ConductorEvent): Promise<void> {
  if (events === undefined) return;
  try {
    await events.emit(event);
  } catch {
    // Cleanup is authoritative; telemetry is best-effort.
  }
}

function probeScratchOwnerLiveness(ownerPid: number): ScratchOwnerLiveness {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return 'unknown';
  try {
    process.kill(ownerPid, 0);
    return 'live';
  } catch (error) {
    return isNoSuchProcessError(error) ? 'dead' : 'unknown';
  }
}

function serializeScratchLease(lease: ScratchLease): string {
  return JSON.stringify({
    repository: lease.repository,
    featureSlug: lease.featureSlug,
    runId: lease.runId,
    attempt: lease.attempt,
    ...(lease.step === undefined ? {} : { step: lease.step }),
    ...(lease.provider === undefined ? {} : { provider: lease.provider }),
    ...(lease.member === undefined ? {} : { member: lease.member }),
    ownerPid: lease.ownerPid,
    startedAt: lease.startedAt,
  });
}

export async function readScratchLease(home: string, options: { fs?: ScratchFs } = {}): Promise<ScratchLeaseReadResult> {
  let content: string | null;
  try {
    content = await (options.fs ?? realScratchFs).readFile(join(home, OWNER_LEASE_FILE));
  } catch {
    return { kind: 'malformed' };
  }
  if (content === null) return { kind: 'missing' };

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { kind: 'malformed' };
  }
  if (!isScratchLease(value)) return { kind: 'incomplete' };
  return { kind: 'present', lease: value };
}

function isScratchLease(value: unknown): value is ScratchLease {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const lease = value as Record<string, unknown>;
  return typeof lease.repository === 'string' &&
    typeof lease.featureSlug === 'string' &&
    typeof lease.runId === 'string' &&
    typeof lease.attempt === 'number' &&
    (lease.step === undefined || isStepName(lease.step)) &&
    (lease.provider === undefined || isSelfHostProviderId(lease.provider)) &&
    (lease.member === undefined || typeof lease.member === 'string') &&
    typeof lease.ownerPid === 'number' &&
    typeof lease.startedAt === 'string';
}

function leaseReason(kind: Exclude<ScratchLeaseReadResult['kind'], 'present'>): 'no-lease' | 'malformed-lease' | 'incomplete-lease' {
  switch (kind) {
    case 'missing': return 'no-lease';
    case 'malformed': return 'malformed-lease';
    case 'incomplete': return 'incomplete-lease';
  }
}

function isNonEmptyOrMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'ENOTEMPTY' || (error as { code?: unknown }).code === 'ENOENT');
}

async function readDirectory(path: string, fs: ScratchFs): Promise<readonly string[]> {
  try {
    return await fs.readdir(path);
  } catch {
    return [];
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code?: unknown }).code === 'ESRCH';
}

export function resolveScratchHome(options: ResolveScratchHomeOptions): string {
  const { worktreeRoot, runId, attempt, provider, member } = options;

  if (worktreeRoot === undefined) {
    throw new Error('worktree root is required');
  }
  if (runId === undefined) {
    throw new Error('run id is required');
  }
  if (attempt === undefined) {
    throw new Error('attempt is required');
  }
  if (provider === undefined) {
    throw new Error('provider is required');
  }

  const leaf = member === undefined
    ? `${attempt}-${provider}`
    : `${attempt}-${provider}-${sanitizeProviderMember(member)}`;
  return join(normalize(worktreeRoot), '.daemon', 'scratch', runId, leaf);
}
