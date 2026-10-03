// Covers: task:1

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConductStateLease } from '../../../../src/engine/conduct-state-lease.js';
import {
  INTAKE_CLAIM_LEASE_WAIT_MS,
  IntakeClaimInProgressError,
  withIntakeClaimLease,
} from '../../../../src/engine/engineer/intake/claim-lease.js';

const temporaryDirectories: string[] = [];

async function engineerDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'intake-claim-lease-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'inbox'));
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('withIntakeClaimLease', () => {
  it('uses the inbox lease with the intake claim label, and releases it after a successful body', async () => {
    const engineerDir = await engineerDirectory();
    let leasePresentDuringBody = false;

    await expect(withIntakeClaimLease(engineerDir, async () => {
      leasePresentDuringBody = await stat(join(engineerDir, 'inbox.lease')).then(() => true, () => false);
      return 'claimed';
    })).resolves.toBe('claimed');

    await expect(stat(join(engineerDir, 'inbox.lease'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(leasePresentDuringBody).toBe(true);
  });

  it('releases the inbox lease when the body throws', async () => {
    const engineerDir = await engineerDirectory();

    await expect(withIntakeClaimLease(engineerDir, async () => {
      throw new Error('walk failed');
    })).rejects.toThrow('walk failed');

    await expect(stat(join(engineerDir, 'inbox.lease'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a live owner after the wait bound without running the body', async () => {
    const engineerDir = await engineerDirectory();
    const holderPid = 8123;
    const holder = await createConductStateLease(join(engineerDir, 'inbox'), {
      label: 'intake claim',
      pid: holderPid,
      processIsLive: () => true,
    }).acquire();
    if (!holder.ok) throw new Error(holder.message);
    const body = vi.fn(async () => 'should not run');

    try {
      await expect(withIntakeClaimLease(engineerDir, body, {
        waitTimeoutMs: 0,
        processIsLive: (pid) => pid === holderPid,
      })).rejects.toMatchObject({
        name: 'IntakeClaimInProgressError',
        message: expect.stringMatching(new RegExp(`claim in progress.*${holderPid}`)),
      });
      expect(body).not.toHaveBeenCalled();
    } finally {
      await holder.handle.release();
    }
  });

  it('fails closed on invalid owner metadata without running the body', async () => {
    const engineerDir = await engineerDirectory();
    await mkdir(join(engineerDir, 'inbox.lease'));
    await writeFile(join(engineerDir, 'inbox.lease', 'owner.json'), 'not json');
    const body = vi.fn(async () => 'should not run');

    await expect(withIntakeClaimLease(engineerDir, body, {
      waitTimeoutMs: 1,
    })).rejects.toThrow(/intake claim lease/i);
    expect(body).not.toHaveBeenCalled();
  });

  it('recovers a dead owner and runs the body once', async () => {
    const engineerDir = await engineerDirectory();
    const deadPid = 9123;
    const stale = await createConductStateLease(join(engineerDir, 'inbox'), {
      label: 'intake claim',
      pid: deadPid,
      processIsLive: () => true,
    }).acquire();
    if (!stale.ok) throw new Error(stale.message);
    const body = vi.fn(async () => 'recovered');

    await expect(withIntakeClaimLease(engineerDir, body, {
      processIsLive: (pid) => pid !== deadPid,
    })).resolves.toBe('recovered');
    expect(body).toHaveBeenCalledTimes(1);
  });
});

describe('INTAKE_CLAIM_LEASE_WAIT_MS', () => {
  it('defaults to the five-minute claim walk bound', () => {
    expect(INTAKE_CLAIM_LEASE_WAIT_MS).toBe(300_000);
    expect(IntakeClaimInProgressError).toBeTypeOf('function');
  });
});
