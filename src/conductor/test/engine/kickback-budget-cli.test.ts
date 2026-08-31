// Covers: task:9, task:10

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectKickbackBudgetCommand } from '../../src/cli.js';
import { dispatchKickbackBudgetInspect } from '../../src/engine/kickback-budget-cli.js';
import type { KickbackLedger } from '../../src/engine/kickback-ledger.js';

const argv = (...arguments_: string[]) => ['node', 'conduct', 'kickback-budget', ...arguments_];

describe('detectKickbackBudgetCommand', () => {
  it('parses human and JSON budget inspection requests', () => {
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'human',
    });
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery', '--format', 'human'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'human',
    });
    expect(detectKickbackBudgetCommand(argv('inspect', '--feature', 'recovery', '--format', 'json'))).toEqual({
      kind: 'inspect', feature: 'recovery', format: 'json',
    });
  });

  it('parses reset and raise requests with bounded rationales', () => {
    expect(detectKickbackBudgetCommand(argv(
      'reset', '--feature', 'recovery', '--rationale', 'The prior review episode is obsolete.',
    ))).toEqual({
      kind: 'reset', feature: 'recovery', rationale: 'The prior review episode is obsolete.',
    });
    expect(detectKickbackBudgetCommand(argv(
      'raise', '--feature', 'recovery', '--by', '3', '--rationale', 'Need three more reviewed attempts.',
    ))).toEqual({
      kind: 'raise', feature: 'recovery', amount: 3, rationale: 'Need three more reviewed attempts.',
    });
  });

  // adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D4 carries
  // forward the approved `raise ... --by` grammar; `--amount` is not that interface.
  it('rejects the unapproved --amount spelling of the raise allowance', () => {
    expect(detectKickbackBudgetCommand(argv(
      'raise', '--feature', 'recovery', '--amount', '3', '--rationale', 'Need three more reviewed attempts.',
    ))).toBeNull();
  });

  it.each([
    ['unknown inspection format', argv('inspect', '--feature', 'recovery', '--format', 'yaml')],
    ['missing inspection feature', argv('inspect')],
    ['missing reset feature', argv('reset', '--rationale', 'reason')],
    ['blank rationale', argv('reset', '--feature', 'recovery', '--rationale', '   ')],
    ['over-limit rationale', argv('reset', '--feature', 'recovery', '--rationale', 'x'.repeat(1001))],
    ['zero amount', argv('raise', '--feature', 'recovery', '--by', '0', '--rationale', 'reason')],
    ['negative amount', argv('raise', '--feature', 'recovery', '--by', '-1', '--rationale', 'reason')],
    ['fractional amount', argv('raise', '--feature', 'recovery', '--by', '1.5', '--rationale', 'reason')],
    ['non-numeric amount', argv('raise', '--feature', 'recovery', '--by', 'three', '--rationale', 'reason')],
    ['unsafe amount', argv('raise', '--feature', 'recovery', '--by', '9007199254740992', '--rationale', 'reason')],
  ])('rejects %s before any command can be dispatched', (_case_, command) => {
    expect(detectKickbackBudgetCommand(command)).toBeNull();
  });
});

const mainRoot = '/main';
const worktree = '/main/.worktrees/recovery';
const feature = { version: 'v1' as const, repository: mainRoot, feature: 'recovery' };

function ledger(overrides: Partial<KickbackLedger['gates']['build_review']> = {}): KickbackLedger {
  return {
    version: 1,
    gates: {
      build_review: {
        count: 2,
        cumulative: 3,
        effectiveLimit: 5,
        mechanicalFaults: 2,
        lastMechanicalFault: {
          rubric: 'testQuality', reason: 'provider-error', detail: 'offline', lapId: 'lap-1',
        },
        adjustments: [
          { id: 'raise-2', kind: 'raise', beforeCount: 0, afterCount: 0, beforeLimit: 6, afterLimit: 8, operator: 'a', rationale: 'later', at: '2026-08-02T00:00:00.000Z' },
          { id: 'reset-1', kind: 'reset', beforeCount: 6, afterCount: 0, beforeLimit: 5, afterLimit: 5, operator: 'b', rationale: 'first', at: '2026-08-01T00:00:00.000Z' },
        ],
        treeHash: null,
        lastReason: 'semantic finding',
        priorVerdict: true,
        resolvedBefore: 0,
        ...overrides,
      },
    },
  };
}

function inspectDeps(readBudgetLedger = async () => ledger()) {
  return {
    cwd: mainRoot,
    resolveMainRoot: async () => mainRoot,
    realpath: async (path: string) => path,
    resolveFeatureIdentity: async () => feature,
    readBudgetLedger,
  };
}

describe('kickback-budget inspect dispatcher', () => {
  it('renders identical canonical fields for human and JSON output while keeping mechanical faults separate', async () => {
    const human = vi.fn();
    const json = vi.fn();
    const deps = inspectDeps();

    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'human' }, { ...deps, print: human })).resolves.toBe(0);
    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'json' }, { ...deps, print: json })).resolves.toBe(0);

    const machine = JSON.parse(json.mock.calls[0]![0]);
    expect(machine).toMatchObject({
      feature: 'recovery', gate: 'build_review', count: 3, limit: 5, remaining: 2,
      exhausted: false, latestReason: 'semantic finding',
      mechanicalFaults: { count: 2, excludedFromSemanticBudget: true },
    });
    for (const [label, value] of [
      ['Feature', machine.feature], ['Gate', machine.gate], ['Count', machine.count], ['Limit', machine.limit],
      ['Remaining', machine.remaining], ['Exhausted', machine.exhausted], ['Latest reason', machine.latestReason],
    ]) expect(human.mock.calls[0]![0]).toContain(`${label}: ${value}`);
    expect(human.mock.calls[0]![0]).toContain('Mechanical faults (excluded from semantic budget): 2');
  });

  it('renders adjustment chronology and legacy unavailable history from the canonical view', async () => {
    const chronological = vi.fn();
    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'json' }, {
      ...inspectDeps(), print: chronological,
    })).resolves.toBe(0);
    expect(JSON.parse(chronological.mock.calls[0]![0]).adjustments.entries.map((entry: { id: string }) => entry.id))
      .toEqual(['reset-1', 'raise-2']);

    const legacy = vi.fn();
    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'human' }, {
      ...inspectDeps(async () => ledger({ adjustments: undefined })), print: legacy,
    })).resolves.toBe(0);
    expect(legacy).toHaveBeenCalledWith(expect.stringContaining('Adjustment history: unavailable'));
  });

  it('refuses malformed budget state and unresolved features without a partial document', async () => {
    const malformed = vi.fn();
    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'json' }, {
      ...inspectDeps(async () => { throw new Error('corrupt ledger'); }), print: malformed,
    })).resolves.toBe(1);
    expect(malformed).toHaveBeenCalledWith("kickback-budget inspect: current feature state is invalid or unavailable for 'recovery'.");
    expect(malformed.mock.calls[0]![0]).not.toContain('"count"');

    const unresolved = vi.fn();
    await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'missing', format: 'human' }, {
      ...inspectDeps(), print: unresolved,
    })).resolves.toBe(1);
    expect(unresolved).toHaveBeenCalledWith("kickback-budget inspect: current feature state is invalid or unavailable for 'missing'.");
  });

  it('is non-interactive and leaves main and worktree state byte-for-byte unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kickback-budget-inspect-'));
    const localWorktree = join(root, '.worktrees', 'recovery');
    const ledgerPath = join(localWorktree, '.pipeline', 'kickback-ledger.json');
    const mainPath = join(root, 'main-state.txt');
    try {
      await writeFile(mainPath, 'main-state', 'utf8');
      await mkdir(join(localWorktree, '.pipeline'), { recursive: true });
      await writeFile(ledgerPath, JSON.stringify(ledger()), { encoding: 'utf8', flush: true });
      const before = await Promise.all([readFile(mainPath, 'utf8'), readFile(ledgerPath, 'utf8')]);
      const print = vi.fn();
      await expect(dispatchKickbackBudgetInspect({ kind: 'inspect', feature: 'recovery', format: 'json' }, {
        cwd: root,
        resolveMainRoot: async () => root,
        realpath: async (path) => path,
        resolveFeatureIdentity: async () => ({ version: 'v1', repository: root, feature: 'recovery' }),
        isInteractive: false,
        print,
      })).resolves.toBe(0);
      await expect(Promise.all([readFile(mainPath, 'utf8'), readFile(ledgerPath, 'utf8')])).resolves.toEqual(before);
      expect(JSON.parse(print.mock.calls[0]![0])).toMatchObject({ count: 3, limit: 5 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
