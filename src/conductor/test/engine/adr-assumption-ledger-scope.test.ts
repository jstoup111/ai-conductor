// Covers: task:5, S3.3, S3.4, S4.2, S4.3, S4.4
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';
import { evaluateAdrAssumptionLedgers } from '../../src/engine/adr-assumption-ledger-scope.js';

let repo: string;

async function write(relativePath: string, contents: string): Promise<void> {
  const path = join(repo, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

async function git(...args: string[]): Promise<void> {
  const { execa } = await import('execa');
  await execa('git', args, { cwd: repo });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'adr-assumption-ledger-scope-'));
  await initTestRepo(repo);
  await write('.docs/decisions/adr-2026-01-01-legacy.md', '# ADR: Legacy\n\n**Status:** APPROVED\n');
  await write('.docs/decisions/adr-2026-01-02-untouched.md', '# ADR: Untouched\n\n**Status:** APPROVED\n');
  await commitAll(repo, 'base ADRs');
  await git('checkout', '-b', 'feature');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('evaluateAdrAssumptionLedgers', () => {
  it('does not require a ledger when a pre-existing ADR without one changes status', async () => {
    await write('.docs/decisions/adr-2026-01-01-legacy.md', '# ADR: Legacy\n\n**Status:** SUPERSEDED by ADR-2\n');
    await commitAll(repo, 'supersede legacy ADR');

    await expect(evaluateAdrAssumptionLedgers({ worktreePath: repo, baseRef: 'main' })).resolves.toEqual({
      kind: 'evaluated',
      failures: [],
    });
  });

  it('does not parse untouched pre-existing ADRs when every ADR is in the merge-base tree', async () => {
    await expect(evaluateAdrAssumptionLedgers({ worktreePath: repo, baseRef: 'main' })).resolves.toEqual({
      kind: 'evaluated',
      failures: [],
    });
  });

  it('reports an uncommitted added ADR that lacks an assumptions section', async () => {
    await write('.docs/decisions/adr-2026-01-03-added.md', '# ADR: Added\n\n**Status:** APPROVED\n');

    const result = await evaluateAdrAssumptionLedgers({ worktreePath: repo, baseRef: 'main' });

    expect(result).toMatchObject({
      kind: 'evaluated',
      failures: [{
        path: '.docs/decisions/adr-2026-01-03-added.md',
        diagnostics: [{ rule: 'missing-section' }],
      }],
    });
  });

  it('falls back to local main when origin/main is absent', async () => {
    await write('.docs/decisions/adr-2026-01-04-valid.md', `# ADR: Added\n\n## Assumptions\n\nNo load-bearing assumptions.\n`);
    await commitAll(repo, 'add valid ADR');

    await expect(evaluateAdrAssumptionLedgers({ worktreePath: repo, baseRef: 'main' })).resolves.toEqual({
      kind: 'evaluated',
      failures: [],
    });
  });

  it('fails closed when no merge base can be resolved', async () => {
    await git('checkout', '--orphan', 'unrelated-feature');
    await commitAll(repo, 'unrelated history');

    const result = await evaluateAdrAssumptionLedgers({ worktreePath: repo, baseRef: 'main' });

    expect(result.kind).toBe('merge-base-unresolved');
    if (result.kind === 'merge-base-unresolved') {
      expect(result.detail).toMatch(/merge base could not be resolved/i);
    }
  });
});
