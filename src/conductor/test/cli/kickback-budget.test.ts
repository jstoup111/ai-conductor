// Covers: task:11
import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';

const execFileP = promisify(execFile);
const baseEntry = { count: 1, cumulative: 1, treeHash: null, lastReason: 'cap', priorVerdict: true, resolvedBefore: 0 };

async function makeFeature(ledger: unknown): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kickback-budget-cli-'));
  const worktree = join(root, '.worktrees', 'feature');
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, '.pipeline', 'kickback-ledger.json'), typeof ledger === 'string' ? ledger : JSON.stringify(ledger));
  return { root, worktree };
}

async function expectRefusalIsInert(
  fixture: { root: string; worktree: string },
  command: Parameters<typeof dispatchKickbackBudgetCommand>[0],
  expectedCode: number,
): Promise<void> {
  const ledgerPath = join(fixture.worktree, '.pipeline', 'kickback-ledger.json');
  const before = await readFile(ledgerPath);
  expect(await dispatchKickbackBudgetCommand(command, {
    cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive: () => true,
    resolveOperator: () => 'operator', print: () => {},
  })).toBe(expectedCode);
  await expect(access(join(fixture.root, '.daemon', 'parked', 'feature'))).rejects.toThrow();
  await expect(access(`${ledgerPath}.lease`)).rejects.toThrow();
  expect(await readFile(ledgerPath)).toEqual(before);
}

describe('detectKickbackBudgetCommand', () => {
  it('accepts the three supported command shapes', () => {
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'inspect', '--feature', 'feature', '--format', 'json']))
      .toEqual({ kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' });
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '2', '--rationale', 'evidence']))
      .toMatchObject({ action: 'raise', feature: 'feature', gate: 'build_review', by: 2, rationale: 'evidence' });
    expect(detectKickbackBudgetCommand(['node', 'conduct', 'kickback-budget', 'reset', '--feature', 'feature', '--gate', 'prd_audit', '--rationale', 'fresh review']))
      .toMatchObject({ action: 'reset', feature: 'feature', gate: 'prd_audit', rationale: 'fresh review' });
  });

  it.each([
    ['unknown action', ['node', 'conduct', 'kickback-budget', 'drop', '--feature', 'feature']],
    ['path-like feature', ['node', 'conduct', 'kickback-budget', 'inspect', '--feature', '../feature']],
    ['zero raise', ['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '0', '--rationale', 'why']],
    ['fractional raise', ['node', 'conduct', 'kickback-budget', 'raise', '--feature', 'feature', '--gate', 'build_review', '--by', '1.5', '--rationale', 'why']],
    ['empty rationale', ['node', 'conduct', 'kickback-budget', 'reset', '--feature', 'feature', '--gate', 'build_review', '--rationale', '  ']],
  ])('rejects %s', (_name, argv) => {
    expect(detectKickbackBudgetCommand(argv)).toBeNull();
  });
});

describe('kickback-budget refusal ladder', () => {
  it('refuses unavailable features without creating state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kickback-budget-missing-'));
    try {
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'raise', feature: 'missing', gate: 'build_review', by: 1, rationale: 'evidence', format: 'human' },
        { cwd: root, resolveMainRoot: async () => root, isInteractive: () => true, print: (line) => output.push(line) },
      )).toBe(1);
      expect(output).toEqual(["kickback-budget: feature 'missing' is unavailable."]);
      await expect(access(join(root, '.daemon'))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    ['non-interactive mutation', { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1, rationale: 'evidence', format: 'human' }, 2, (): boolean => false],
    ['unknown gate', { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'unknown', by: 1, rationale: 'evidence', format: 'human' }, 2, (): boolean => true],
    ['blank rationale', { kind: 'kickback-budget', action: 'reset', feature: 'feature', gate: 'build_review', rationale: '  ', format: 'human' }, 2, (): boolean => true],
  ] as const)('keeps %s inert', async (_name, command, code, isInteractive) => {
    const fixture = await makeFeature({ version: 1, gates: { build_review: baseEntry } });
    try {
      const ledgerPath = join(fixture.worktree, '.pipeline', 'kickback-ledger.json');
      const before = await readFile(ledgerPath);
      expect(await dispatchKickbackBudgetCommand(command, { cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive, print: () => {} })).toBe(code);
      await expect(access(join(fixture.root, '.daemon', 'parked', 'feature'))).rejects.toThrow();
      await expect(access(`${ledgerPath}.lease`)).rejects.toThrow();
      expect(await readFile(ledgerPath)).toEqual(before);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ['unreadable ledger', '{corrupt', 1],
    ['missing cap evidence', { version: 1, gates: { build_review: baseEntry } }, 1],
    ['ineligible halt class', { version: 1, gates: { build_review: { ...baseEntry, capEvidence: { gate: 'build_review', consumed: 1, limit: 5, latestReason: 'cap', haltGeneration: 'halt-1' } } } }, 1],
  ] as const)('keeps %s inert', async (name, ledger, code) => {
    const fixture = await makeFeature(ledger);
    try {
      if (name === 'ineligible halt class') {
        await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted');
        await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'mechanical');
      }
      await expectRefusalIsInert(fixture, { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1, rationale: 'evidence', format: 'human' }, code);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('dispatches a pre-boot refusal through the executable without creating daemon state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kickback-budget-preboot-'));
    try {
      const conductorRoot = resolve(import.meta.dirname, '../..');
      const entry = join(conductorRoot, 'src', 'index.ts');
      const tsxLoader = join(conductorRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
      await expect(execFileP(process.execPath, ['--import', tsxLoader, entry, 'kickback-budget', 'inspect', '--feature', 'missing'], { cwd: root }))
        .rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("feature 'missing' is unavailable") });
      await expect(access(join(root, '.daemon'))).rejects.toThrow();
      await expect(access(join(root, 'conduct-state.json'))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
