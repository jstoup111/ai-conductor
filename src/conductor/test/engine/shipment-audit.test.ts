// Covers: task:13, task:19, task:rem-as-built-R16, task:rem-as-built-rem-v3-audit-child-exclusion
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { runShipmentAudit } from '../../src/engine/shipment-audit.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCb);

async function commitAll(cwd: string, message: string): Promise<string> {
  await execFile('git', ['add', '-A'], { cwd });
  await execFile('git', ['commit', '-m', message], { cwd });
  return (await execFile('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
}

async function realGit(args: string[], { cwd }: { cwd: string }) {
  try {
    const { stdout } = await execFile('git', args, { cwd });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; code?: number };
    return { stdout: result.stdout ?? '', exitCode: result.code ?? 1 };
  }
}

function mergedPlanPr(slug: string, headSha: string) {
  return vi.fn(async (args: string[]) => {
    if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
    return { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [{
      number: 500,
      url: 'https://github.com/acme/conductor/pull/500',
      body: `Plan: .docs/plans/${slug}.md`,
      mergedAt: '2026-10-19T00:00:00Z',
      headRefOid: headSha,
      headRefName: `feat/${slug}`,
      files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } } }) };
  });
}

describe('shipment audit', () => {
  it('keeps a shipped plan aligned after its docs-prune deletion', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-pruned-plan-'));
    const slug = 'alpha';
    try {
      await initTestRepo(cwd);
      await mkdir(join(cwd, '.docs/plans'), { recursive: true });
      await writeFile(join(cwd, `.docs/plans/${slug}.md`), '# Alpha\n');
      const implementationHead = await commitAll(cwd, 'feat: add plan');
      await mkdir(join(cwd, '.docs/shipped'), { recursive: true });
      await writeFile(join(cwd, `.docs/shipped/${slug}.md`), 'record\n');
      await commitAll(cwd, 'docs: add shipped record');
      const beforeGit = vi.fn(realGit);
      const before = await runShipmentAudit({
        cwd, runGit: beforeGit, runGh: mergedPlanPr(slug, implementationHead),
        evaluateEvidence: async () => ({ kind: 'valid', slug, pr: 'https://github.com/acme/conductor/pull/500', recordPath: `.docs/shipped/${slug}.md`, hash: 'hash', commit: implementationHead }),
      });

      await execFile('git', ['rm', `.docs/plans/${slug}.md`], { cwd });
      await execFile('git', ['commit', '-m', 'docs: prune alpha plan'], { cwd });
      const after = await runShipmentAudit({
        cwd, runGit: realGit, runGh: mergedPlanPr(slug, implementationHead),
        evaluateEvidence: async () => ({ kind: 'valid', slug, pr: 'https://github.com/acme/conductor/pull/500', recordPath: `.docs/shipped/${slug}.md`, hash: 'hash', commit: implementationHead }),
      });

      expect([before.rows[0]?.classification, after.rows[0]?.classification]).toEqual(['aligned', 'aligned']);
      expect(beforeGit.mock.calls.some(([args]) => args.includes('--diff-filter=D'))).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('marks unreachable or unreadable pruned plans unresolved without leaving other rows unclassified', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-unresolved-pruned-plan-'));
    try {
      await initTestRepo(cwd);
      await mkdir(join(cwd, '.docs/plans'), { recursive: true });
      await writeFile(join(cwd, '.docs/plans/reachable.md'), '# reachable\n');
      await commitAll(cwd, 'feat: reachable plan');
      await execFile('git', ['checkout', '-b', 'unmerged'], { cwd });
      await writeFile(join(cwd, '.docs/plans/unmerged.md'), '# unmerged\n');
      await commitAll(cwd, 'feat: unmerged plan');
      await execFile('git', ['checkout', 'main'], { cwd });
      const runGit = vi.fn(realGit);
      const report = await runShipmentAudit({ cwd, runGit, runGh: vi.fn(async (args: string[]) => args[0] === 'repo'
        ? { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) }
        : { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }) }) });
      expect(report.rows.find((row) => row.sourcePath.endsWith('unmerged.md'))).toMatchObject({ classification: 'unresolved', reason: 'shipment-plan-pruned' });
      expect(report.rows.every((row) => row.classification !== undefined)).toBe(true);

      const failedHistory = vi.fn(async (args: string[], opts: { cwd: string }) => {
        if (args[0] === 'log' && args.includes('--diff-filter=D')) throw new Error('history failed');
        return realGit(args, opts);
      });
      const failed = await runShipmentAudit({ cwd, runGit: failedHistory, runGh: vi.fn(async (args: string[]) => args[0] === 'repo'
        ? { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) }
        : { stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }) }) });
      expect(failed.rows.find((row) => row.sourcePath.endsWith('unmerged.md'))).toMatchObject({ classification: 'unresolved', reason: 'shipment-plan-pruned' });
      expect(failed.rows.every((row) => row.classification !== undefined)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
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

  it('excludes a plan-bearing child from deciding plan absence', async () => {
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
        reason: 'no exact associated merged implementation PR',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('ignores a plan-bearing child before selecting the shipped leaf candidate', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-child-before-leaf-'));
    const runGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
      return {
        stdout: JSON.stringify({
          data: { repository: { pullRequests: { nodes: [
            {
              number: 503, url: 'https://github.com/acme/conductor/pull/503',
              body: 'Plan: `.docs/plans/demo.md`', mergedAt: '2026-10-19T00:00:00Z',
              headRefOid: 'b'.repeat(40), headRefName: 'feat/c3/demo',
              files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
            },
            {
              number: 500, url: 'https://github.com/acme/conductor/pull/500',
              body: 'Plan: `.docs/plans/demo.md`', mergedAt: '2026-10-20T00:00:00Z',
              headRefOid: 'a'.repeat(40), headRefName: 'feat/daemon-demo',
              files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          ], pageInfo: { hasNextPage: false, endCursor: null } } } },
        }),
      };
    });
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'log' && args.includes('--all')) return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'audit-head\n' };
      if (args[0] === 'ls-tree') return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'show') return { stdout: '# Demo\n' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    try {
      const report = await runShipmentAudit({
        cwd, runGh, runGit,
        evaluateEvidence: async () => ({
          kind: 'valid',
          slug: 'demo',
          pr: 'https://github.com/acme/conductor/pull/500',
          recordPath: '.docs/shipped/demo.md',
          hash: 'a'.repeat(64),
          commit: 'a'.repeat(40),
        }),
      });

      expect(report.rows[0]).toMatchObject({
        classification: 'aligned',
        implementationPr: { number: 500, url: 'https://github.com/acme/conductor/pull/500' },
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('excludes a plan-bearing child before classifying two leaf candidates as ambiguous', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'shipment-audit-child-before-ambiguous-leaves-'));
    const runGh = vi.fn(async (args: string[]) => {
      if (args[0] === 'repo') return { stdout: JSON.stringify({ nameWithOwner: 'acme/conductor' }) };
      return {
        stdout: JSON.stringify({
          data: { repository: { pullRequests: { nodes: [
            {
              number: 503, url: 'https://github.com/acme/conductor/pull/503',
              body: 'Plan: `.docs/plans/demo.md`', mergedAt: '2026-10-19T00:00:00Z',
              headRefOid: 'b'.repeat(40), headRefName: 'feat/c3/demo',
              files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
            },
            {
              number: 500, url: 'https://github.com/acme/conductor/pull/500',
              body: 'Plan: `.docs/plans/demo.md`', mergedAt: '2026-10-20T00:00:00Z',
              headRefOid: 'a'.repeat(40), headRefName: 'feat/daemon-demo',
              files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
            },
            {
              number: 501, url: 'https://github.com/acme/conductor/pull/501',
              body: 'Plan: `.docs/plans/demo.md`', mergedAt: '2026-10-21T00:00:00Z',
              headRefOid: 'c'.repeat(40), headRefName: 'feat/daemon-demo-alternate',
              files: { nodes: [{ path: 'src/conductor/src/engine/demo.ts' }], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          ], pageInfo: { hasNextPage: false, endCursor: null } } } },
        }),
      };
    });
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'log' && args.includes('--all')) return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'rev-parse') return { stdout: 'audit-head\n' };
      if (args[0] === 'ls-tree') return { stdout: '.docs/plans/demo.md\n' };
      if (args[0] === 'show') return { stdout: '# Demo\n' };
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    });

    try {
      const report = await runShipmentAudit({ cwd, runGh, runGit });

      expect(report.rows[0]).toMatchObject({
        classification: 'ambiguous',
        reason: 'multiple exact associated merged implementation PRs',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
