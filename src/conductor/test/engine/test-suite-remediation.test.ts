import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUILD_REVIEW_REPAIR_LEDGER,
  readTestSuiteRemediations,
  recordTestSuiteRemediation,
  wasInvalidatedByRebase,
} from '../../src/engine/test-suite-remediation.js';

describe('recordTestSuiteRemediation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-suite-remediation-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists one stable repair record for the same upstream-induced failure across repeated rebases', async () => {
    const failure = {
      reason: 'command_failed' as const,
      message: 'full-suite-verification-gate expected npm run test:changed but config is npm test',
    };

    const first = await recordTestSuiteRemediation(dir, failure, {
      satisfied: false,
      checkedAt: 101,
      kickback: { from: 'rebase', evidence: 'first rebase' },
    });
    const second = await recordTestSuiteRemediation(dir, failure, {
      satisfied: false,
      checkedAt: 202,
      kickback: { from: 'rebase', evidence: 'second rebase' },
    });
    const records = await readTestSuiteRemediations(dir);

    expect(first?.id).toEqual(second?.id);
    expect(first?.id).toMatch(/^repair-[a-f0-9]{12}$/);
    expect(records).toEqual([first]);
    expect(records[0].diagnostic).toBe(failure.message);
  });

  it('accumulates distinct failures instead of replacing prior rebase remediation provenance', async () => {
    const first = await recordTestSuiteRemediation(dir, {
      reason: 'command_failed',
      message: 'repair stale expectation A',
    }, { satisfied: false, checkedAt: 101, kickback: { from: 'rebase', evidence: 'one' } });
    const second = await recordTestSuiteRemediation(dir, {
      reason: 'timeout',
      message: 'repair stale expectation B',
    }, { satisfied: false, checkedAt: 202, kickback: { from: 'rebase', evidence: 'two' } });
    const records = await readTestSuiteRemediations(dir);

    expect(first?.id).not.toBe(second?.id);
    expect(records).toEqual([first, second]);
  });

  it('authorizes recording only from a mechanically rebase-invalidated gate', () => {
    expect(wasInvalidatedByRebase({ kickback: { from: 'rebase' } })).toBe(true);
    expect(wasInvalidatedByRebase({ kickback: { from: 'build_review' } })).toBe(false);
    expect(wasInvalidatedByRebase(null)).toBe(false);
  });

  it('consumes one rebase invalidation once and serializes concurrent writers', async () => {
    const verdict = {
      satisfied: false,
      checkedAt: 303,
      kickback: { from: 'rebase' as const, evidence: 'same rebase' },
    };
    const [first, second] = await Promise.all([
      recordTestSuiteRemediation(dir, { reason: 'command_failed', message: 'first' }, verdict),
      recordTestSuiteRemediation(dir, { reason: 'command_failed', message: 'second' }, verdict),
    ]);
    const records = await readTestSuiteRemediations(dir);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it('reclaims a lock left by a dead daemon process', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, `${BUILD_REVIEW_REPAIR_LEDGER}.lock`),
      JSON.stringify({ pid: 2_147_483_647, createdAt: 1 }) + '\n',
    );

    const record = await recordTestSuiteRemediation(
      dir,
      { reason: 'command_failed', message: 'repair after restart' },
      {
        satisfied: false,
        checkedAt: 404,
        kickback: { from: 'rebase', evidence: 'restarted daemon' },
      },
    );

    expect(record?.id).toMatch(/^repair-/);
  });
});
