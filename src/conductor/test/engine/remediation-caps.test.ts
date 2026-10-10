// Covers: task:4
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import { kickbackBudgetFallbackLimit, prdAuditAppendCap } from '../../src/engine/remediation-caps.js';

const AUTHORED_TASKS = 20;
const DEFAULT_APPEND_CAP = 5;
const OVERRIDDEN_APPEND_CAP = 8;

const configs = [
  { name: 'default', config: '', expected: DEFAULT_APPEND_CAP },
  {
    name: 'all PRD-audit caps overridden',
    config: [
      'prd_audit:',
      '  max_remediation_laps: 3',
      '  max_appended_tasks: 8',
      '  max_appended_ratio: 0.6',
      '  halt_on_any_plan_gap: true',
      '',
    ].join('\n'),
    expected: OVERRIDDEN_APPEND_CAP,
  },
] as const;

async function writeFeature(root: string, slug: string, config: string): Promise<string> {
  const feature = join(root, '.worktrees', slug);
  await mkdir(join(feature, '.pipeline'), { recursive: true });
  await mkdir(join(feature, '.docs', 'plans'), { recursive: true });
  await writeFile(join(feature, '.docs', 'plans', `${slug}.md`), Array.from(
    { length: AUTHORED_TASKS },
    (_, index) => `### Task ${index + 1}: work`,
  ).join('\n'));
  await writeFile(join(feature, '.pipeline', 'conduct-state.json'), JSON.stringify({ build: 'in_progress' }));
  await writeFile(join(feature, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath: `.docs/plans/${slug}.md` }));
  await writeFile(join(feature, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
    version: 1, gates: {}, growth: { authored: AUTHORED_TASKS, added: 0, byGate: {} },
  }));
  if (config) {
    await mkdir(join(feature, '.ai-conductor'), { recursive: true });
    await writeFile(join(feature, '.ai-conductor', 'config.yml'), config);
  }
  return feature;
}

describe('remediation cap consumers', () => {
  // Covers: task:1
  it('resolves kickback-budget fallback limits through the enforcement caps', () => {
    expect(kickbackBudgetFallbackLimit('build_review', {} as never)).toBe(5);
    expect(kickbackBudgetFallbackLimit('architecture_review_as_built', {} as never)).toBe(1);
    expect(kickbackBudgetFallbackLimit(
      'architecture_review_as_built',
      { architecture_review_as_built: { max_remediation_laps: 3 } } as never,
    )).toBe(3);
    expect(kickbackBudgetFallbackLimit(
      'prd_audit',
      { prd_audit: { max_remediation_laps: 2 } } as never,
    )).toBe(2);
  });

  it.each(configs)('reports the recorded $name PRD-audit append cap through both CLIs', async ({ config, expected }) => {
    const root = await mkdtemp(join(tmpdir(), 'remediation-caps-'));
    try {
      await writeFeature(root, 'feature', config);
      const budgetOutput: string[] = [];
      await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'feature', format: 'json' },
        { cwd: root, resolveMainRoot: async () => root, print: (line) => budgetOutput.push(line) },
      );
      const budget = JSON.parse(budgetOutput[0]) as { gates: Array<{ gate: string; planGrowth?: { cap: number } }> };

      const repo = join(root, 'repo');
      await mkdir(repo, { recursive: true });
      await writeFeature(repo, 'feature', config);
      const registryPath = join(root, 'registry.json');
      await writeFile(registryPath, JSON.stringify([{ name: 'repo', path: repo }]));
      const daemonOutput: string[] = [];
      await runDaemonStatus({ registryPath, out: (line) => daemonOutput.push(line) });

      expect({
        helper: prdAuditAppendCap(config ? { prd_audit: { max_appended_tasks: 8, max_appended_ratio: 0.6 } } as never : {}, AUTHORED_TASKS),
        kickback: budget.gates.find((gate) => gate.gate === 'prd_audit')?.planGrowth?.cap,
        daemon: daemonOutput.join('\n').includes(`remaining ${expected}/${expected}`),
      }).toEqual({ helper: expected, kickback: expected, daemon: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
