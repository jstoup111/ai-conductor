import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { Conductor } from '../src/engine/conductor.js';
import type { StepRunner } from '../src/engine/conductor.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { readKickbackLedger, readGrowth, writeKickbackLedger } from '../src/engine/kickback-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function stage(opts: {
  authored?: number;
  dispositions: unknown[];
  prdAudit?: boolean;
  config?: unknown;
}) {
  const root = await mkdtemp(join(tmpdir(), 'fr18-probe-'));
  dirs.push(root);
  const planPath = join(root, '.docs/plans/feature.md');
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await mkdir(join(root, '.docs/stories'), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  const authored = opts.authored ?? 20;
  await writeFile(
    planPath,
    '# Implementation plan\n\n' +
      Array.from({ length: authored }, (_, i) => `### Task ${i + 1}: authored work ${i + 1}\n`).join('\n'),
  );
  await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await writeFile(
    join(root, '.docs/stories/feature.md'),
    ['# Stories', '', '## Story 2: remediation', '', '#### Happy Path',
      '- Given S2.1, when repaired, then it holds.',
      '- Given S2.2, when repaired, then it holds.',
      '- Given S2.3, when repaired, then it holds.',
      '- Given S2.4, when repaired, then it holds.',
      '- Given S2.5, when repaired, then it holds.',
      '- Given S2.6, when repaired, then it holds.',
      '- Given S2.7, when repaired, then it holds.',
      '- Given S2.8, when repaired, then it holds.',
    ].join('\n'),
  );
  if (opts.prdAudit !== false) {
    await writeFile(
      join(root, '.pipeline/prd-audit.md'),
      ['**PRD:** present', '', '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |', '| --- | --- | --- | --- |',
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `| S2.${n} | FIXABLE | ${n} | Missing behavior ${n} |`),
      ].join('\n'),
    );
  }
  const runner: StepRunner = {
    run: async () => {
      await writeFile(
        join(root, '.pipeline/remediation.json'),
        JSON.stringify({ dispositions: opts.dispositions }),
      );
      return { success: true };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline/conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    ...(opts.config ? { config: opts.config as never } : {}),
  });
  return { root, planPath, conductor };
}

function drive(conductor: Conductor, hintSource: unknown) {
  return (conductor as unknown as {
    planRemediation: (
      s: ConductState, st: typeof ALL_STEPS, ctx: string, h: unknown,
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string; hint?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS, 'probe', hintSource,
  );
}

const SIX_SHAPES: Array<{ label: string; hintSource: unknown }> = [
  { label: 'build_stall', hintSource: { source: 'build_stall', evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/build-stall-question.md' }] } },
  { label: 'build_stall_zero_work', hintSource: { source: 'build_stall_zero_work', evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/build-stall-question.md' }] } },
  { label: 'build-stall', hintSource: { source: 'build-stall', evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/halt-user-input-required' }] } },
  { label: 'finish-verification', hintSource: { source: 'finish-verification', evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/test-failures.md' }] } },
  { label: 'as-built architecture review', hintSource: { source: 'as-built architecture review', evidence: [{ gate: 'architecture_review_as_built' as StepName, evidenceFile: '.pipeline/architecture-review-as-built.md' }] } },
  { label: 'validation-group (as-built only)', hintSource: { source: 'validation-group', evidence: [{ gate: 'architecture_review_as_built' as StepName, evidenceFile: '.pipeline/architecture-review-as-built.md' }] } },
];

describe('FR-18 probe', () => {
  it('P1: six production hintSource shapes cannot grow the plan', async () => {
    const observed: Record<string, unknown> = {};
    for (const shape of SIX_SHAPES) {
      const { planPath, conductor } = await stage({
        dispositions: [{
          id: 'gap-1', disposition: 'build', category: null,
          rationale: 'Implementation drift in src/thing.ts:10.',
          tasks: [{ id: 'rem-foreign-1', title: 'src/thing.ts:10 — foreign append' }],
        }],
        prdAudit: false,
      });
      const before = await readFile(planPath, 'utf8');
      const outcome = await drive(conductor, shape.hintSource);
      const after = await readFile(planPath, 'utf8');
      observed[shape.label] = {
        kind: outcome.kind, target: outcome.target, haltClass: outcome.haltClass,
        detail: outcome.detail?.slice(0, 130),
        byteIdentical: before === after, beforeHash: hash(before), afterHash: hash(after),
      };
    }
    console.log('P1 ' + JSON.stringify(observed, null, 2));
    for (const shape of SIX_SHAPES) {
      expect((observed[shape.label] as { byteIdentical: boolean }).byteIdentical).toBe(true);
    }
  });

  it('P2a: publication disposition CARRYING tasks, foreign provenance', async () => {
    const { planPath, conductor } = await stage({
      dispositions: [{
        id: 'gap-pub', disposition: 'publication', category: null,
        rationale: 'PR body wrong.',
        tasks: [{ id: 'rem-smuggled-1', title: 'src/thing.ts:10 — smuggled implementation work' }],
      }],
      prdAudit: false,
    });
    const before = await readFile(planPath, 'utf8');
    const outcome = await drive(conductor, SIX_SHAPES[4].hintSource);
    const after = await readFile(planPath, 'utf8');
    console.log('P2a ' + JSON.stringify({ outcome, byteIdentical: before === after }, null, 2));
  });

  it('P2b: sealed-artifact gap CARRYING build tasks, foreign provenance', async () => {
    const { planPath, conductor } = await stage({
      dispositions: [{
        id: 'gap-sealed', disposition: 'build', category: null,
        rationale: 'Design drift.',
        tasks: [{ id: 'rem-sealed-1', title: '.docs/plans/other-feature.md — amend the approved plan' }],
      }],
      prdAudit: false,
    });
    const before = await readFile(planPath, 'utf8');
    const outcome = await drive(conductor, SIX_SHAPES[4].hintSource);
    const after = await readFile(planPath, 'utf8');
    console.log('P2b ' + JSON.stringify({ outcome, byteIdentical: before === after }, null, 2));
  });

  it('P2c: sealed-artifact gap + ordinary build gap, foreign provenance', async () => {
    const { planPath, conductor } = await stage({
      dispositions: [
        { id: 'gap-sealed', disposition: 'build', category: null, rationale: 'Design drift.',
          tasks: [{ id: 'rem-sealed-1', title: '.docs/plans/other-feature.md — amend the approved plan' }] },
        { id: 'gap-ord', disposition: 'build', category: null, rationale: 'Impl drift.',
          tasks: [{ id: 'rem-ord-1', title: 'src/thing.ts:10 — foreign append' }] },
      ],
      prdAudit: false,
    });
    const before = await readFile(planPath, 'utf8');
    const outcome = await drive(conductor, SIX_SHAPES[4].hintSource);
    const after = await readFile(planPath, 'utf8');
    console.log('P2c ' + JSON.stringify({ outcome, byteIdentical: before === after }, null, 2));
  });

  it('P2d: publication gap (admitted) + ordinary build gap, foreign provenance', async () => {
    const { planPath, conductor } = await stage({
      dispositions: [
        { id: 'gap-pub', disposition: 'publication', category: null, rationale: 'PR body wrong.', tasks: [] },
        { id: 'gap-ord', disposition: 'build', category: null, rationale: 'Impl drift.',
          tasks: [{ id: 'rem-ord-1', title: 'src/thing.ts:10 — foreign append' }] },
      ],
      prdAudit: false,
    });
    const before = await readFile(planPath, 'utf8');
    const outcome = await drive(conductor, SIX_SHAPES[4].hintSource);
    const after = await readFile(planPath, 'utf8');
    console.log('P2d ' + JSON.stringify({ outcome, byteIdentical: before === after }, null, 2));
  });

  it('P2e: prd_audit provenance, gap id NOT in the audit report but publication-dispositioned with tasks', async () => {
    const { planPath, conductor } = await stage({
      dispositions: [
        { id: 'gap-unowned', disposition: 'publication', category: null, rationale: 'PR body.', tasks: [{ id: 'rem-x', title: 'src/thing.ts:1 — smuggled' }] },
        { id: 'gap-unowned2', disposition: 'build', category: null, rationale: 'Impl.', tasks: [{ id: 'rem-y', title: 'src/thing.ts:2 — unowned append' }] },
      ],
    });
    const before = await readFile(planPath, 'utf8');
    const outcome = await drive(conductor, { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] });
    const after = await readFile(planPath, 'utf8');
    console.log('P2e ' + JSON.stringify({ outcome, byteIdentical: before === after }, null, 2));
  });

  it('P3: total growth bound across many laps at default max_appended_tasks', async () => {
    // 8 owned FIXABLE criteria; request 3 per lap, high lap cap.
    const mk = (ids: string[]) => ids.map((c) => ({
      id: c, disposition: 'build', category: null, rationale: `Repair ${c}.`,
      tasks: [{ id: `rem-${c.toLowerCase()}`, title: `Repair ${c}` }],
    }));
    const { root, planPath, conductor } = await stage({
      authored: 20,
      dispositions: mk(['S2.1', 'S2.2', 'S2.3']),
      config: { prd_audit: { max_remediation_laps: 50 } },
    });
    const log: unknown[] = [];
    const batches = [['S2.1','S2.2','S2.3'], ['S2.4','S2.5','S2.6'], ['S2.7','S2.8'], ['S2.1','S2.2'], ['S2.3']];
    for (const batch of batches) {
      await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({ dispositions: mk(batch) }));
      (conductor as unknown as { stepRunner: StepRunner }).stepRunner = {
        run: async () => {
          await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({ dispositions: mk(batch) }));
          return { success: true };
        },
      };
      const outcome = await drive(conductor, { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] });
      const planText = await readFile(planPath, 'utf8');
      const growth = (await readKickbackLedger(root)).growth;
      log.push({
        batch, kind: outcome.kind, target: outcome.target, haltClass: outcome.haltClass,
        detail: outcome.detail?.slice(0, 160),
        planTaskHeadings: planText.match(/^#{1,6}\s+Task\s+/gim)?.length ?? 0,
        growth,
      });
    }
    console.log('P3 ' + JSON.stringify(log, null, 2));
  });

  it('P3b: same, with max_appended_tasks raised so the ratio is binding (denominator drift)', async () => {
    const mk = (ids: string[]) => ids.map((c) => ({
      id: c, disposition: 'build', category: null, rationale: `Repair ${c}.`,
      tasks: [{ id: `rem-${c.toLowerCase()}`, title: `Repair ${c}` }],
    }));
    const { root, planPath, conductor } = await stage({
      authored: 20,
      dispositions: mk(['S2.1']),
      config: { prd_audit: { max_remediation_laps: 50, max_appended_tasks: 100 } },
    });
    const log: unknown[] = [];
    for (let lap = 0; lap < 14; lap++) {
      const batch = [`S2.${(lap % 8) + 1}`];
      (conductor as unknown as { stepRunner: StepRunner }).stepRunner = {
        run: async () => {
          await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({ dispositions: mk(batch) }));
          return { success: true };
        },
      };
      const outcome = await drive(conductor, { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] });
      const planText = await readFile(planPath, 'utf8');
      const growth = (await readKickbackLedger(root)).growth;
      log.push({ lap, kind: outcome.kind, haltClass: outcome.haltClass, detail: outcome.detail?.slice(0, 140), headings: planText.match(/^#{1,6}\s+Task\s+/gim)?.length ?? 0, growth });
      if (outcome.kind === 'halt') break;
    }
    console.log('P3b ' + JSON.stringify(log, null, 2));
  });

  it('P4: readGrowth preserves a recorded foreign append as added, not authored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fr18-growth-'));
    dirs.push(root);
    await mkdir(join(root, '.docs/plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const planPath = join(root, '.docs/plans/feature.md');
    // Plan has 5 headings; ledger records 2 added. Plan-derived authored=5.
    await writeFile(planPath, ['### Task 1: a', '### Task 2: b', '### Task 3: c', '### Task rem-1: added', '### Task rem-2: added'].join('\n'));
    await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeKickbackLedger(root, { version: 1, gates: {}, growth: { authored: 9, added: 2, byGate: { prd_audit: 2 } } } as never);
    const g = await readGrowth(root, 5);
    console.log('P4 ' + JSON.stringify(g));
  });
});
