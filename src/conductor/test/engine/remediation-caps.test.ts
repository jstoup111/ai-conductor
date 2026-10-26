// Covers: task:3
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  kickbackBudgetFallbackLimit,
  pendingRepairSettlementBudgets,
  readPlanGrowthBudget,
  readRemediationGateAppendBudget,
  remediationLapCapForGate,
  resolveRemediationLapAllowance,
  validationJoinRemediationRoundCap,
} from '../../src/engine/remediation-caps.js';
import { readKickbackLedger, settlePendingRepair } from '../../src/engine/kickback-ledger.js';
import { loadMergedConfig } from '../../src/engine/config.js';

const STORY_TWO_SLUG = 'growth-feature';
const STORY_TWO_CONFIG = {
  prd_audit: { max_appended_tasks: 30, max_appended_ratio: 0.5 },
} as never;

function taskHeadings(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `### Task ${prefix}${index + 1}: work`).join('\n');
}

async function writePlanFixture(
  root: string,
  slug: string,
  plan: string | undefined,
  ledger: Record<string, unknown>,
  includeUnrelated = true,
): Promise<void> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: slug }));
  await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({ version: 1, gates: {}, ...ledger }));
  if (plan !== undefined) await writeFile(join(root, '.docs', 'plans', `${slug}.md`), plan);
  if (includeUnrelated) await writeFile(join(root, '.docs', 'plans', 'unrelated.md'), taskHeadings('other-', 3));
}

describe('remediation cap consumers', () => {
  // Covers: task:1
  it('resolves kickback-budget fallback limits through the enforcement caps', () => {
    expect(kickbackBudgetFallbackLimit('build_review', {} as never)).toBe(5);
    expect(kickbackBudgetFallbackLimit('architecture_review_as_built', {} as never)).toBe(3);
    expect(kickbackBudgetFallbackLimit(
      'architecture_review_as_built',
      { architecture_review_as_built: { max_remediation_laps: 3 } } as never,
    )).toBe(3);
    expect(kickbackBudgetFallbackLimit(
      'prd_audit',
      { prd_audit: { max_remediation_laps: 2 } } as never,
    )).toBe(2);
  });
});

describe('resolveRemediationLapAllowance', () => {
  const remediationGates = ['prd_audit', 'architecture_review_as_built'] as const;

  it.each(remediationGates)('returns S/M/L defaults and treats an unrecorded tier as M for %s', (gate) => {
    expect(resolveRemediationLapAllowance(gate, {} as never, 'S')).toEqual({ limit: 2, tier: 'S', source: 'default' });
    expect(resolveRemediationLapAllowance(gate, {} as never, 'M')).toEqual({ limit: 3, tier: 'M', source: 'default' });
    expect(resolveRemediationLapAllowance(gate, {} as never, 'L')).toEqual({ limit: 4, tier: 'L', source: 'default' });
    expect(resolveRemediationLapAllowance(gate, {} as never, undefined)).toEqual({ limit: 3, tier: undefined, source: 'default' });
  });

  it('uses integer and per-tier maps without crossing remediation-gate boundaries', () => {
    const integer = { prd_audit: { max_remediation_laps: 7 } } as never;
    for (const tier of ['S', 'M', 'L', undefined] as const) {
      expect(resolveRemediationLapAllowance('prd_audit', integer, tier)).toMatchObject({ limit: 7, tier, source: 'configured' });
    }

    const mapped = { prd_audit: { max_remediation_laps: { L: 6 } } } as never;
    expect(resolveRemediationLapAllowance('prd_audit', mapped, 'L')).toMatchObject({ limit: 6, tier: 'L', source: 'configured' });
    expect(resolveRemediationLapAllowance('prd_audit', mapped, 'S')).toEqual({ limit: 2, tier: 'S', source: 'default' });
    expect(resolveRemediationLapAllowance('prd_audit', mapped, 'M')).toEqual({ limit: 3, tier: 'M', source: 'default' });
    expect(resolveRemediationLapAllowance('prd_audit', mapped, undefined)).toEqual({ limit: 3, tier: undefined, source: 'default' });
    expect(resolveRemediationLapAllowance('architecture_review_as_built', mapped, 'L')).toEqual({ limit: 4, tier: 'L', source: 'default' });
    expect(resolveRemediationLapAllowance('prd_audit', { prd_audit: { max_remediation_laps: {} } } as never, 'L')).toEqual({ limit: 4, tier: 'L', source: 'default' });
  });

  it('threads the tier-aware resolver through every remediation cap consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-tier-'));
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      const config = {
        prd_audit: { max_remediation_laps: { L: 6 } },
        architecture_review_as_built: { max_remediation_laps: { S: 5 } },
      } as never;
      expect(remediationLapCapForGate('prd_audit', config, 0, 'L')).toBe(6);
      expect(kickbackBudgetFallbackLimit('architecture_review_as_built', config, 'S')).toBe(5);
      expect(await validationJoinRemediationRoundCap(root, config, 'L')).toBe(6);
      await writePlanFixture(root, STORY_TWO_SLUG, taskHeadings('', 1), {});
      await expect(pendingRepairSettlementBudgets(root, config, await readKickbackLedger(root), 'L')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ gate: 'prd_audit', lapCap: 6 }),
        expect.objectContaining({ gate: 'architecture_review_as_built', lapCap: 4 }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves tier maps after user/project config merging without inventing a lap cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-config-'));
    const userConfigDir = join(root, 'user');
    const originalUserConfigDir = process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
    try {
      await mkdir(join(root, '.ai-conductor'), { recursive: true });
      await mkdir(userConfigDir, { recursive: true });
      process.env.AI_CONDUCTOR_USER_CONFIG_DIR = userConfigDir;

      const load = async (user: string, project: string) => {
        await writeFile(join(userConfigDir, 'config.yml'), user);
        await writeFile(join(root, '.ai-conductor', 'config.yml'), project);
        const loaded = await loadMergedConfig(root);
        if (!loaded.ok) throw new Error(loaded.error.message);
        return loaded.config;
      };

      const noCaps = await load(
        '{}\n',
        'prd_audit:\n  max_appended_tasks: 5\narchitecture_review_as_built:\n  remediation:\n    enabled: true\n',
      );
      for (const gate of remediationGates) expect(resolveRemediationLapAllowance(gate, noCaps, 'L').limit).toBe(4);

      const mergedMaps = await load(
        'prd_audit:\n  max_remediation_laps:\n    S: 1\narchitecture_review_as_built:\n  max_remediation_laps:\n    S: 1\n',
        'prd_audit:\n  max_remediation_laps:\n    L: 5\narchitecture_review_as_built:\n  max_remediation_laps:\n    L: 5\n',
      );
      for (const gate of remediationGates) {
        expect(resolveRemediationLapAllowance(gate, mergedMaps, 'S').limit).toBe(1);
        expect(resolveRemediationLapAllowance(gate, mergedMaps, 'M').limit).toBe(3);
        expect(resolveRemediationLapAllowance(gate, mergedMaps, 'L').limit).toBe(5);
      }

      const projectInteger = await load(
        'prd_audit:\n  max_remediation_laps:\n    L: 5\narchitecture_review_as_built:\n  max_remediation_laps:\n    L: 5\n',
        'prd_audit:\n  max_remediation_laps: 2\narchitecture_review_as_built:\n  max_remediation_laps: 2\n',
      );
      for (const gate of remediationGates) {
        for (const tier of ['S', 'M', 'L', undefined] as const) {
          expect(resolveRemediationLapAllowance(gate, projectInteger, tier)).toMatchObject({ limit: 2, source: 'configured' });
        }
      }
    } finally {
      if (originalUserConfigDir === undefined) delete process.env.AI_CONDUCTOR_USER_CONFIG_DIR;
      else process.env.AI_CONDUCTOR_USER_CONFIG_DIR = originalUserConfigDir;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('readPlanGrowthBudget', () => {
  it('derives the Story 2 configured cap from the slug-matched plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readPlanGrowthBudget(root, STORY_TWO_CONFIG, { persist: true })).resolves.toEqual({
        growth: { authored: 24, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 }, remaining: 3 },
        cap: 12,
        capSource: 'config-derived',
        authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the raised cap over the configured cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        effectiveGrowthCap: 20,
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readPlanGrowthBudget(root, STORY_TWO_CONFIG, { persist: true })).resolves.toMatchObject({
        growth: { authored: 24, added: 9, remaining: 11 }, cap: 20, capSource: 'raised', authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives the default cap for a resolved 17-task plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, taskHeadings('', 17), {});

      await expect(readPlanGrowthBudget(root, {}, { persist: true })).resolves.toMatchObject({
        growth: { authored: 17, added: 0, remaining: 4 }, cap: 4, capSource: 'config-derived', authoredSource: 'plan',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an unresolved zero cap without a resolvable plan or growth record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, undefined, {}, false);

      await expect(readPlanGrowthBudget(root, {}, { persist: true })).resolves.toMatchObject({
        cap: 0, capSource: 'config-derived', authoredSource: 'unresolved',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('readRemediationGateAppendBudget', () => {
  // Covers: task:4
  it('uses the shared growth budget instead of every plan heading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });

      await expect(readRemediationGateAppendBudget(
        root, STORY_TWO_CONFIG, 'prd_audit', 1, 1, 1,
      )).resolves.toMatchObject({
        growthCap: 12,
        growth: { authored: 24 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('pendingRepairSettlementBudgets', () => {
  // Covers: task:5
  it('settles a pending prd-audit repair within the shared growth budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
        pendingRepair: {
          receiptId: 'repair-1',
          charges: { prd_audit: { laps: 1, growth: 3 } },
          taskIds: ['rem-prd-10'],
        },
      });

      const budgets = await pendingRepairSettlementBudgets(root, STORY_TWO_CONFIG, await readKickbackLedger(root));
      expect(budgets).toEqual(expect.arrayContaining([
        expect.objectContaining({ authoredSource: 'plan' }),
      ]));

      await expect(settlePendingRepair(root, budgets)).resolves.toEqual({ kind: 'settled' });
      await expect(readKickbackLedger(root)).resolves.toMatchObject({
        growth: { authored: 24, added: 12, byGate: { prd_audit: 8, architecture_review_as_built: 4 } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:5
  it('refuses a pending prd-audit repair that exceeds the shared growth budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, [taskHeadings('', 24), taskHeadings('rem-', 9)].join('\n'), {
        growth: { authored: 0, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
        pendingRepair: {
          receiptId: 'repair-1',
          charges: { prd_audit: { laps: 1, growth: 4 } },
          taskIds: ['rem-prd-10'],
        },
      });

      const budgets = await pendingRepairSettlementBudgets(root, STORY_TWO_CONFIG, await readKickbackLedger(root));

      await expect(settlePendingRepair(root, budgets)).resolves.toEqual({
        kind: 'exhausted', gate: 'prd_audit', allowance: 'growth',
      });
      await expect(readKickbackLedger(root)).resolves.toMatchObject({
        growth: { authored: 24, added: 9, byGate: { prd_audit: 5, architecture_review_as_built: 4 } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:5
  it('refuses growth when no plan or raised cap resolves the budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writePlanFixture(root, STORY_TWO_SLUG, undefined, {
        pendingRepair: {
          receiptId: 'repair-1',
          charges: { prd_audit: { laps: 1, growth: 1 } },
          taskIds: ['rem-prd-1'],
        },
      }, false);

      const budgets = await pendingRepairSettlementBudgets(root, {}, await readKickbackLedger(root));
      expect(budgets).toEqual(expect.arrayContaining([
        expect.objectContaining({ authoredSource: 'unresolved' }),
      ]));

      await expect(settlePendingRepair(root, budgets)).resolves.toEqual({
        kind: 'exhausted', gate: 'prd_audit', allowance: 'growth',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
