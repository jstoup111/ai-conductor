import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runShipmentAudit } from '../../src/engine/shipment-audit.js';

describe('shipment audit', () => {
  it('selects a merged PR head ref and leaves a missing one unclassified', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-head-ref-'));
    const runGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
      const query = args.find((argument) => argument.startsWith('query='));
      expect(query).toContain('headRefName');
      return {
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [{
                  number: 500,
                  url: 'https://github.com/acme/conductor/pull/500',
                  body: 'Plan: `.docs/plans/demo.md`',
                  mergedAt: '2026-10-19T00:00:00Z',
                  headRefOid: 'a'.repeat(40),
                  files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      };
    });
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'log' && args.includes('--all')) return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'audit-head\n' };
      if (args[0] === 'ls-tree') {
        const target = args.at(-1);
        if (args.includes('.docs/plans') || target === '.docs/plans/demo.md') {
          return { stdout: '.docs/plans/demo.md\n' };
        }
        return { stdout: '' };
      }
      if (args[0] === 'show') return { stdout: '# Demo\n' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    try {
      const report = await runShipmentAudit({ cwd, runGh, runGit });

      expect(report.rows).toEqual([{
        sourcePath: '.docs/plans/demo.md',
        sourceKind: 'plan',
        plan: { path: '.docs/plans/demo.md', slug: 'demo' },
        classification: 'unresolved',
        reason: 'merged PR #500 is unclassified: head ref is unavailable',
      }]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reports a plan-bearing child as stack-child instead of a repair candidate', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-stack-child-'));
    const runGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
      return {
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [{
                  number: 503,
                  url: 'https://github.com/acme/conductor/pull/503',
                  body: 'Plan: `.docs/plans/demo.md`',
                  mergedAt: '2026-10-19T00:00:00Z',
                  headRefOid: 'b'.repeat(40),
                  headRefName: 'feat/c3/demo',
                  files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      };
    });
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'log' && args.includes('--all')) return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'audit-head\n' };
      if (args[0] === 'ls-tree') {
        const target = args.at(-1);
        if (args.includes('.docs/plans') || target === '.docs/plans/demo.md') {
          return { stdout: '.docs/plans/demo.md\n' };
        }
        return { stdout: '' };
      }
      if (args[0] === 'show') return { stdout: '# Demo\n' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    try {
      const report = await runShipmentAudit({ cwd, runGh, runGit });

      expect(report.rows[0]).toMatchObject({
        classification: 'absent',
        reason: 'merged PR #503 is not applicable (stack-child)',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
