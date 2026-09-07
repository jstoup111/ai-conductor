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

// Covers: task:14 — reconciliation is a COMMAND-ENTRY obligation. `inspect` is
// the first command an operator reaches for after a crash, so both sealed
// crash-recovery cases must be delivered by it, not only by raise/reset.
describe('kickback-budget inspect reconciles an interrupted adjustment at command entry', () => {
  const capEvidence = { gate: 'build_review', consumed: 1, limit: 5, latestReason: 'cap', haltGeneration: 'halt-1' };
  const pending = {
    id: 'adj-1', kind: 'raise' as const, beforeConsumed: 1, afterConsumed: 1, beforeLimit: 5, afterLimit: 6,
    operator: 'operator', rationale: 'one more lap', timestamp: '2026-09-07T00:00:00.000Z', haltGeneration: 'halt-1',
  };

  const inspect = async (fixture: { root: string }): Promise<number> =>
    dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
      { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: () => {} },
    );

  const readLedger = async (worktree: string): Promise<any> =>
    JSON.parse(await readFile(join(worktree, '.pipeline', 'kickback-ledger.json'), 'utf8'));

  it('discards a pending record whose authorization event never landed', async () => {
    const fixture = await makeFeature({
      version: 1, gates: { build_review: { ...baseEntry, capEvidence, pendingAdjustment: pending } },
    });
    try {
      expect(await inspect(fixture)).toBe(0);
      const entry = (await readLedger(fixture.worktree)).gates.build_review;
      expect(entry.pendingAdjustment).toBeUndefined();
      expect(entry.effectiveLimit).toBeUndefined();
      expect(entry.cumulative).toBe(1);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('completes the apply exactly once when the authorization event exists', async () => {
    const fixture = await makeFeature({
      version: 1, gates: { build_review: { ...baseEntry, capEvidence, pendingAdjustment: pending } },
    });
    try {
      await writeFile(
        join(fixture.worktree, '.pipeline', 'pipeline-events.jsonl'),
        `${JSON.stringify({ type: 'kickback_budget_adjustment_authorized', adjustmentId: 'adj-1' })}\n`,
      );
      expect(await inspect(fixture)).toBe(0);
      const first = (await readLedger(fixture.worktree)).gates.build_review;
      expect(first.pendingAdjustment).toBeUndefined();
      expect(first.effectiveLimit).toBe(6);
      expect(first.adjustments).toHaveLength(1);
      expect(first.cumulative).toBe(1);

      expect(await inspect(fixture)).toBe(0);
      const second = (await readLedger(fixture.worktree)).gates.build_review;
      expect(second.adjustments).toHaveLength(1);
      expect(second.effectiveLimit).toBe(6);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('keeps the pending record and exits non-zero when the event ledger is unreadable', async () => {
    const fixture = await makeFeature({
      version: 1, gates: { build_review: { ...baseEntry, capEvidence, pendingAdjustment: pending } },
    });
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'pipeline-events.jsonl'), '{not json\n');
      expect(await inspect(fixture)).toBe(1);
      expect((await readLedger(fixture.worktree)).gates.build_review.pendingAdjustment.id).toBe('adj-1');
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});
