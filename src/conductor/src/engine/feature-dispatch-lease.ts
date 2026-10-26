import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { hostname as localHostname } from 'node:os';
import { dirname, join } from 'node:path';

const OWNER_FILE = 'owner.json';
const RECOVERY_CLAIM_FILE = 'recovery.json';

export interface FeatureDispatchLeaseOwner {
  readonly host: string;
  readonly pid: number;
  readonly processStartTime: string;
  readonly token: string;
  readonly purpose: string;
}

export interface FeatureDispatchLease {
  release(): Promise<{ ok: true } | { ok: false; message: string }>;
}

export type FeatureDispatchLeaseAcquireResult =
  | { kind: 'acquired'; lease: FeatureDispatchLease }
  | { kind: 'live-owner'; owner: FeatureDispatchLeaseOwner }
  | { kind: 'unreadable-owner'; leasePath: string }
  | { kind: 'recovery-in-progress'; leasePath: string }
  | { kind: 'unavailable'; message: string };

/** Render an actionable refusal shared by all operator entry points. */
export function formatFeatureDispatchLeaseRefusal(
  result: Exclude<FeatureDispatchLeaseAcquireResult, { readonly kind: 'acquired' }>,
): string {
  switch (result.kind) {
    case 'live-owner':
      return `feature dispatch lease is held by ${result.owner.purpose} (pid ${result.owner.pid})`;
    case 'unreadable-owner':
      return `feature dispatch lease owner is unreadable at ${result.leasePath}`;
    case 'recovery-in-progress':
      return `feature dispatch lease recovery is in progress at ${result.leasePath}`;
    case 'unavailable':
      return result.message;
  }
}

export interface FeatureDispatchLeaseOptions {
  /** Test seams keep liveness and ownership deterministic without another process. */
  readonly hostname?: () => string;
  readonly pid?: number;
  readonly processStartTime?: (pid: number) => Promise<string | undefined>;
  readonly newToken?: () => string;
}

interface RecoveryClaim {
  readonly pid: number;
  readonly token: string;
  readonly ownerToken: string;
}

function featureDispatchLeasePath(repositoryRoot: string, slug: string): string {
  return join(repositoryRoot, '.daemon', 'leases', slug);
}

function ownerPath(leasePath: string): string {
  return join(leasePath, OWNER_FILE);
}

function recoveryClaimPath(leasePath: string): string {
  return join(leasePath, RECOVERY_CLAIM_FILE);
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isOwner(value: unknown): value is FeatureDispatchLeaseOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.host === 'string' && owner.host.length > 0 &&
    Number.isInteger(owner.pid) && (owner.pid as number) > 0 &&
    typeof owner.processStartTime === 'string' && owner.processStartTime.length > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0 &&
    typeof owner.purpose === 'string' && owner.purpose.length > 0;
}

function parseOwner(serialized: string): FeatureDispatchLeaseOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isOwner(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function linuxProcessStartTime(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // The executable name is parenthesized and may itself contain spaces. Field
    // 22 is therefore index 19 only after the final closing parenthesis.
    return stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)[19];
  } catch {
    return undefined;
  }
}

async function writeOwner(path: string, serializedOwner: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializedOwner, { encoding: 'utf8', flag: 'wx' });
    // `link` publishes only if the owner name remains absent. A delayed writer
    // cannot replace a record another contender has already made visible.
    await link(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function removeOwnedRecoveryClaim(path: string, serializedClaim: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === serializedClaim) await unlink(path);
  } catch {
    // A changed or already-consumed claim is owned by another recovery attempt.
  }
}

/**
 * Acquire the one durable dispatch lease for a feature, rooted at the shared
 * repository rather than a disposable worktree. Stale recovery is guarded by
 * an exclusive claim and a byte-for-byte revalidation before quarantine.
 */
export async function acquireFeatureDispatchLease(
  repositoryRoot: string,
  slug: string,
  purpose: string,
  options: FeatureDispatchLeaseOptions = {},
): Promise<FeatureDispatchLeaseAcquireResult> {
  const leasePath = featureDispatchLeasePath(repositoryRoot, slug);
  const hostname = options.hostname ?? localHostname;
  const pid = options.pid ?? process.pid;
  const processStartTime = options.processStartTime ?? linuxProcessStartTime;
  const newToken = options.newToken ?? randomUUID;
  const startTime = await processStartTime(pid);
  if (startTime === undefined) {
    return { kind: 'unavailable', message: 'cannot determine feature dispatch owner process start time' };
  }

  const owner: FeatureDispatchLeaseOwner = {
    host: hostname(),
    pid,
    processStartTime: startTime,
    token: newToken(),
    purpose,
  };
  const serializedOwner = JSON.stringify(owner);

  async function release(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      if (await readFile(ownerPath(leasePath), 'utf8') !== serializedOwner) {
        return { ok: false, message: 'Feature dispatch lease ownership was lost before release' };
      }
      try {
        await readFile(recoveryClaimPath(leasePath), 'utf8');
        return { ok: false, message: 'Feature dispatch lease recovery is in progress' };
      } catch (error) {
        if (!isMissing(error)) return { ok: false, message: `Unable to inspect feature dispatch lease recovery: ${String(error)}` };
      }
      await rm(leasePath, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: `Unable to release feature dispatch lease: ${String(error)}` };
    }
  }

  for (;;) {
    try {
      await mkdir(dirname(leasePath), { recursive: true });
      await mkdir(leasePath);
      try {
        await writeOwner(ownerPath(leasePath), serializedOwner);
      } catch (error) {
        await rm(leasePath, { recursive: true, force: true }).catch(() => undefined);
        return { kind: 'unavailable', message: `Unable to record feature dispatch lease owner: ${String(error)}` };
      }
      return { kind: 'acquired', lease: { release } };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        return { kind: 'unavailable', message: `Unable to acquire feature dispatch lease: ${String(error)}` };
      }
    }

    let serializedPreviousOwner: string;
    try {
      serializedPreviousOwner = await readFile(ownerPath(leasePath), 'utf8');
    } catch {
      return { kind: 'unreadable-owner', leasePath };
    }
    const previousOwner = parseOwner(serializedPreviousOwner);
    if (previousOwner === undefined) return { kind: 'unreadable-owner', leasePath };

    const observedStartTime = previousOwner.host === hostname()
      ? await processStartTime(previousOwner.pid)
      : undefined;
    if (observedStartTime === previousOwner.processStartTime) {
      return { kind: 'live-owner', owner: previousOwner };
    }

    const claim: RecoveryClaim = { pid, token: newToken(), ownerToken: previousOwner.token };
    const serializedClaim = JSON.stringify(claim);
    const claimPath = recoveryClaimPath(leasePath);
    try {
      await writeFile(claimPath, serializedClaim, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (isAlreadyExists(error)) return { kind: 'recovery-in-progress', leasePath };
      if (isMissing(error)) continue;
      return { kind: 'unavailable', message: `Unable to claim stale feature dispatch lease: ${String(error)}` };
    }

    try {
      const [confirmedOwner, confirmedClaim] = await Promise.all([
        readFile(ownerPath(leasePath), 'utf8'),
        readFile(claimPath, 'utf8'),
      ]);
      if (confirmedOwner !== serializedPreviousOwner || confirmedClaim !== serializedClaim) {
        await removeOwnedRecoveryClaim(claimPath, serializedClaim);
        return { kind: 'recovery-in-progress', leasePath };
      }
      const quarantined = `${leasePath}.stale.${pid}.${newToken()}`;
      await rename(leasePath, quarantined);
      await rm(quarantined, { recursive: true, force: true });
    } catch (error) {
      await removeOwnedRecoveryClaim(claimPath, serializedClaim);
      if (isMissing(error)) continue;
      return { kind: 'unavailable', message: `Unable to reclaim feature dispatch lease: ${String(error)}` };
    }
  }
}
