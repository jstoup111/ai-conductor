// Covers: task:11
import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { resolveMachineOperatorIdentity } from '../../src/engine/cli-operator-authority.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { createConductStateLease } from '../../src/engine/conduct-state-lease.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

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
        await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
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

  it('refuses and retains the pending adjustment while the authorization event writer is held', async () => {
    const fixture = await makeFeature({
      version: 1, gates: { build_review: { ...baseEntry, capEvidence, pendingAdjustment: pending } },
    });
    const eventPath = join(fixture.worktree, '.pipeline', 'pipeline-events.jsonl');
    const acquired = await createConductStateLease(eventPath, { label: 'kickback-budget-authorization-events' }).acquire();
    if (!acquired.ok) throw new Error(acquired.message);
    try {
      expect(await inspect(fixture)).toBe(1);
      const entry = (await readLedger(fixture.worktree)).gates.build_review;
      expect(entry.pendingAdjustment.id).toBe('adj-1');
      expect(entry.effectiveLimit).toBeUndefined();
      expect(entry.cumulative).toBe(1);
    } finally {
      await acquired.handle.release();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

// Covers: task:15 — the recovery-eligible halt class is per gate. The two
// remediation-append cap terminals write `kickback-cap` (adr-2026-08-25 D4,
// preserved by the 2026-09-05 amendment scoping D1 to build_review), so a
// command that accepted only `needs-human` made their recovery unreachable.
describe('kickback-budget accepts each gate\'s own cap halt class', () => {
  const remediationLedger = (gate: string) => ({
    version: 1,
    gates: {
      [gate]: {
        ...baseEntry, laps: 1,
        capEvidence: { gate, consumed: 1, limit: 1, latestReason: 'lap cap reached (1/1)', haltGeneration: 'halt-1' },
      },
    },
  });

  const raise = async (fixture: { root: string }, gate: string): Promise<number> =>
    dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate, by: 1, rationale: 'one more lap', format: 'human' },
      {
        cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive: () => true,
        resolveOperator: () => 'operator', print: () => {}, appendEvent: () => {},
      },
    );

  it.each(['prd_audit', 'architecture_review_as_built'])(
    'authorizes a raise on %s behind a kickback-cap halt',
    async (gate) => {
      const fixture = await makeFeature(remediationLedger(gate));
      try {
        await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
        await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'kickback-cap');
        expect(await raise(fixture, gate)).toBe(0);
        const entry = JSON.parse(await readFile(join(fixture.worktree, '.pipeline', 'kickback-ledger.json'), 'utf8')).gates[gate];
        expect(entry.effectiveLapCap).toBe(2);
        expect(entry.laps).toBe(1);
        expect(entry.resumeAuthorization.consumed).toBe(false);
      } finally { await rm(fixture.root, { recursive: true, force: true }); }
    },
  );

  it('still refuses a remediation gate whose live halt is needs-human', async () => {
    const fixture = await makeFeature(remediationLedger('prd_audit'));
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'needs-human');
      await expectRefusalIsInert(fixture, { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'prd_audit', by: 1, rationale: 'evidence', format: 'human' }, 1);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('still refuses build_review behind a kickback-cap halt', async () => {
    const fixture = await makeFeature({
      version: 1,
      gates: { build_review: { ...baseEntry, capEvidence: { gate: 'build_review', consumed: 6, limit: 5, latestReason: 'cap', haltGeneration: 'halt-1' } } },
    });
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'kickback-cap');
      await expectRefusalIsInert(fixture, { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1, rationale: 'evidence', format: 'human' }, 1);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});

// Covers: task:11 — D3 authority contract: machine-scoped identity through the
// approved user-config → GitHub chain, a bounded rationale, and one shared
// named-worktree resolution rather than a per-command copy.
describe('kickback-budget operator authority', () => {
  const capEvidence = { gate: 'build_review', consumed: 6, limit: 5, latestReason: 'cap', haltGeneration: 'halt-1' };
  const halted = async (): Promise<{ root: string; worktree: string }> => {
    const fixture = await makeFeature({ version: 1, gates: { build_review: { ...baseEntry, cumulative: 6, capEvidence } } });
    await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
    await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'needs-human');
    return fixture;
  };

  it('never accepts GITHUB_ACTOR as the operator identity', async () => {
    const fixture = await halted();
    const previous = process.env.GITHUB_ACTOR;
    process.env.GITHUB_ACTOR = 'some-ci-robot';
    try {
      const output: string[] = [];
      const ghCalls: string[][] = [];
      const gh: GhRunner = async (args) => {
        ghCalls.push(args);
        return { stdout: '' };
      };
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1, rationale: 'evidence', format: 'human' },
        {
          cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive: () => true,
          print: (line) => output.push(line), appendEvent: () => {},
          resolveOperator: () => resolveMachineOperatorIdentity(fixture.root, {
            readUser: async () => ({ config: {} }), gh,
          }),
        },
      )).toBe(1);
      expect(ghCalls).toEqual([['api', 'user', '--jq', '.login']]);
      expect(output.join('\n')).toContain('no approved operator identity is available');
      const entry = JSON.parse(await readFile(join(fixture.worktree, '.pipeline', 'kickback-ledger.json'), 'utf8')).gates.build_review;
      expect(entry.effectiveLimit).toBeUndefined();
      expect(entry.adjustments).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.GITHUB_ACTOR; else process.env.GITHUB_ACTOR = previous;
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it('uses only the approved user-config to GitHub identity chain', async () => {
    const previous = process.env.GITHUB_ACTOR;
    process.env.GITHUB_ACTOR = 'some-ci-robot';
    try {
      const unauthenticatedCalls: string[][] = [];
      const unauthenticatedGh: GhRunner = async (args) => {
        unauthenticatedCalls.push(args);
        return { stdout: '' };
      };
      expect(await resolveMachineOperatorIdentity('/fixture', {
        readUser: async () => ({ config: {} }), gh: unauthenticatedGh,
      })).toBeUndefined();
      expect(unauthenticatedCalls).toEqual([['api', 'user', '--jq', '.login']]);

      let configuredGhConsulted = false;
      const configuredGh: GhRunner = async () => {
        configuredGhConsulted = true;
        return { stdout: 'some-ci-robot' };
      };
      expect(await resolveMachineOperatorIdentity('/fixture', {
        readUser: async () => ({ config: { spec_owner: 'approved-operator' } }), gh: configuredGh,
      })).toBe('approved-operator');
      expect(configuredGhConsulted).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_ACTOR; else process.env.GITHUB_ACTOR = previous;
    }
  });

  it('refuses a rationale beyond the durable bound before touching the park or ledger', async () => {
    const { MAX_OPERATOR_RATIONALE_BYTES } = await import('../../src/engine/cli-operator-authority.js');
    const fixture = await halted();
    try {
      await expectRefusalIsInert(
        fixture,
        {
          kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1,
          rationale: 'x'.repeat(MAX_OPERATOR_RATIONALE_BYTES + 1), format: 'human',
        },
        2,
      );
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('accepts a rationale exactly at the bound', async () => {
    const { MAX_OPERATOR_RATIONALE_BYTES } = await import('../../src/engine/cli-operator-authority.js');
    const fixture = await halted();
    try {
      expect(await dispatchKickbackBudgetCommand(
        {
          kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1,
          rationale: 'y'.repeat(MAX_OPERATOR_RATIONALE_BYTES), format: 'human',
        },
        {
          cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive: () => true,
          resolveOperator: () => 'operator', print: () => {}, appendEvent: () => {},
        },
      )).toBe(0);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('resolves the feature worktree through the shared resolver, which rejects a non-directory', async () => {
    const { resolveCliFeatureWorktree } = await import('../../src/engine/cli-operator-authority.js');
    const root = await mkdtemp(join(tmpdir(), 'kickback-budget-shared-resolve-'));
    try {
      await mkdir(join(root, '.worktrees'), { recursive: true });
      await writeFile(join(root, '.worktrees', 'not-a-dir'), 'file');
      expect(await resolveCliFeatureWorktree('not-a-dir', { cwd: root, resolveMainRoot: async () => root })).toBeUndefined();
      expect(await resolveCliFeatureWorktree('absent', { cwd: root, resolveMainRoot: async () => root })).toBeUndefined();
      await mkdir(join(root, '.worktrees', 'real'), { recursive: true });
      expect(await resolveCliFeatureWorktree('real', { cwd: root, resolveMainRoot: async () => root })).toContain('real');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

// Covers: task:7 — adr-2026-08-31 decision 3: one malformed gate never
// invalidates a healthy sibling gate's operations.
describe('kickback-budget scopes an invalid gate entry to its own gate', () => {
  const healthy = { ...baseEntry, cumulative: 6, capEvidence: { gate: 'build_review', consumed: 6, limit: 5, latestReason: 'cap', haltGeneration: 'halt-1' } };
  const mixed = { version: 1, gates: { build_review: healthy, prd_audit: { count: 'not-a-number' } } };

  it('inspect renders the healthy gate and reports only the malformed one unavailable', async () => {
    const fixture = await makeFeature(mixed);
    try {
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
        { cwd: fixture.root, resolveMainRoot: async () => fixture.root, print: (line) => output.push(line) },
      )).toBe(1);
      const parsed = JSON.parse(output[0]) as { gates: Array<{ gate: string }>; unavailableGates: string[] };
      expect(parsed.unavailableGates).toEqual(['prd_audit']);
      expect(parsed.gates.map((view) => view.gate)).toContain('build_review');
      expect(parsed.gates.map((view) => view.gate)).not.toContain('prd_audit');
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('still authorizes a raise on the healthy gate', async () => {
    const fixture = await makeFeature(mixed);
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'needs-human');
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'build_review', by: 1, rationale: 'one more lap', format: 'human' },
        {
          cwd: fixture.root, resolveMainRoot: async () => fixture.root, isInteractive: () => true,
          resolveOperator: () => 'operator', print: () => {}, appendEvent: () => {},
        },
      )).toBe(0);
      const stored = JSON.parse(await readFile(join(fixture.worktree, '.pipeline', 'kickback-ledger.json'), 'utf8'));
      expect(stored.gates.build_review.effectiveLimit).toBe(6);
      // Never repaired, defaulted, or inferred (decision 4).
      expect(stored.gates.prd_audit).toEqual({ count: 'not-a-number' });
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });

  it('still refuses a mutation naming the malformed gate', async () => {
    const fixture = await makeFeature(mixed);
    try {
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT'), 'halted\nKickback halt generation: halt-1');
      await writeFile(join(fixture.worktree, '.pipeline', 'HALT.class'), 'kickback-cap');
      await expectRefusalIsInert(fixture, { kind: 'kickback-budget', action: 'raise', feature: 'feature', gate: 'prd_audit', by: 1, rationale: 'evidence', format: 'human' }, 1);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});
