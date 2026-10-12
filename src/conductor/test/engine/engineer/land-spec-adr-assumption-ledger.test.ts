// Covers: task:6
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';

const execFile = promisify(execFileCb);
let repoPath: string;

const CITABLE_DECISION = '## Decision\n\n1. **Keep this decision citable.**\n';
const VALID_LEDGER = [
  '## Assumptions',
  '',
  '| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| A1 | The local evidence is sufficient. | verified | 100% | yes | The land gate could accept invalid ADRs. | — |',
].join('\n');

function approvedAdr(ledger: string): string {
  return ['# ADR: ledger contract', '', '**Status:** Approved', '', CITABLE_DECISION, ledger, ''].join('\n');
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

function options() {
  return {
    ownerConfig: { spec_owner: 'test-owner' },
    renderDeps: {
      hasTool: async () => true,
      writeTemp: async () => '/tmp/land-spec-adr-assumption-ledger.mmd',
      runMmdc: async () => ({ ok: true }),
    },
  };
}

async function seedWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, 'ledger landing');
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'ledger-landing.md'), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'ledger-landing.md'), [
    '# Stories', '', '**Status:** Accepted', '', '## Story 1: land', '### Acceptance Criteria',
    '#### Happy Path', '- Given valid artifacts, when land runs, then it commits.', '',
    '#### Negative Paths', '- Given invalid artifacts, when land runs, then it refuses.', '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs', 'plans', 'ledger-landing.md'), [
    '# Implementation Plan', '', '**Stories:** .docs/stories/ledger-landing.md', '',
    '### Task 1: Land', '**Story:** Story 1', '', '**Done when:**',
    '- Given valid artifacts, when land runs, then it commits.',
    '- Given invalid artifacts, when land runs, then it refuses.', '',
    '## Coverage Check', '', '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    '| Story 1 happy: Given valid artifacts, when land runs, then it commits. | 1 | "Given valid artifacts, when land runs, then it commits." | diff-local |',
    '| Story 1 negative: Given invalid artifacts, when land runs, then it refuses. | 1 | "Given invalid artifacts, when land runs, then it refuses." | diff-local |', '',
  ].join('\n'));
  return worktreePath;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-adr-assumption-ledger-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

describe('landSpec ADR assumption-ledger gate', () => {
  it('lands added valid and explicit-empty ADR ledgers, and ignores legacy ADRs without a ledger', async () => {
    await mkdir(join(repoPath, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'decisions', 'adr-legacy.md'), approvedAdr(''));
    await git(['add', '.docs/decisions']);
    await git(['commit', '-m', 'add legacy ADR']);

    const worktreePath = await seedWorktree();
    await Promise.all([
      writeFile(join(worktreePath, '.docs', 'decisions', 'adr-2026-10-10-valid.md'), approvedAdr(VALID_LEDGER)),
      writeFile(join(worktreePath, '.docs', 'decisions', 'adr-2026-10-10-empty.md'), approvedAdr('## Assumptions\n\nNo load-bearing assumptions.')),
    ]);

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, 'ledger landing', worktreePath, undefined, options()))
      .resolves.toMatchObject({ slug: 'ledger-landing' });
  });

  it('refuses all invalid added ADR ledgers before creating a land commit', async () => {
    const worktreePath = await seedWorktree();
    const missing = join(worktreePath, '.docs', 'decisions', 'adr-2026-10-10-missing.md');
    const approval = join(worktreePath, '.docs', 'decisions', 'adr-2026-10-10-approval.md');
    await mkdir(join(worktreePath, '.docs', 'decisions'), { recursive: true });
    await Promise.all([
      writeFile(missing, approvedAdr('')),
      writeFile(approval, approvedAdr([
        '## Assumptions', '',
        '| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| A2 | This is inferred. | inferred | 80% | yes | The gate could be wrong. | — |',
      ].join('\n'))),
    ]);
    const head = await git(['rev-parse', 'HEAD'], worktreePath);

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, 'ledger landing', worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'adr-assumption-ledger' });
    expect((error as Error).message).toMatch(/missing\.md[\s\S]*missing-section/);
    expect((error as Error).message).toMatch(/approval\.md[\s\S]*missing-approval[\s\S]*A2/);
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(head);
  });

  it('refuses a changed opted-in ADR with a malformed row', async () => {
    await mkdir(join(repoPath, '.docs', 'decisions'), { recursive: true });
    const adrPath = join(repoPath, '.docs', 'decisions', 'adr-legacy.md');
    await writeFile(adrPath, approvedAdr(VALID_LEDGER));
    await git(['add', '.docs/decisions']);
    await git(['commit', '-m', 'add opted-in ADR']);

    const worktreePath = await seedWorktree();
    await writeFile(join(worktreePath, '.docs', 'decisions', 'adr-legacy.md'), approvedAdr(VALID_LEDGER.replace('A1', 'A5').replace('verified', 'guessed')));
    await git(['add', '.docs/decisions/adr-legacy.md'], worktreePath);
    await git(['commit', '-m', 'malform ledger row'], worktreePath);

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, 'ledger landing', worktreePath, undefined, options()))
      .rejects.toMatchObject({ gate: 'adr-assumption-ledger', message: expect.stringMatching(/adr-legacy\.md[\s\S]*A5/) });
  });
});
