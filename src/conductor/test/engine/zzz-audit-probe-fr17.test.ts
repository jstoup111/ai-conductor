import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

let projectRoot: string;
let planPath: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'fr17-probe-'));
  planPath = join(projectRoot, '.docs/plans/feature.md');
  await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
  await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(
    planPath,
    Array.from({ length: 20 }, (_, i) => `### Task ${i + 1}: authored work\n`).join(''),
    'utf8',
  );
  await writeFile(
    join(projectRoot, '.pipeline/engine-state.json'),
    JSON.stringify({ activePlanPath: planPath }),
    'utf8',
  );
  await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
    '# Stories', '', '## Story 1: remediation', '', '#### Happy Path',
    '- Given input, when repaired, then it holds.',
  ].join('\n'), 'utf8');
  await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
    '**PRD:** present', '', '## Verdict Table',
    '| Criterion | Grade | Plan task | PRD: | Evidence |',
    '| --- | --- | --- | --- | --- |',
    '| S1.1 | FIXABLE | 1 | FR-7 | Missing implementation |',
  ].join('\n'), 'utf8');
});
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

async function drive(dispositions: unknown[], hintSource: unknown) {
  const runner: StepRunner = {
    run: async () => {
      await writeFile(
        join(projectRoot, '.pipeline/remediation.json'),
        JSON.stringify({ dispositions }),
        'utf8',
      );
      return { success: true };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: { prd_audit: { max_remediation_laps: 3, max_appended_tasks: 5, max_appended_ratio: 1 } } as never,
  });
  const outcome = await (conductor as unknown as {
    planRemediation: (s: ConductState, st: typeof ALL_STEPS, d: string, h: unknown) => Promise<Record<string, unknown>>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS, 'probe', hintSource,
  );
  const plan = await readFile(planPath, 'utf8');
  return { outcome, plan };
}

const PRD_SRC = { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] };
const ASBUILT_SRC = {
  source: 'as-built architecture review',
  evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }],
};
const FINISH_SRC = { source: 'finish-verification', evidence: [{ gate: 'finish', evidenceFile: '.pipeline/test-failures.md' }] };
const VG_SRC = {
  source: 'validation-group',
  evidence: [
    { gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' },
    { gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' },
  ],
};

describe('FR-17 audit probes', () => {
  it('P1 all-unbound prd_audit WITH tasks', async () => {
    const r = await drive([
      { id: 'INVENTED-9', disposition: 'build', category: null, rationale: 'off-plan', tasks: [{ id: 'rem-inv', title: 'x' }] },
    ], PRD_SRC);
    console.log('P1', JSON.stringify(r.outcome), 'planHasInv=', r.plan.includes('rem-inv'));
  });

  it('P2 taskless unbound under PRODUCTION as-built provenance', async () => {
    const r = await drive([
      { id: 'INVENTED-9', disposition: 'architecture_review', category: null, rationale: 'off-plan', tasks: [] },
    ], ASBUILT_SRC);
    console.log('P2', JSON.stringify(r.outcome));
  });

  it('P3 MIXED bound + invented, both with tasks', async () => {
    const r = await drive([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'authorized', tasks: [{ id: 'rem-ok', title: 'do it' }] },
      { id: 'FR-42', disposition: 'build', category: null, rationale: 'invented', tasks: [{ id: 'rem-bad', title: 'sneak' }] },
    ], PRD_SRC);
    console.log('P3', JSON.stringify(r.outcome), 'planOK=', r.plan.includes('rem-ok'), 'planBAD=', r.plan.includes('rem-bad'));
  });

  it('P4 PARTIAL-DROP: bound build gap + UNADMITTED earlier-step (plan) gap', async () => {
    const r = await drive([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'authorized', tasks: [{ id: 'rem-ok2', title: 'do it' }] },
      { id: 'FR-99', disposition: 'plan', category: null, rationale: 'the approved plan omits an in-scope need entirely', tasks: [] },
    ], PRD_SRC);
    console.log('P4', JSON.stringify(r.outcome), 'planOK=', r.plan.includes('rem-ok2'));
  });

  it('P5 PARTIAL-DROP under as-built: publication (admitted) + unadmitted build gap w/ tasks', async () => {
    const r = await drive([
      { id: 'G-1', disposition: 'publication', category: null, rationale: 'PR prose', tasks: [] },
      { id: 'G-2', disposition: 'build', category: null, rationale: 'off-plan code work', tasks: [{ id: 'rem-x', title: 'y' }] },
    ], ASBUILT_SRC);
    console.log('P5', JSON.stringify(r.outcome), 'planHasX=', r.plan.includes('rem-x'));
  });

  it('P5b as-built: publication admitted + unadmitted TASKLESS build gap', async () => {
    const r = await drive([
      { id: 'G-1', disposition: 'publication', category: null, rationale: 'PR prose', tasks: [] },
      { id: 'G-2', disposition: 'acceptance_specs', category: null, rationale: 'off-plan spec work', tasks: [] },
    ], ASBUILT_SRC);
    console.log('P5b', JSON.stringify(r.outcome));
  });

  it('P6 REGRESSION finish-verification taskless acceptance_specs', async () => {
    const r = await drive([
      { id: 'TEST-FAIL-1', disposition: 'acceptance_specs', category: null, rationale: 'specs need repair', tasks: [] },
    ], FINISH_SRC);
    console.log('P6', JSON.stringify(r.outcome));
  });

  it('P6b REGRESSION finish-verification taskless build', async () => {
    const r = await drive([
      { id: 'TEST-FAIL-1', disposition: 'build', category: null, rationale: 'fix the failing test', tasks: [] },
    ], FINISH_SRC);
    console.log('P6b', JSON.stringify(r.outcome));
  });

  it('P6c REGRESSION finish-verification WITH tasks', async () => {
    const r = await drive([
      { id: 'TEST-FAIL-1', disposition: 'build', category: null, rationale: 'fix the failing test', tasks: [{ id: 'rem-f1', title: 'src/a.ts — fix' }] },
    ], FINISH_SRC);
    console.log('P6c', JSON.stringify(r.outcome), 'planHas=', r.plan.includes('rem-f1'));
  });

  it('P7 validation-group bound FR-7 routes', async () => {
    const r = await drive([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'authorized', tasks: [{ id: 'rem-vg', title: 'do it' }] },
    ], VG_SRC);
    console.log('P7', JSON.stringify(r.outcome), 'planHas=', r.plan.includes('rem-vg'));
  });

  it('P8 publication-only under prd-audit (unbound id) routes to finish', async () => {
    const r = await drive([
      { id: 'ANYTHING-GOES', disposition: 'publication', category: null, rationale: 'PR body needs the issue link', tasks: [] },
    ], PRD_SRC);
    console.log('P8', JSON.stringify(r.outcome));
  });

  it('P9 prd-audit: bound gap w/ tasks but id lowercase fr-7', async () => {
    const r = await drive([
      { id: 'fr-7', disposition: 'build', category: null, rationale: 'authorized', tasks: [{ id: 'rem-lc', title: 'do it' }] },
    ], PRD_SRC);
    console.log('P9', JSON.stringify(r.outcome), 'planHas=', r.plan.includes('rem-lc'));
  });

  it('P10 prd-audit stale/missing audit artifact + tasked gap', async () => {
    await rm(join(projectRoot, '.pipeline/prd-audit.md'));
    const r = await drive([
      { id: 'FR-7', disposition: 'build', category: null, rationale: 'authorized', tasks: [{ id: 'rem-stale', title: 'do it' }] },
    ], PRD_SRC);
    console.log('P10', JSON.stringify(r.outcome), 'planHas=', r.plan.includes('rem-stale'));
  });

  it('P11 as-built publication-only routes to finish (BUILD not reached)', async () => {
    const r = await drive([
      { id: 'G-1', disposition: 'publication', category: null, rationale: 'PR prose only', tasks: [] },
    ], ASBUILT_SRC);
    console.log('P11', JSON.stringify(r.outcome));
  });
});
