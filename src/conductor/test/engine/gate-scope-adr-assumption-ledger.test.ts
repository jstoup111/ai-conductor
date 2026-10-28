// Covers: task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';
import { GATE_ONLY_PREDICATES } from '../../src/engine/artifacts.js';

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

function validAdr(name: string): string {
  return `# ADR: ${name}\n\n**Status:** APPROVED\n\n## Assumptions\n\nNo load-bearing assumptions.\n`;
}

async function architectureReview() {
  const predicate = GATE_ONLY_PREDICATES.architecture_review;
  expect(predicate).toBeDefined();
  return predicate!(repo, {});
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'gate-scope-adr-assumption-ledger-'));
  await initTestRepo(repo);
  await write('.docs/decisions/adr-2026-01-01-legacy.md', '# ADR: Legacy\n\n**Status:** APPROVED\n');
  await commitAll(repo, 'base ADR');
  await git('checkout', '-b', 'feature');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('architecture_review assumption-ledger gate scope', () => {
  it.each([
    ['committed', true],
    ['uncommitted', false],
  ])('accepts a valid added ADR when %s', async (_state, committed) => {
    await write('.docs/decisions/adr-2026-01-02-valid.md', validAdr('Valid'));
    if (committed) await commitAll(repo, 'add valid ADR');

    await expect(architectureReview()).resolves.toEqual({ done: true });
  });

  it('does not read unledgered ADRs that all already exist at the merge base', async () => {
    await expect(architectureReview()).resolves.toEqual({ done: true });
  });

  it('rejects an uncommitted added ADR without an assumptions section', async () => {
    await write('.docs/decisions/adr-2026-01-02-missing.md', '# ADR: Missing\n\n**Status:** APPROVED\n');

    const result = await architectureReview();

    expect(result.done).toBe(false);
    expect(result.reason).toContain('.docs/decisions/adr-2026-01-02-missing.md');
    expect(result.reason).toContain('missing-section');
  });

  it('falls back to local main when origin/main is absent', async () => {
    await write('.docs/decisions/adr-2026-01-02-valid.md', validAdr('Valid'));
    await commitAll(repo, 'add valid ADR');

    await expect(architectureReview()).resolves.toEqual({ done: true });
  });

  it('fails closed when no merge base can be resolved', async () => {
    await git('checkout', '--orphan', 'unrelated-feature');
    await commitAll(repo, 'unrelated history');

    const result = await architectureReview();

    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/merge base could not be resolved/i);
  });
});
