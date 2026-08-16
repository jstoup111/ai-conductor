import { randomUUID } from 'node:crypto';
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
  writeOwner: (path, contents) => writeFile(path, contents, { encoding: 'utf8', flag: 'wx' }),
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

function ownerPath(leasePath: string): string {
  return `${leasePath}/${LEASE_OWNER_FILE}`;
}

function recoveryClaimPath(leasePath: string): string {
  return `${leasePath}/${LEASE_RECOVERY_CLAIM_FILE}`;
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

  async function recoverDeadOwner(): Promise<
    | { status: 'recovered'; ownerPid: number }
    | { status: 'occupied'; ownerPid?: number }
    | { status: 'refused'; message: string }
  > {
    let serializedOwner: string;
    try {
      serializedOwner = await filesystem.readOwner(ownerPath(leasePath));
    } catch (error) {
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
    if (ownerIsLive) return { status: 'occupied', ownerPid: owner.pid };

    const claim = `${JSON.stringify({ version: 1, pid, token: `${newToken()}:recovery`, claimedAt: new Date(now()).toISOString() })}\n`;
    try {
      await filesystem.writeRecoveryClaim(recoveryClaimPath(leasePath), claim);
    } catch (error) {
      if (isAlreadyHeld(error)) return { status: 'occupied', ownerPid: owner.pid };
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: could not claim recovery (${errorMessage(error)})`,
      };
    }

    let confirmedOwner: string;
    let confirmedClaim: string | null;
    try {
      [confirmedOwner, confirmedClaim] = await Promise.all([
        filesystem.readOwner(ownerPath(leasePath)),
        filesystem.readRecoveryClaim(recoveryClaimPath(leasePath)),
      ]);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: ownership changed during recovery (${errorMessage(error)})`,
      };
    }
    if (confirmedOwner !== serializedOwner || confirmedClaim !== claim) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: ownership changed during recovery`,
      };
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

    try {
      const [quarantinedOwner, quarantinedClaim] = await Promise.all([
        filesystem.readOwner(ownerPath(quarantinedLeasePath)),
        filesystem.readRecoveryClaim(recoveryClaimPath(quarantinedLeasePath)),
      ]);
      if (quarantinedOwner !== serializedOwner || quarantinedClaim !== claim) {
        reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
        return {
          status: 'refused',
          message: `Unable to recover ${leaseName} lease: ownership changed during recovery`,
        };
      }
      await filesystem.releaseDirectory(quarantinedLeasePath);
    } catch (error) {
      reportRecovery({ kind: 'refused', statePath, reason: 'ownership_changed' });
      return {
        status: 'refused',
        message: `Unable to recover ${leaseName} lease: could not finalize recovery (${errorMessage(error)})`,
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
      let lastLiveOwnerPid: number | undefined;

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

          const recovery = await recoverDeadOwner();
          if (recovery.status === 'recovered') continue;
          if (recovery.status === 'refused') {
            return { ok: false, kind: 'recovery_refused', message: recovery.message };
          }
          lastLiveOwnerPid = recovery.ownerPid;

          const elapsedMs = now() - startedAt;
          if (elapsedMs >= waitTimeoutMs) {
            return {
              ok: false,
              kind: 'timeout',
              message: `Unable to acquire ${leaseName} lease within ${waitTimeoutMs}ms${lastLiveOwnerPid === undefined ? '' : `; owner pid ${lastLiveOwnerPid} is live`}`,
            };
          }
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
          await filesystem.releaseDirectory(leasePath).catch(() => undefined);
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
                if (await filesystem.readRecoveryClaim(recoveryClaimPath(leasePath)) !== null) {
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
