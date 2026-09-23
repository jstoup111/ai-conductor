// A merged implementation PR must never be "repaired" from a stale live root
// checkout, and repair publication must never mutate that checkout
// (false repair PRs #2670, #2682, #2683).
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  makeProductionRepairPublisher,
  makeRecordRepairRequester,
} from '../../src/engine/shipment-evidence-cli.js';
import { shippedRecordContentDroppedBy } from '../../src/engine/shipment-reconciliation.js';
import type { ShipmentEvidenceInput, ShipmentEvidenceResult } from '../../src/engine/shipment-evidence.js';

const PR = 'https://github.com/acme/rocket/pull/42';
const RICH_RECORD = [
  '---',
  'slug: feature',
  'spec_hash: abc',
  `pr: ${PR}`,
  'shipped: 2026-09-23',
  'engine_version: 20260923T000000Z-deadbeef',
  '---',
  '',
  '## Cost',
  '',
  '$1.00',
  '',
  '## Time',
  '',
  '5m',
  '',
].join('\n');
const MINIMAL_RECORD = `---\nslug: feature\nspec_hash: def\npr: ${PR}\nshipped: 2026-09-23\n---\n`;

const scratch: string[] = [];
afterEach(async () => Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function rootCheckout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shipment-repair-root-'));
  scratch.push(root);
  return root;
}

type GitCall = { args: string[]; cwd: string };

function fakeGh(mergeCommit: string) {
  return vi.fn(async (args: string[]) => {
    const joined = args.join(' ');
    if (joined.includes('url,body,files,headRefOid')) {
      return {
        stdout: JSON.stringify({
          url: PR,
          body: 'Implements `.docs/plans/feature.md`.',
          files: [{ path: 'src/feature.ts' }, { path: '.docs/shipped/feature.md' }],
          headRefOid: 'pr-head',
        }),
      };
    }
    if (joined.includes('mergedAt')) {
      return { stdout: JSON.stringify({ mergedAt: '2026-09-23T20:01:09Z', mergeCommit: { oid: mergeCommit } }) };
    }
    if (joined.includes('nameWithOwner')) return { stdout: JSON.stringify({ nameWithOwner: 'acme/rocket' }) };
    throw new Error(`unexpected gh ${joined}`);
  });
}

describe('record repair requester reads fetched git objects, not the live root working tree', () => {
  it('requests no repair when the merge commit already carries the shipped record', async () => {
    const root = await rootCheckout();
    // The stale root checkout has the plan but not yet the merged record.
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), '# plan\n');
    const gitCalls: GitCall[] = [];
    const runGit = vi.fn(async (args: string[], opts: { cwd: string }) => {
      gitCalls.push({ args: [...args], cwd: opts.cwd });
      if (args[0] === 'rev-parse') return { stdout: args.includes('HEAD') ? 'stale-head\n' : 'base-sha\n' };
      if (args[0] === 'ls-tree' && args.includes('.docs/plans/')) return { stdout: '.docs/plans/feature.md\n' };
      if (args[0] === 'ls-tree' && args[2] === 'merge-sha') return { stdout: '.docs/shipped/feature.md\n' };
      return { stdout: '' };
    });
    const evaluateEvidence = vi.fn(async (): Promise<ShipmentEvidenceResult> => ({
      kind: 'refusal', code: 'shipped-record-missing', expected: '.docs/shipped/feature.md', observed: null,
    }));
    const logs: string[] = [];

    await makeRecordRepairRequester({
      cwd: root, runGh: fakeGh('merge-sha'), runGit, evaluateEvidence, log: (message) => logs.push(message),
    })({ slug: 'feature', prUrl: PR });

    expect(gitCalls[0]?.args).toEqual(['fetch', 'origin', 'main']);
    expect(evaluateEvidence).not.toHaveBeenCalled();
    expect(gitCalls.some(({ args }) => ['switch', 'checkout', 'commit', 'worktree'].includes(args[0]!))).toBe(false);
    expect(logs).toEqual([
      `[shipped-record-repair] feature: ${PR} merge commit already carries the record; no repair requested`,
    ]);
  });

  it('evaluates the fetched base commit and reads the spec from it, never the working tree', async () => {
    const root = await rootCheckout(); // no plan on disk: the working tree is never consulted
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: args.includes('HEAD') ? 'stale-head\n' : 'base-sha\n' };
      if (args[0] === 'ls-tree' && args.includes('.docs/plans/')) return { stdout: '.docs/plans/feature.md\n' };
      if (args[0] === 'ls-tree' && args.includes('.docs/plans/feature.md')) return { stdout: '.docs/plans/feature.md\n' };
      if (args[0] === 'show' && args[1] === 'base-sha:.docs/plans/feature.md') return { stdout: '# plan\n' };
      return { stdout: '' };
    });
    const evaluateEvidence = vi.fn(async (_input: ShipmentEvidenceInput): Promise<ShipmentEvidenceResult> => ({
      kind: 'refusal', code: 'shipment-candidate-stale', expected: 'pr-head', observed: 'base-sha',
    }));
    const logs: string[] = [];

    await makeRecordRepairRequester({
      cwd: root, runGh: fakeGh('merge-sha'), runGit, evaluateEvidence, log: (message) => logs.push(message),
    })({ slug: 'feature', prUrl: PR });

    expect(evaluateEvidence).toHaveBeenCalledOnce();
    expect(evaluateEvidence.mock.calls[0]?.[0]).toMatchObject({ candidateCommit: 'base-sha', slug: 'feature' });
    expect(logs).toEqual(['[shipped-record-repair] feature: unresolved (shipment-candidate-stale)']);
  });
});

describe('repair publisher never mutates the live root checkout', () => {
  function publisherFixture(root: string, existingRecord: string | null) {
    const gitCalls: GitCall[] = [];
    const runGit = vi.fn(async (args: string[], opts: { cwd: string }) => {
      gitCalls.push({ args: [...args], cwd: opts.cwd });
      if (args[0] === 'ls-tree') return { stdout: existingRecord === null ? '' : `${args[args.length - 1]}\n` };
      if (args[0] === 'show') return { stdout: existingRecord ?? '' };
      if (args[0] === 'diff') return { stdout: '.docs/shipped/feature.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'repair-head\n' };
      return { stdout: '' };
    });
    const remoteGit = vi.fn(async () => ({ kind: 'executed' as const, targets: [] }));
    const publisher = makeProductionRepairPublisher({
      cwd: root,
      implementationPr: PR,
      slug: 'feature',
      runGh: vi.fn(async () => {
        throw new Error('no remote repair branch');
      }),
      runGit,
      evaluateEvidence: vi.fn(),
      repo: 'acme/rocket',
      remoteGit,
    });
    return { publisher, gitCalls, remoteGit };
  }

  it('builds and pushes the repair commit in a removed temporary worktree', async () => {
    const root = await rootCheckout();
    const { publisher, gitCalls, remoteGit } = publisherFixture(root, null);

    await publisher.ensureRepairBranch({ branch: 'shipment-repair/42/feature', base: 'main' });
    await expect(publisher.commitRecordOnly({
      branch: 'shipment-repair/42/feature',
      writes: [{ path: '.docs/shipped/feature.md', content: MINIMAL_RECORD }],
    })).resolves.toEqual({ headSha: 'repair-head' });

    const rootCalls = gitCalls.filter(({ cwd }) => cwd === root).map(({ args }) => args[0]);
    expect(new Set(rootCalls)).toEqual(new Set(['fetch', 'ls-tree', 'worktree']));
    expect(await readdir(root)).toEqual([]);
    const added = gitCalls.find(({ args }) => args[0] === 'worktree' && args[1] === 'add');
    const worktree = added?.args[3] ?? '';
    expect(added?.args).toEqual(['worktree', 'add', '--detach', worktree, 'origin/main']);
    expect(gitCalls.filter(({ args }) => args[0] === 'commit').map(({ cwd }) => cwd)).toEqual([worktree]);
    expect(remoteGit).toHaveBeenCalledWith(
      ['push', 'origin', 'HEAD:refs/heads/shipment-repair/42/feature'],
      expect.objectContaining({ cwd: worktree }),
    );
    expect(gitCalls.at(-1)).toEqual({ args: ['worktree', 'remove', '--force', worktree], cwd: root });
    await expect(access(worktree)).rejects.toThrow();
  });

  it('refuses to replace a richer existing record with the minimal repair record', async () => {
    const root = await rootCheckout();
    const { publisher, gitCalls, remoteGit } = publisherFixture(root, RICH_RECORD);

    await publisher.ensureRepairBranch({ branch: 'shipment-repair/42/feature', base: 'main' });
    await expect(publisher.commitRecordOnly({
      branch: 'shipment-repair/42/feature',
      writes: [{ path: '.docs/shipped/feature.md', content: MINIMAL_RECORD }],
    })).rejects.toThrow(/repair would drop engine_version:, ## Cost, ## Time/);

    expect(gitCalls.some(({ args }) => ['worktree', 'add', 'commit'].includes(args[0]!))).toBe(false);
    expect(remoteGit).not.toHaveBeenCalled();
  });
});

describe('shippedRecordContentDroppedBy', () => {
  it('names every frontmatter key and heading the replacement would drop', () => {
    expect(shippedRecordContentDroppedBy(RICH_RECORD, MINIMAL_RECORD)).toEqual(['engine_version:', '## Cost', '## Time']);
  });

  it('allows a replacement that keeps the existing record shape', () => {
    expect(shippedRecordContentDroppedBy(MINIMAL_RECORD, MINIMAL_RECORD)).toEqual([]);
    expect(shippedRecordContentDroppedBy(MINIMAL_RECORD, RICH_RECORD)).toEqual([]);
  });
});
