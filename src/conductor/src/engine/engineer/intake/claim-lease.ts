import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createConductStateLease,
  type ConductStateLease,
  type ConductStateLeaseOptions,
} from '../../conduct-state-lease.js';

/** A claim walk can perform several sequential local and GitHub-backed reads. */
export const INTAKE_CLAIM_LEASE_WAIT_MS = 300_000;

const TRANSIENT_LEASE_OWNER_METADATA_FAILURE =
  'Unable to recover intake claim lease: owner metadata is invalid or ambiguous';
const TRANSIENT_LEASE_OWNER_METADATA_RETRIES = 10;

/** A different live claim owns the inbox lease past this claimant's wait bound. */
export class IntakeClaimInProgressError extends Error {
  constructor(message: string) {
    super(`Intake claim in progress: ${message}`);
    this.name = 'IntakeClaimInProgressError';
  }
}

/** Test seams for the underlying durable lease, excluding its fixed claim label. */
export type IntakeClaimLeaseOptions = Omit<ConductStateLeaseOptions, 'label' | 'waitTimeoutMs'> & {
  waitTimeoutMs?: number;
};

function isTransientLeaseOwnerMetadataFailure(
  acquired: Awaited<ReturnType<ConductStateLease['acquire']>>,
): boolean {
  return !acquired.ok &&
    acquired.kind === 'recovery_refused' &&
    (acquired.message === TRANSIENT_LEASE_OWNER_METADATA_FAILURE ||
      acquired.message.includes('owner metadata is unavailable (ENOENT:'));
}

/**
 * Serializes the entire intake claim walk for one engineer inbox.
 *
 * The inbox path is intentional: createConductStateLease derives the sibling
 * `inbox.lease` directory, leaving envelope contents outside the lock marker.
 */
export async function withIntakeClaimLease<T>(
  engineerDir: string,
  body: () => Promise<T>,
  options: IntakeClaimLeaseOptions = {},
): Promise<T> {
  const lease = createConductStateLease(join(engineerDir, 'inbox'), {
    ...options,
    label: 'intake claim',
    waitTimeoutMs: options.waitTimeoutMs ?? INTAKE_CLAIM_LEASE_WAIT_MS,
  });
  let acquired = await lease.acquire();
  // Match ledger contention handling: only the owner-record publication race
  // gets retries; a persistent ambiguity remains a refusal.
  for (
    let retry = 0;
    isTransientLeaseOwnerMetadataFailure(acquired) && retry < TRANSIENT_LEASE_OWNER_METADATA_RETRIES;
    retry += 1
  ) {
    await delay(10);
    acquired = await lease.acquire();
  }
  if (!acquired.ok) {
    if (acquired.kind === 'timeout') throw new IntakeClaimInProgressError(acquired.message);
    throw new Error(`Unable to acquire intake claim lease: ${acquired.message}`);
  }

  let bodySucceeded = false;
  try {
    const result = await body();
    bodySucceeded = true;
    return result;
  } finally {
    const released = await acquired.handle.release();
    if (!released.ok && bodySucceeded) throw new Error(released.message);
  }
}
