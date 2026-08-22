import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Conductor,
  remediationLapCapForGate,
  type StepRunner,
} from '../src/engine/conductor.js';
import { readKickbackLedger } from '../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import type { ConductState } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const dirs: string[] = [];

describe('prd_audit kickback', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('appends the first capped lap of FIXABLE work with criterion-bound completion checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    const plan = Array.from(
      { length: 20 },
      (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
    ).join('\n');
    await writeFile(planPath, plan);
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
    );
    await writeFile(
      join(root, '.pipeline', 'prd-audit.md'),
      [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | FIXABLE | 4 | Missing first behavior |',
        '| S2.2 | FIXABLE | 5 | Missing second behavior |',
        '| S2.3 | FIXABLE | 6 | Missing third behavior |',
      ].join('\n'),
    );

    const runner: StepRunner = {
      run: async () => {
        await writeFile(
          join(root, '.pipeline', 'remediation.json'),
          JSON.stringify({
            dispositions: ['S2.1', 'S2.2', 'S2.3'].map((criterion) => ({
              id: criterion,
              disposition: 'build',
              category: null,
              rationale: `Repair ${criterion}.`,
              tasks: [{ id: `rem-${criterion.toLowerCase()}`, title: `Repair ${criterion}` }],
            })),
          }),
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appendedPlan = await readFile(planPath, 'utf8');
    for (const [criterion, parentTask] of [['S2.1', 4], ['S2.2', 5], ['S2.3', 6]] as const) {
      expect(appendedPlan).toContain(`**Criterion:** ${criterion}`);
      expect(appendedPlan).toContain(`**Parent task:** ${parentTask}`);
      expect(appendedPlan).toContain(`**Done when:**\n- ${criterion} is satisfied by this task.`);
    }
    const ledger = await readKickbackLedger(root);
    expect((ledger.gates.prd_audit as { laps?: number } | undefined)?.laps).toBe(1);
  });

  it('uses its configured lap cap even when the generic cap is unavailable', () => {
    expect(
      remediationLapCapForGate('prd_audit', { prd_audit: { max_remediation_laps: 1 } } as never, 0),
    ).toBe(1);
    expect(remediationLapCapForGate('manual_test', {} as never, 0)).toBe(0);
  });
});
