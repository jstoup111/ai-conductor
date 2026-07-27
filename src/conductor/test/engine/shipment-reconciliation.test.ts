import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  planShipmentReconciliation,
  publishShipmentRepair,
  SHIPMENT_REPAIR_STATUS_CONTEXT,
  type ShipmentReconciliationPlan,
} from '../../src/engine/shipment-reconciliation.js';

describe('planShipmentReconciliation', () => {
  it('leaves an aligned merged shipment write-free', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/916',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'aligned', writes: [] });
  });

  it('plans one deterministic record-only repair for missing evidence', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({
      kind: 'repair',
      identity: '916/durable-shipped-records',
      writes: [{
        path: '.docs/shipped/durable-shipped-records.md',
        content: `---\nslug: durable-shipped-records\nspec_hash: ${'a'.repeat(64)}\npr: https://github.com/acme/conductor/pull/916\nshipped: 2026-07-25\n---\n`,
      }],
    });
  });

  it('plans the same record-only repair for invalid evidence', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-hash-mismatch',
        expected: 'a'.repeat(64),
        observed: 'b'.repeat(64),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toMatchObject({
      kind: 'repair',
      identity: '916/durable-shipped-records',
      writes: [{ path: '.docs/shipped/durable-shipped-records.md' }],
    });
  });

  it('keeps ambiguous associations write-free', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: {
        kind: 'not-applicable',
        classification: 'multi-match',
        diagnostic: 'shipment association is multi-match',
      },
      evidence: {
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'unresolved', reason: 'multi-match', writes: [] });
  });

  it('uses the same repair identity for repeated missing-record plans', () => {
    const input = {
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation' as const, slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal' as const,
        code: 'shipped-record-missing' as const,
        expected: '.docs/shipped/durable-shipped-records.md',
        observed: null,
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    };

    const first = planShipmentReconciliation(input);
    const second = planShipmentReconciliation(input);

    expect([
      first.kind === 'repair' ? first.identity : null,
      second.kind === 'repair' ? second.identity : null,
    ]).toEqual(['916/durable-shipped-records', '916/durable-shipped-records']);
  });

  it('leaves an accurate record bytes untouched when it is already aligned', () => {
    const recordBytes = Buffer.from(`---\nslug: durable-shipped-records\nspec_hash: ${'a'.repeat(64)}\npr: https://github.com/acme/conductor/pull/916\nshipped: 2026-07-25\n---\n`);
    const before = Buffer.from(recordBytes);

    const result = planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/916',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2099-01-01' },
    });

    expect({ result, recordBytes }).toEqual({
      result: { kind: 'aligned', writes: [] },
      recordBytes: before,
    });
  });

  it('keeps an unproven valid verdict write-free when its PR identity disagrees', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/917',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: 'b'.repeat(40),
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({ kind: 'unresolved', reason: 'evidence-identity-mismatch', writes: [] });
  });

  it('keeps unavailable evidence write-free instead of fabricating a repair', () => {
    expect(planShipmentReconciliation({
      implementationPr: { number: 916, url: 'https://github.com/acme/conductor/pull/916' },
      association: { kind: 'implementation', slug: 'durable-shipped-records' },
      evidence: {
        kind: 'refusal',
        code: 'shipment-evidence-git-unavailable',
        expected: 'candidate-tree/head reachability',
        observed: 'git transport unavailable',
      },
      expectedRecord: { specHash: 'a'.repeat(64), shipped: '2026-07-25' },
    })).toEqual({
      kind: 'unresolved',
      reason: 'shipment-evidence-git-unavailable',
      writes: [],
    });
  });
});

describe('publishShipmentRepair', () => {
  const repairPlan: ShipmentReconciliationPlan = {
    kind: 'repair',
    identity: '916/durable-shipped-records',
    writes: [{
      path: '.docs/shipped/durable-shipped-records.md',
      content: 'expected durable record\n',
    }],
  };
  const repairBranch = 'shipment-repair/916/durable-shipped-records';
  const repairHead = 'c'.repeat(40);

  it('reuses one deterministic branch and open repair PR across repeated publication', async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const publisher = {
      ensureRepairBranch: async (input: unknown) => { calls.push({ operation: 'branch', input }); },
      commitRecordOnly: async (input: unknown) => {
        calls.push({ operation: 'commit', input });
        return { headSha: repairHead };
      },
      findOrCreateRepairPullRequest: async (input: unknown) => {
        calls.push({ operation: 'pull-request', input });
        return { url: 'https://github.com/acme/conductor/pull/1000', headSha: repairHead };
      },
      verifyRepairHead: async (input: unknown) => {
        calls.push({ operation: 'verify', input });
        return {
          kind: 'valid' as const,
          slug: 'durable-shipped-records',
          pr: 'https://github.com/acme/conductor/pull/916',
          recordPath: '.docs/shipped/durable-shipped-records.md',
          hash: 'a'.repeat(64),
          commit: repairHead,
        };
      },
      postStatus: async (input: unknown) => { calls.push({ operation: 'status', input }); },
    };

    const first = await publishShipmentRepair(repairPlan, publisher);
    const second = await publishShipmentRepair(repairPlan, publisher);

    expect({ first, second, calls }).toEqual({
      first: {
        kind: 'repair-published',
        identity: '916/durable-shipped-records',
        branch: repairBranch,
        pullRequestUrl: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairHead,
        status: 'success',
      },
      second: {
        kind: 'repair-published',
        identity: '916/durable-shipped-records',
        branch: repairBranch,
        pullRequestUrl: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairHead,
        status: 'success',
      },
      calls: [
        { operation: 'branch', input: { branch: repairBranch, base: 'main' } },
        {
          operation: 'commit',
          input: { branch: repairBranch, writes: repairPlan.writes },
        },
        {
          operation: 'pull-request',
          input: {
            branch: repairBranch,
            base: 'main',
            identity: '916/durable-shipped-records',
            expectedHeadSha: repairHead,
          },
        },
        { operation: 'verify', input: { headSha: repairHead } },
        {
          operation: 'status',
          input: {
            sha: repairHead,
            context: SHIPMENT_REPAIR_STATUS_CONTEXT,
            state: 'success',
            description: 'durable shipment evidence valid on repair head',
          },
        },
        { operation: 'branch', input: { branch: repairBranch, base: 'main' } },
        {
          operation: 'commit',
          input: { branch: repairBranch, writes: repairPlan.writes },
        },
        {
          operation: 'pull-request',
          input: {
            branch: repairBranch,
            base: 'main',
            identity: '916/durable-shipped-records',
            expectedHeadSha: repairHead,
          },
        },
        { operation: 'verify', input: { headSha: repairHead } },
        {
          operation: 'status',
          input: {
            sha: repairHead,
            context: SHIPMENT_REPAIR_STATUS_CONTEXT,
            state: 'success',
            description: 'durable shipment evidence valid on repair head',
          },
        },
      ],
    });
  });

  it('limits its write surface to a record-only repair branch and its exact repair-head status', async () => {
    const operations: string[] = [];

    await publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => { operations.push('branch'); },
      commitRecordOnly: async ({ branch, writes }) => {
        operations.push('record-only-commit');
        expect({ branch, paths: writes.map((write) => write.path) }).toEqual({
          branch: repairBranch,
          paths: ['.docs/shipped/durable-shipped-records.md'],
        });
        return { headSha: repairHead };
      },
      findOrCreateRepairPullRequest: async () => {
        operations.push('pull-request');
        return { url: 'https://github.com/acme/conductor/pull/1000', headSha: repairHead };
      },
      verifyRepairHead: async ({ headSha }) => {
        operations.push('verify');
        expect(headSha).toBe(repairHead);
        return {
          kind: 'valid',
          slug: 'durable-shipped-records',
          pr: 'https://github.com/acme/conductor/pull/916',
          recordPath: '.docs/shipped/durable-shipped-records.md',
          hash: 'a'.repeat(64),
          commit: repairHead,
        };
      },
      postStatus: async ({ sha, context, state }) => {
        operations.push('status');
        expect({ sha, context, state }).toEqual({
          sha: repairHead,
          context: SHIPMENT_REPAIR_STATUS_CONTEXT,
          state: 'success',
        });
      },
    });

    expect(operations).toEqual([
      'branch',
      'record-only-commit',
      'pull-request',
      'verify',
      'status',
    ]);
  });

  it('verifies and statuses the GitHub repair-PR head instead of a stale local commit', async () => {
    const staleLocalHead = 'c'.repeat(40);
    const repairPrHead = 'd'.repeat(40);

    const result = await publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => {},
      commitRecordOnly: async () => ({ headSha: staleLocalHead }),
      findOrCreateRepairPullRequest: async () => ({
        url: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairPrHead,
      }),
      verifyRepairHead: async ({ headSha }) => {
        expect(headSha).toBe(repairPrHead);
        return {
          kind: 'valid',
          slug: 'durable-shipped-records',
          pr: 'https://github.com/acme/conductor/pull/916',
          recordPath: '.docs/shipped/durable-shipped-records.md',
          hash: 'a'.repeat(64),
          commit: repairPrHead,
        };
      },
      postStatus: async ({ sha }) => expect(sha).toBe(repairPrHead),
    });

    expect(result).toMatchObject({ headSha: repairPrHead, status: 'success' });
  });

  it('surfaces a repair-branch permission failure with its deterministic retry identity', async () => {
    await expect(publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => { throw new Error('403 Resource not accessible by integration'); },
      commitRecordOnly: async () => { throw new Error('must not commit after branch failure'); },
      findOrCreateRepairPullRequest: async () => { throw new Error('must not create a PR after branch failure'); },
      verifyRepairHead: async () => { throw new Error('must not verify after branch failure'); },
      postStatus: async () => { throw new Error('must not post after branch failure'); },
    })).rejects.toThrow('repair 916/durable-shipped-records branch failed: 403 Resource not accessible by integration');
  });

  it('surfaces a competing repair-branch update at the record-commit stage', async () => {
    await expect(publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => {},
      commitRecordOnly: async () => { throw new Error('non-fast-forward update rejected'); },
      findOrCreateRepairPullRequest: async () => { throw new Error('must not create a PR after competing update'); },
      verifyRepairHead: async () => { throw new Error('must not verify after competing update'); },
      postStatus: async () => { throw new Error('must not post after competing update'); },
    })).rejects.toThrow('repair 916/durable-shipped-records record-commit failed: non-fast-forward update rejected');
  });

  it('surfaces a rate-limited repair-PR write without a fallback', async () => {
    await expect(publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => {},
      commitRecordOnly: async () => ({ headSha: repairHead }),
      findOrCreateRepairPullRequest: async () => { throw new Error('API rate limit exceeded'); },
      verifyRepairHead: async () => { throw new Error('must not verify after PR write failure'); },
      postStatus: async () => { throw new Error('must not post after PR write failure'); },
    })).rejects.toThrow('repair 916/durable-shipped-records pull-request failed: API rate limit exceeded');
  });

  it('posts the stable failed status only when the GitHub repair head is invalid', async () => {
    const statuses: Array<{ sha: string; state: string; description: string }> = [];

    const result = await publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => {},
      commitRecordOnly: async () => ({ headSha: repairHead }),
      findOrCreateRepairPullRequest: async () => ({
        url: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairHead,
      }),
      verifyRepairHead: async () => ({
        kind: 'refusal',
        code: 'shipped-record-hash-mismatch',
        expected: 'a'.repeat(64),
        observed: 'b'.repeat(64),
      }),
      postStatus: async ({ sha, state, description }) => { statuses.push({ sha, state, description }); },
    });

    expect({ result, statuses }).toEqual({
      result: {
        kind: 'repair-published',
        identity: '916/durable-shipped-records',
        branch: repairBranch,
        pullRequestUrl: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairHead,
        status: 'failure',
      },
      statuses: [{
        sha: repairHead,
        state: 'failure',
        description: 'durable shipment evidence: shipped-record-hash-mismatch',
      }],
    });
  });

  it('surfaces insufficient status authority without broadening the repair operation', async () => {
    await expect(publishShipmentRepair(repairPlan, {
      ensureRepairBranch: async () => {},
      commitRecordOnly: async () => ({ headSha: repairHead }),
      findOrCreateRepairPullRequest: async () => ({
        url: 'https://github.com/acme/conductor/pull/1000',
        headSha: repairHead,
      }),
      verifyRepairHead: async () => ({
        kind: 'valid',
        slug: 'durable-shipped-records',
        pr: 'https://github.com/acme/conductor/pull/916',
        recordPath: '.docs/shipped/durable-shipped-records.md',
        hash: 'a'.repeat(64),
        commit: repairHead,
      }),
      postStatus: async () => { throw new Error('403 statuses: write permission required'); },
    })).rejects.toThrow('repair 916/durable-shipped-records status failed: 403 statuses: write permission required');
  });

  it('does not publish a branch, commit, PR, or status for aligned or unresolved plans', async () => {
    const publisher = {
      ensureRepairBranch: async () => { throw new Error('must not create a branch'); },
      commitRecordOnly: async () => { throw new Error('must not create a commit'); },
      findOrCreateRepairPullRequest: async () => { throw new Error('must not create a PR'); },
      verifyRepairHead: async () => { throw new Error('must not verify a repair'); },
      postStatus: async () => { throw new Error('must not post a status'); },
    };

    await expect(publishShipmentRepair({ kind: 'aligned', writes: [] }, publisher)).resolves.toEqual({
      kind: 'aligned',
    });
    await expect(publishShipmentRepair({
      kind: 'unresolved',
      reason: 'multi-match',
      writes: [],
    }, publisher)).resolves.toEqual({
      kind: 'unresolved',
      reason: 'multi-match',
    });
  });

  it('has no direct-main, approval, review, auto-merge, or merge operation in its repair surface', async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const [publisher, cli, workflow] = await Promise.all([
      readFile(join(repoRoot, 'src/conductor/src/engine/shipment-reconciliation.ts'), 'utf8'),
      readFile(join(repoRoot, 'src/conductor/src/engine/shipment-evidence-cli.ts'), 'utf8'),
      readFile(join(repoRoot, '.github/workflows/shipped-record.yml'), 'utf8'),
    ]);
    const prohibitedOperation = /(?:gh\s+pr\s+merge\b|gh\s+pr\s+review\s+[^\n]*--approve\b|\/pulls\/[^\s'"`]+\/merge\b|--auto\b|--reviewer\b|request-review\b|\/pulls\/[^\s'"`]+\/reviews\b|mergePullRequest\b|enablePullRequestAutoMerge\b|requestReviews\b|addPullRequestReview\b|git\s+push\s+[^\n]*\bmain\b|refs\/heads\/main\b)/g;

    expect([
      ...publisher.matchAll(prohibitedOperation),
      ...cli.matchAll(prohibitedOperation),
      ...workflow.matchAll(prohibitedOperation),
    ]).toEqual([]);
  });
});
