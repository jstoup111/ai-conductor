import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_WAIT_TIMEOUT_MS = 1_000;
const DEFAULT_RETRY_DELAY_MS = 10;
const LEASE_OWNER_FILE = 'owner.json';
const LEASE_RECOVERY_CLAIM_FILE = 'recovery.json';

export interface ConductStateLeaseFilesystem {
  /** Atomically creates a previously absent lease directory. */
  acquireDirectory(path: string): Promise<void>;
  writeOwner(path: string, contents: string): Promise<void>;
  readOwner(path: string): Promise<string>;
  writeRecoveryClaim(path: string, contents: string): Promise<void>;
  readRecoveryClaim(path: string): Promise<string | null>;
  moveDirectory(path: string, destination: string): Promise<void>;
  releaseDirectory(path: string): Promise<void>;
}

export interface ConductStateLeaseOwner {
  version: 1;
  pid: number;
  token: string;
  acquiredAt: string;
}

export interface ConductStateLeaseHandle {
  release(): Promise<{ ok: true } | { ok: false; message: string }>;
}

export type ConductStateLeaseFailureKind =
  | 'timeout'
  | 'recovery_refused'
  | 'interrupted'
  | 'filesystem';

export type ConductStateLeaseAcquireResult =
  | { ok: true; handle: ConductStateLeaseHandle }
  | { ok: false; kind: ConductStateLeaseFailureKind; message: string };

export interface ConductStateLease {
  acquire(): Promise<ConductStateLeaseAcquireResult>;
}

export interface ConductStateLeaseOptions {
  /** Optional human-readable name for the store whose mutation this lease guards. */
  label?: string;
  filesystem?: ConductStateLeaseFilesystem;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  newToken?: () => string;
  pid?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
  /** Test seam; production probes process liveness without sending a signal. */
  processIsLive?: (pid: number) => boolean;
  /** Observability seam for the narrowly-defined stale-owner recovery path. */
  onRecoveryDiagnostic?: (diagnostic: ConductStateLeaseRecoveryDiagnostic) => void;
}

export type ConductStateLeaseRecoveryDiagnostic =
  | { kind: 'recovered'; statePath: string; ownerPid: number; storeLabel?: string }
  | {
    kind: 'refused';
    statePath: string;
    reason: 'invalid_owner_metadata' | 'owner_liveness_unverifiable' | 'ownership_changed';
    storeLabel?: string;
  };

const defaultFilesystem: ConductStateLeaseFilesystem = {
  async acquireDirectory(path): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path);
  },
  // A contender may begin recovery as soon as the lease directory appears.
  // Publish ownership with a rename so it sees either no owner (initializing)
  // or the complete record, never a transient empty/truncated JSON document.
  async writeOwner(path, contents): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  readOwner: (path) => readFile(path, 'utf8'),
  writeRecoveryClaim: (path, contents) => writeFile(path, contents, { encoding: 'utf8', flag: 'wx' }),
  async readRecoveryClaim(path): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  moveDirectory: rename,
  releaseDirectory: (path) => rm(path, { recursive: true }),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyHeld(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function ownerPath(leasePath: string): string {
  return `${leasePath}/${LEASE_OWNER_FILE}`;
}

function recoveryClaimPath(leasePath: string): string {
  return `${leasePath}/${LEASE_RECOVERY_CLAIM_FILE}`;
}

function recoverySuccessorClaimPath(
  leasePath: string,
  ownerToken: string,
  predecessorToken: string | null,
): string {
  const slot = createHash('sha256')
    .update(JSON.stringify([ownerToken, predecessorToken]))
    .digest('hex');
  return `${leasePath}/recovery.${slot}.json`;
}

function isLeaseOwner(value: unknown): value is ConductStateLeaseOwner {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    Number.isInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    typeof record.acquiredAt === 'string' &&
    !Number.isNaN(Date.parse(record.acquiredAt));
}

function parseLeaseOwner(serialized: string): ConductStateLeaseOwner | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isLeaseOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface RecoveryClaimIdentity {
  version: 1;
  pid: number;
  token: string;
  claimedAt: string;
}

type ParsedRecoveryClaim =
  | { kind: 'invalid' }
  | { kind: 'legacy'; identity: RecoveryClaimIdentity }
  | {
    kind: 'bound';
    identity: RecoveryClaimIdentity & { ownerToken: string; predecessorToken: string | null };
    successorPath: string;
  };

function parseRecoveryClaim(
  serialized: string,
  leasePath: string,
): ParsedRecoveryClaim {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'invalid' };
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 ||
    !Number.isInteger(record.pid) || (record.pid as number) <= 0 ||
    typeof record.token !== 'string' || record.token.length === 0 ||
    typeof record.claimedAt !== 'string' || Number.isNaN(Date.parse(record.claimedAt))) {
    return { kind: 'invalid' };
  }

  const identity: RecoveryClaimIdentity = {
    version: 1,
    pid: record.pid as number,
    token: record.token as string,
    claimedAt: record.claimedAt as string,
  };
  const hasOwnerToken = Object.hasOwn(record, 'ownerToken');
  const hasPredecessorToken = Object.hasOwn(record, 'predecessorToken');
  if (hasOwnerToken !== hasPredecessorToken) return { kind: 'invalid' };
  if (!hasOwnerToken) return { kind: 'legacy', identity };
  if (typeof record.ownerToken !== 'string' || record.ownerToken.length === 0 ||
    (record.predecessorToken !== null &&
      (typeof record.predecessorToken !== 'string' || record.predecessorToken.length === 0))) {
    return { kind: 'invalid' };
  }
  const boundIdentity = {
    ...identity,
    ownerToken: record.ownerToken as string,
    predecessorToken: record.predecessorToken as string | null,
  };
  return {
    kind: 'bound',
    identity: boundIdentity,
    successorPath: recoverySuccessorClaimPath(
      leasePath,
      boundIdentity.ownerToken,
      boundIdentity.predecessorToken,
    ),
  };
}

function defaultProcessIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Serializes mutation evaluation and persistence for one local state path.
 * A recovered lease is only taken from an owner whose valid metadata and
 * injected liveness probe prove it dead. Corrupt or ambiguous ownership never
 * falls back to timeout-and-steal behavior.
 */
export function createConductStateLease(
  statePath: string,
  options: ConductStateLeaseOptions = {},
): ConductStateLease {
  const filesystem = options.filesystem ?? defaultFilesystem;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  const newToken = options.newToken ?? randomUUID;
  const pid = options.pid ?? process.pid;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const processIsLive = options.processIsLive ?? defaultProcessIsLive;
  const leasePath = `${statePath}.lease`;
  const leaseName = options.label ?? 'conduct-state';
  const leaseTitle = options.label ?? 'Conduct-state';

  function reportRecovery(diagnostic: ConductStateLeaseRecoveryDiagnostic): void {
    try {
      options.onRecoveryDiagnostic?.({
        ...diagnostic,
        ...(options.label === undefined ? {} : { storeLabel: options.label }),
      });
    } catch {
      // Diagnostics must never change lease ownership or error authority.
    }
  }

  async function recoverDeadOwner(deadline: number): Promise<
    | { status: 'recovered'; ownerPid: number }
    | { status: 'occupied'; blocker: { kind: 'owner' | 'claimant'; pid: number } }
    // `mkdir` succeeds before the owner metadata write. A peer that observes
    // that short creation window must wait for the owner (or release), not
    // misclassify a healthy concurrent writer as an ambiguous lease.
    | { status: 'initializing' }
    | { status: 'vanished' }
    | { status: 'timeout'; blocker: { kind: 'dead_owner' | 'unresolved_recovery'; pid: number } }
    | { status: 'refused'; message: string }
  > {
    let serializedOwner: string;
    try {
      serializedOwner = await filesystem.readOwner(ownerPath(leasePath));
    } catch (error) {
      if (isMissing(error)) return { status: 'initializing' };
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: owner metadata is unavailable (${errorMessage(error)})`,
      };
    }
    const owner = parseLeaseOwner(serializedOwner);
    if (owner === null) {
      reportRecovery({ kind: 'refused', statePath, reason: 'invalid_owner_metadata' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: owner metadata is invalid or ambiguous`,
      };
    }

    let ownerIsLive: boolean;
    try {
      ownerIsLive = processIsLive(owner.pid);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'owner_liveness_unverifiable' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: owner liveness is unverifiable (${errorMessage(error)})`,
      };
    }
    if (ownerIsLive) return { status: 'occupied', blocker: { kind: 'owner', pid: owner.pid } };
    if (now() >= deadline) return { status: 'timeout', blocker: { kind: 'dead_owner', pid: owner.pid } };

    const claimFor = (predecessorToken: string | null): string => `${JSON.stringify({
      version: 1,
      pid,
      token: `${newToken()}:recovery`,
      claimedAt: new Date(now()).toISOString(),
      ownerToken: owner.token,
      predecessorToken,
    })}\n`;
    let terminalClaimPath = recoveryClaimPath(leasePath);
    let terminalClaim = claimFor(null);
    try {
      await filesystem.writeRecoveryClaim(terminalClaimPath, terminalClaim);
    } catch (error) {
      if (isAlreadyHeld(error)) {
        let claimPath = recoveryClaimPath(leasePath);
        let predecessorToken: string | null = null;
        let currentOwnerRoot = false;
        const visitedClaimTokens = new Set<string>();
        while (true) {
          if (now() >= deadline) return { status: 'timeout', blocker: { kind: 'unresolved_recovery', pid: owner.pid } };
          let serializedClaim: string | null;
          try {
            serializedClaim = await filesystem.readRecoveryClaim(claimPath);
          } catch (claimReadError) {
            return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claim read failed (${errorMessage(claimReadError)})` };
          }
          // A claim can disappear after a competing successor creation fails
          // with EEXIST but before this contender reads it. No authority has
          // been used by this caller yet, so retry acquisition within the
          // original deadline instead of treating that race as malformed data.
          if (serializedClaim === null) return { status: 'vanished' };
          const existingClaim = parseRecoveryClaim(serializedClaim, leasePath);
          if (!currentOwnerRoot && existingClaim.kind === 'bound' &&
            existingClaim.identity.ownerToken !== owner.token &&
            existingClaim.identity.predecessorToken === null && predecessorToken === null) {
            claimPath = recoverySuccessorClaimPath(leasePath, owner.token, null);
            predecessorToken = null;
            currentOwnerRoot = true;
            const currentOwnerClaim = claimFor(null);
            try {
              await filesystem.writeRecoveryClaim(claimPath, currentOwnerClaim);
              terminalClaimPath = claimPath;
              terminalClaim = currentOwnerClaim;
              break;
            } catch (currentOwnerRootError) {
              if (isAlreadyHeld(currentOwnerRootError)) continue;
              if (isMissing(currentOwnerRootError)) return { status: 'vanished' };
              return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claim creation failed (${errorMessage(currentOwnerRootError)})` };
            }
          }
          if (existingClaim.kind === 'invalid' ||
            (existingClaim.kind === 'legacy' && predecessorToken !== null) ||
            (existingClaim.kind === 'bound' &&
              (existingClaim.identity.ownerToken !== owner.token ||
                existingClaim.identity.predecessorToken !== predecessorToken))) {
            return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claim is invalid or inconsistent` };
          }
          if (visitedClaimTokens.has(existingClaim.identity.token)) {
            return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claim is invalid or inconsistent` };
          }
          visitedClaimTokens.add(existingClaim.identity.token);
          try {
            if (processIsLive(existingClaim.identity.pid)) {
              return { status: 'occupied', blocker: { kind: 'claimant', pid: existingClaim.identity.pid } };
            }
          } catch (claimLivenessError) {
            return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claimant liveness is unverifiable (${errorMessage(claimLivenessError)})` };
          }
          if (now() >= deadline) {
            return { status: 'timeout', blocker: { kind: 'unresolved_recovery', pid: existingClaim.identity.pid } };
          }
          predecessorToken = existingClaim.identity.token;
          claimPath = recoverySuccessorClaimPath(leasePath, owner.token, predecessorToken);
          const successorClaim = claimFor(predecessorToken);
          try {
            await filesystem.writeRecoveryClaim(claimPath, successorClaim);
            terminalClaimPath = claimPath;
            terminalClaim = successorClaim;
            break;
          } catch (successorError) {
            if (isAlreadyHeld(successorError)) continue;
            if (isMissing(successorError)) return { status: 'vanished' };
            return { status: 'refused', message: `Unable to recover ${leaseName} lease: recovery claim creation failed (${errorMessage(successorError)})` };
          }
        }
      } else {
      // The lease directory disappeared between reading its owner and claiming
      // recovery: the owner released it (or a peer recovered it first) while this
      // process was probing liveness. Nothing was stolen and nothing is ambiguous
      // — the lease is simply unheld now, so the caller retries the creation
      // rather than failing an otherwise healthy mutation.
      if (isMissing(error)) return { status: 'vanished' };
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
        return {
          status: 'refused',
          message: `Unable to recover ${leaseName} lease: recovery claim creation failed (${errorMessage(error)})`,
        };
      }
    }

    if (now() >= deadline) return { status: 'timeout', blocker: { kind: 'unresolved_recovery', pid } };

    let confirmedOwner: string;
    let confirmedClaim: string | null;
    try {
      [confirmedOwner, confirmedClaim] = await Promise.all([
        filesystem.readOwner(ownerPath(leasePath)),
        filesystem.readRecoveryClaim(terminalClaimPath),
      ]);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: ownership changed during recovery (${errorMessage(error)})`,
      };
    }
    if (confirmedOwner !== serializedOwner || confirmedClaim !== terminalClaim) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return { status: 'vanished' };
    }

    const quarantinedLeasePath = `${leasePath}.stale.${pid}.${newToken()}`;
    try {
      await filesystem.moveDirectory(leasePath, quarantinedLeasePath);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: could not quarantine dead owner (${errorMessage(error)})`,
      };
    }

    let quarantinedOwner: string;
    let quarantinedClaim: string | null;
    try {
      [quarantinedOwner, quarantinedClaim] = await Promise.all([
        filesystem.readOwner(ownerPath(quarantinedLeasePath)),
        filesystem.readRecoveryClaim(`${quarantinedLeasePath}${terminalClaimPath.slice(leasePath.length)}`),
      ]);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: quarantine identity confirmation failed (${errorMessage(error)})`,
      };
    }
    if (quarantinedOwner !== serializedOwner || quarantinedClaim !== terminalClaim) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: quarantine identity confirmation failed`,
      };
    }
    try {
      await filesystem.releaseDirectory(quarantinedLeasePath);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: quarantine cleanup failed (${errorMessage(error)})`,
      };
    }

    reportRecovery({ kind: 'recovered', statePath, ownerPid: owner.pid });
    return { status: 'recovered', ownerPid: owner.pid };
  }

  return {
    async acquire(): Promise<ConductStateLeaseAcquireResult> {
      const startedAt = now();
      const token = newToken();
      const owner: ConductStateLeaseOwner = {
        version: 1,
        pid,
        token,
        acquiredAt: new Date(startedAt).toISOString(),
      };
      const serializedOwner = `${JSON.stringify(owner)}\n`;
      let blocker: {
        kind: 'owner' | 'claimant' | 'initializing' | 'changed' | 'dead_owner' | 'unresolved_recovery';
        pid?: number;
      } | undefined;
      const deadline = startedAt + waitTimeoutMs;

      const timeoutMessage = (): string => {
        if (blocker?.kind === 'owner') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; owner pid ${blocker.pid} is live`;
        }
        if (blocker?.kind === 'claimant') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; recovery claimant pid ${blocker.pid} is live`;
        }
        if (blocker?.kind === 'initializing') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; lease owner is initializing`;
        }
        if (blocker?.kind === 'changed') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; lease ownership changed during acquisition`;
        }
        if (blocker?.kind === 'dead_owner') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; dead owner pid ${blocker.pid} could not be recovered`;
        }
        if (blocker?.kind === 'unresolved_recovery') {
          return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms; recovery claimant pid ${blocker.pid} is unresolved`;
        }
        return `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms`;
      };

      while (true) {
        try {
          await filesystem.acquireDirectory(leasePath);
        } catch (error) {
          if (!isAlreadyHeld(error)) {
            return {
              ok: false,
              kind: 'filesystem',
              message: `Unable to acquire ${leaseName} lease: ${errorMessage(error)}`,
            };
          }

          const recovery = await recoverDeadOwner(deadline);
          if (recovery.status === 'recovered') continue;
          if (recovery.status === 'refused') {
            return { ok: false, kind: 'recovery_refused', message: recovery.message };
          }
          if (recovery.status === 'timeout') {
            blocker = recovery.blocker;
            return {
              ok: false,
              kind: 'timeout',
              message: timeoutMessage(),
            };
          }
          if (recovery.status === 'occupied') blocker = recovery.blocker;
          if (recovery.status === 'initializing') blocker = { kind: 'initializing' };
          if (recovery.status === 'vanished') blocker = { kind: 'changed' };

          const elapsedMs = now() - startedAt;
          if (elapsedMs >= waitTimeoutMs) {
            return {
              ok: false,
              kind: 'timeout',
              message: timeoutMessage(),
            };
          }
          // A vanished lease is unheld right now, so retry the creation without
          // burning a retry delay. An initializing lease is still live, but its
          // owner write has not become visible yet; wait for it or its creator's
          // cleanup. The wait budget still bounds both races.
          if (recovery.status === 'vanished') continue;
          try {
            await wait(Math.min(retryDelayMs, waitTimeoutMs - elapsedMs));
          } catch (waitError) {
            return {
              ok: false,
              kind: 'interrupted',
              message: `Interrupted while waiting for ${leaseName} lease: ${errorMessage(waitError)}`,
            };
          }
          continue;
        }

        try {
          await filesystem.writeOwner(ownerPath(leasePath), serializedOwner);
        } catch (error) {
          // Publication can lose a race to ownership becoming visible. Only
          // remove the directory when its owner path is still absent: deleting
          // on an unreadable or newly-present record could tear down a live
          // owner's lease while reporting our own publication failure.
          try {
            await filesystem.readOwner(ownerPath(leasePath));
          } catch (ownerError) {
            if (isMissing(ownerError)) {
              await filesystem.releaseDirectory(leasePath).catch(() => undefined);
            }
          }
          return {
            ok: false,
            kind: 'filesystem',
            message: `Unable to record ${leaseName} lease owner: ${errorMessage(error)}`,
          };
        }

        return {
          ok: true,
          handle: {
            async release(): Promise<{ ok: true } | { ok: false; message: string }> {
              try {
                if (await filesystem.readOwner(ownerPath(leasePath)) !== serializedOwner) {
                  return { ok: false, message: `${leaseTitle} lease ownership was lost before release` };
                }
                const serializedRootClaim = await filesystem.readRecoveryClaim(recoveryClaimPath(leasePath));
                const rootClaim = serializedRootClaim === null
                  ? null
                  : parseRecoveryClaim(serializedRootClaim, leasePath);
                const foreignRoot = rootClaim?.kind === 'bound' &&
                  rootClaim.identity.ownerToken !== owner.token &&
                  rootClaim.identity.predecessorToken === null;
                const currentOwnerAuthorityPath = recoverySuccessorClaimPath(leasePath, owner.token, null);
                const serializedCurrentOwnerClaim = foreignRoot
                  ? await filesystem.readRecoveryClaim(currentOwnerAuthorityPath)
                  : null;
                const currentOwnerClaim = serializedCurrentOwnerClaim === null
                  ? null
                  : parseRecoveryClaim(serializedCurrentOwnerClaim, leasePath);
                if ((rootClaim !== null && !foreignRoot) ||
                  currentOwnerClaim !== null) {
                  return { ok: false, message: `${leaseTitle} lease recovery is in progress` };
                }
                await filesystem.releaseDirectory(leasePath);
                return { ok: true };
              } catch (error) {
                return { ok: false, message: `Unable to release ${leaseName} lease: ${errorMessage(error)}` };
              }
            },
          },
        };
      }
    },
  };
}
