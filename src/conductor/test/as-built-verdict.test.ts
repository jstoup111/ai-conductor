// Covers: task:1, task:2, task:3, task:4, task:5, task:6
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkStepCompletion,
  classifyAsBuiltReviewOutcome,
  parseAsBuiltBlockedFindings,
  readAsBuiltVerdictLine,
  renderAsBuiltInvalidReason,
} from '../src/engine/artifacts.js';
import { Conductor, type StepRunner } from '../src/engine/conductor.js';
import { readKickbackLedger, writeKickbackLedger } from '../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import { writeState } from '../src/engine/state.js';
import type { ConductState, StepName } from '../src/types/index.js';
import type { ConductorEvent } from '../src/types/events.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'as-built-verdict-'));
  dirs.push(dir);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

async function writeAsBuilt(dir: string, body: string): Promise<void> {
  await writeFile(join(dir, '.pipeline', 'architecture-review-as-built.md'), body);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('as-built verdict gate', () => {
  it('does not treat a Verdict heading and body as a verdict line', () => {
    expect(readAsBuiltVerdictLine('## Verdict\n\n**BLOCKED**')).toEqual({ found: false });
  });

  it('does not find a verdict in empty content', () => {
    expect(readAsBuiltVerdictLine('')).toEqual({ found: false });
  });

  it('retains an unrecognized verdict line for diagnosis', () => {
    expect(readAsBuiltVerdictLine('Verdict: REJECTED')).toEqual({
      found: true,
      raw: 'REJECTED',
      recognized: null,
    });
  });

  it('recognizes a bold, lower-case approved-with-drift-notes verdict line', () => {
    expect(readAsBuiltVerdictLine('**Verdict:** approved with drift notes')).toEqual({
      found: true,
      raw: 'APPROVED WITH DRIFT NOTES',
      recognized: 'APPROVED WITH DRIFT NOTES',
    });
  });

  it('parses an all-remediable BLOCKED findings table', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | adr-2026-08-25-example decision 2 | Add the missing guard |',
      '| ARCH-2 | REMEDIABLE | Task 2 | Return a typed fault |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: true,
      value: {
        findings: [
          {
            id: 'ARCH-1',
            class: 'REMEDIABLE',
            clause: 'adr-2026-08-25-example decision 2',
            summary: 'Add the missing guard',
          },
          {
            id: 'ARCH-2',
            class: 'REMEDIABLE',
            clause: 'Task 2',
            summary: 'Return a typed fault',
          },
        ],
      },
    });
  });

  it('parses a BLOCKED findings table that includes a design finding', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '| ARCH-2 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: true,
      value: {
        findings: [
          {
            id: 'ARCH-1',
            class: 'REMEDIABLE',
            clause: 'Task 2',
            summary: 'Add the missing guard',
          },
          {
            id: 'ARCH-2',
            class: 'DESIGN',
            clause: 'adr-2026-08-25-example decision 3',
            summary: 'Choose an incompatible policy',
          },
        ],
      },
    });
  });

  it('returns a typed fault when a BLOCKED report has no findings table', () => {
    expect(parseAsBuiltBlockedFindings('Verdict: BLOCKED')).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built BLOCKED report is missing its Blocking Findings table.',
    });
  });

  it('returns a typed fault naming an unknown finding class and its row', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-7 | UNKNOWN | Task 2 | Unrecognized classification |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built finding ARCH-7 has an invalid Class value "UNKNOWN".',
    });
  });

  it.each(['remediable', 'Design'])('rejects the non-exact Class value %s', (classValue) => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      `| ARCH-EXACT | ${classValue} | Task 2 | Use the exact closed vocabulary |`,
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: `As-built finding ARCH-EXACT has an invalid Class value "${classValue}".`,
    });
  });

  it('returns a typed fault naming a REMEDIABLE finding without a governing clause', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-8 | REMEDIABLE | | Missing governing clause |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built REMEDIABLE finding ARCH-8 has no Governing clause.',
    });
  });

  it('returns a typed fault for a Blocking Findings table with a malformed header', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Summary |',
      '| --- | --- | --- |',
      '| ARCH-9 | REMEDIABLE | Missing the clause column |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built Blocking Findings table has a malformed header.',
    });
  });

  it('returns a typed fault when a second Blocking Findings section disagrees with the first', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-2 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built BLOCKED report has duplicate Blocking Findings sections.',
    });
    expect(classifyAsBuiltReviewOutcome(report)).toEqual({
      kind: 'invalid',
      cause: 'unparseable-blocked-findings',
      detail: 'As-built BLOCKED report has duplicate Blocking Findings sections.',
    });
  });

  it('rejects a second Blocking Findings table within the authoritative section', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-2 | REMEDIABLE | Task 3 | Add a second hidden route |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built BLOCKED report has duplicate Blocking Findings tables.',
    });
    expect(classifyAsBuiltReviewOutcome(report)).toEqual({
      kind: 'invalid',
      cause: 'unparseable-blocked-findings',
      detail: 'As-built BLOCKED report has duplicate Blocking Findings tables.',
    });
  });

  it('returns a typed fault naming a duplicate Finding id within one table', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '| ARCH-1 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
    ].join('\n');

    expect(parseAsBuiltBlockedFindings(report)).toEqual({
      ok: false,
      class: 'mechanical-fault',
      error: 'As-built Blocking Findings table has duplicate Finding id "ARCH-1".',
    });
    expect(classifyAsBuiltReviewOutcome(report)).toEqual({
      kind: 'invalid',
      cause: 'unparseable-blocked-findings',
      detail: 'As-built Blocking Findings table has duplicate Finding id "ARCH-1".',
    });
  });

  it('classifies an all-REMEDIABLE BLOCKED findings table as blocked-remediable', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '| ARCH-2 | REMEDIABLE | Task 2 | Return a typed fault |',
    ].join('\n');

    expect(classifyAsBuiltReviewOutcome(report)).toEqual({ kind: 'blocked-remediable' });
  });

  it('classifies a BLOCKED findings table with a DESIGN row as blocked-design', () => {
    const report = [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      '| ARCH-2 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
    ].join('\n');

    expect(classifyAsBuiltReviewOutcome(report)).toEqual({
      kind: 'blocked-design',
      designFindings: [{ id: 'ARCH-2', clause: 'adr-2026-08-25-example decision 3' }],
    });
  });

  it('classifies every malformed BLOCKED findings table as invalid', () => {
    const reports = [
      'Verdict: BLOCKED',
      [
        'Verdict: BLOCKED',
        '',
        '## Blocking Findings',
        '| Finding | Class | Governing clause | Summary |',
        '| --- | --- | --- | --- |',
        '| ARCH-7 | UNKNOWN | Task 2 | Unrecognized classification |',
      ].join('\n'),
      [
        'Verdict: BLOCKED',
        '',
        '## Blocking Findings',
        '| Finding | Class | Governing clause | Summary |',
        '| --- | --- | --- | --- |',
        '| ARCH-8 | REMEDIABLE | | Missing governing clause |',
      ].join('\n'),
      [
        'Verdict: BLOCKED',
        '',
        '## Blocking Findings',
        '| Finding | Class | Summary |',
        '| --- | --- | --- |',
        '| ARCH-9 | REMEDIABLE | Missing the clause column |',
      ].join('\n'),
    ];

    for (const report of reports) {
      expect(classifyAsBuiltReviewOutcome(report)).toMatchObject({
        kind: 'invalid',
        cause: 'unparseable-blocked-findings',
        detail: expect.any(String),
      });
    }
  });

  it('classifies a heading-style verdict as a missing verdict line', () => {
    expect(classifyAsBuiltReviewOutcome('## Verdict\n\n**BLOCKED**')).toEqual({
      kind: 'invalid',
      cause: 'no-verdict-line',
    });
  });

  it('classifies an unrecognized verdict with its raw value', () => {
    expect(classifyAsBuiltReviewOutcome('Verdict: REJECTED')).toEqual({
      kind: 'invalid',
      cause: 'unrecognized-verdict',
      value: 'REJECTED',
    });
  });

  it.each(['Verdict: PLAN_GAP', 'Verdict: PLAN_GAP\nOutcome delivered: maybe'])(
    'classifies PLAN_GAP report %j without a valid outcome as missing its outcome',
    (report) => {
      expect(classifyAsBuiltReviewOutcome(report)).toEqual({
        kind: 'invalid',
        cause: 'plan-gap-missing-outcome',
      });
    },
  );

  it('classifies malformed BLOCKED findings with the parser error', () => {
    expect(classifyAsBuiltReviewOutcome('Verdict: BLOCKED')).toEqual({
      kind: 'invalid',
      cause: 'unparseable-blocked-findings',
      detail: 'As-built BLOCKED report is missing its Blocking Findings table.',
    });
  });

  it('renders a missing verdict line without PLAN_GAP-specific guidance', () => {
    expect(renderAsBuiltInvalidReason({ kind: 'invalid', cause: 'no-verdict-line' })).toEqual(
      expect.stringMatching(/^(?=.*no parseable `Verdict:` line was found)(?=.*`Verdict: <value>`)(?!.*PLAN_GAP)(?!.*Outcome delivered).+$/),
    );
  });

  it('renders an unrecognized verdict with its value and the closed vocabulary', () => {
    expect(renderAsBuiltInvalidReason({
      kind: 'invalid',
      cause: 'unrecognized-verdict',
      value: 'REJECTED',
    })).toEqual(expect.stringMatching(/(?=.*REJECTED)(?=.*APPROVED)(?=.*APPROVED WITH DRIFT NOTES)(?=.*PLAN_GAP)(?=.*BLOCKED)/));
  });

  it('renders PLAN_GAP guidance when its outcome is missing', () => {
    expect(renderAsBuiltInvalidReason({ kind: 'invalid', cause: 'plan-gap-missing-outcome' })).toEqual(
      expect.stringMatching(/(?=.*PLAN_GAP)(?=.*Outcome delivered: yes\|no)(?=.*re-run the as-built review)/),
    );
  });

  it('renders the BLOCKED findings parser detail', () => {
    expect(renderAsBuiltInvalidReason({
      kind: 'invalid',
      cause: 'unparseable-blocked-findings',
      detail: 'missing findings table',
    })).toEqual(expect.stringMatching(/(?=.*BLOCKED findings block)(?=.*missing findings table)/));
  });

  it.each([
    ['a delivered PLAN_GAP', 'Verdict: PLAN_GAP\nOutcome delivered: yes', { kind: 'plan-gap-delivered' }],
    ['an undelivered PLAN_GAP', 'Verdict: PLAN_GAP\nOutcome delivered: no', { kind: 'plan-gap-undelivered' }],
    [
      'a remediable BLOCKED report',
      [
        'Verdict: BLOCKED',
        '',
        '## Blocking Findings',
        '| Finding | Class | Governing clause | Summary |',
        '| --- | --- | --- | --- |',
        '| ARCH-1 | REMEDIABLE | Task 2 | Add the missing guard |',
      ].join('\n'),
      { kind: 'blocked-remediable' },
    ],
    [
      'a design BLOCKED report',
      [
        'Verdict: BLOCKED',
        '',
        '## Blocking Findings',
        '| Finding | Class | Governing clause | Summary |',
        '| --- | --- | --- | --- |',
        '| ARCH-1 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
      ].join('\n'),
      {
        kind: 'blocked-design',
        designFindings: [{ id: 'ARCH-1', clause: 'adr-2026-08-25-example decision 3' }],
      },
    ],
  ])('keeps %s classified through the invalid-cause split', (_description, report, expected) => {
    expect(classifyAsBuiltReviewOutcome(report)).toEqual(expected);
  });

  it('keeps a marker-only Verdict invalid without PLAN_GAP guidance', () => {
    const outcome = classifyAsBuiltReviewOutcome('Verdict: **');
    if (outcome.kind !== 'invalid') throw new Error('expected an invalid as-built outcome');

    expect({ outcome, reason: renderAsBuiltInvalidReason(outcome) }).toEqual({
      outcome: { kind: 'invalid', cause: 'no-verdict-line' },
      reason: expect.not.stringContaining('PLAN_GAP'),
    });
  });

  it('keeps non-BLOCKED outcomes unchanged without a findings table', () => {
    expect(classifyAsBuiltReviewOutcome('Verdict: APPROVED')).toEqual({ kind: 'approved' });
    expect(classifyAsBuiltReviewOutcome('Verdict: APPROVED WITH DRIFT NOTES')).toEqual({ kind: 'approved' });
    expect(classifyAsBuiltReviewOutcome('Verdict: PLAN_GAP\nOutcome delivered: yes')).toEqual({ kind: 'plan-gap-delivered' });
    expect(classifyAsBuiltReviewOutcome('Verdict: PLAN_GAP\nOutcome delivered: no')).toEqual({ kind: 'plan-gap-undelivered' });
  });

  it('accepts a delivered PLAN_GAP as a recorded non-blocking verdict', async () => {
    const dir = await fixture();
    await writeAsBuilt(dir, 'Verdict: PLAN_GAP\nOutcome delivered: yes\n\n## Recorded Findings\n- Plan is the limit.\n');

    await expect(
      checkStepCompletion(dir, 'architecture_review_as_built', { sessionStartedAt: Date.now() - 1_000 }),
    ).resolves.toMatchObject({ done: true });
  });

  it('returns the missing-verdict-line reason through the as-built completion predicate', async () => {
    const dir = await fixture();
    await writeAsBuilt(dir, '## Verdict\n\n**BLOCKED**\n');

    await expect(
      checkStepCompletion(dir, 'architecture_review_as_built', { sessionStartedAt: Date.now() - 1_000 }),
    ).resolves.toMatchObject({
      done: false,
      reason: renderAsBuiltInvalidReason({ kind: 'invalid', cause: 'no-verdict-line' }),
      routeClass: 'absent',
    });
  });

  it('keeps undelivered PLAN_GAP, blocked-design, and missing verdict reports unsatisfied', async () => {
    const dir = await fixture();
    const ctx = { sessionStartedAt: Date.now() - 1_000 };

    await writeAsBuilt(dir, 'Verdict: PLAN_GAP\nOutcome delivered: no\n');
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({ done: false });

    await writeAsBuilt(dir, [
      'Verdict: BLOCKED',
      '',
      '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| ARCH-1 | DESIGN | adr-2026-08-25-example decision 3 | Choose an incompatible policy |',
    ].join('\n'));
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({
      done: false,
      reason:
        'as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): ' +
        'ARCH-1 (adr-2026-08-25-example decision 3)',
    });

    await writeAsBuilt(dir, '# As-built review\n');
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({ done: false });
  });

  it('names a remediable verdict as a repair and names only DESIGN findings in a mixed verdict', async () => {
    const dir = await fixture();
    const ctx = { sessionStartedAt: Date.now() - 1_000 };
    await writeAsBuilt(dir, [
      'Verdict: BLOCKED', '', '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-1 | REMEDIABLE | Task 1 | Fix it |',
      '| AB-2 | REMEDIABLE | Task 2 | Fix it too |',
    ].join('\n'));
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({
      reason: expect.stringContaining('every blocking finding is REMEDIABLE'),
    });
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({
      reason: expect.stringContaining('a repair, not a decision'),
    });

    await writeAsBuilt(dir, [
      'Verdict: BLOCKED', '', '## Blocking Findings',
      '| Finding | Class | Governing clause | Summary |',
      '| --- | --- | --- | --- |',
      '| AB-1 | DESIGN | ADR-example decision 1 | Decide it |',
      '| AB-2 | REMEDIABLE | Task 2 | Fix it |',
    ].join('\n'));
    await expect(checkStepCompletion(dir, 'architecture_review_as_built', ctx)).resolves.toMatchObject({
      reason: expect.stringContaining('AB-1 (ADR-example decision 1)'),
    });
    const result = await checkStepCompletion(dir, 'architecture_review_as_built', ctx);
    expect(result.done ? '' : result.reason).not.toContain('AB-2');
  });
});

describe('as-built SHIP routing', () => {
  async function seedSerialAsBuilt(dir: string, statePath: string): Promise<void> {
    const state: Record<string, unknown> = {
      feature_desc: 'as-built-lifecycle',
      complexity_tier: 'L',
      track: 'technical',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'architecture_review_as_built') break;
      state[step.name] = 'done';
    }
    Object.assign(state, {
      manual_test: 'skipped',
      prd_audit: 'skipped',
      architecture_review_as_built: 'pending',
      rebase: 'skipped',
      finish: 'done',
    });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await Promise.all([
      writeState(statePath, state as ConductState),
      writeFile(
        join(dir, '.docs', 'plans', 'as-built-lifecycle.md'),
        [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n'),
      ),
      writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      ),
    ]);
  }

  const REMEDIABLE_REPORT = [
    'Verdict: BLOCKED',
    '',
    '## Blocking Findings',
    '| Finding | Class | Governing clause | Summary |',
    '| --- | --- | --- | --- |',
    '| ARCH-1 | REMEDIABLE | Task 1 | Add the approved guard |',
  ].join('\n');

  async function runSerialAsBuiltExit(input: {
    report: string;
    remediationEnabled?: boolean;
    priorLap?: boolean;
    projectionRefusal?: boolean;
    writeRemediationPlan?: boolean;
  }): Promise<ConductorEvent[]> {
    const dir = await fixture();
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await seedSerialAsBuilt(dir, statePath);
    if (input.priorLap) {
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {
          architecture_review_as_built: {
            count: 0,
            cumulative: 0,
            treeHash: null,
            lastReason: '',
            priorVerdict: true,
            resolvedBefore: 0,
            laps: 1,
          },
        },
      } as never);
    }
    const events = new ConductorEventEmitter();
    const observed: ConductorEvent[] = [];
    for (const type of ['step_started', 'step_completed', 'step_failed', 'kickback', 'loop_halt'] as const) {
      events.on(type, (event) => { observed.push(event); });
    }
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'architecture_review_as_built') {
          await writeAsBuilt(dir, input.report);
        } else if (step === 'remediate' && input.writeRemediationPlan !== false) {
          await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'ARCH-1',
              disposition: 'build',
              category: null,
              rationale: 'Add the approved guard.',
              tasks: [{ id: 'approved-guard', title: 'Add the approved guard' }],
            }],
          }));
        } else if (step === 'build') {
          return { success: false, error: 'stop after lifecycle route' };
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'architecture_review_as_built',
      maxRetries: 1,
      config: {
        architecture_review_as_built: {
          remediation: { enabled: input.remediationEnabled ?? true },
          max_remediation_laps: 2,
        },
      } as never,
    });
    if (input.projectionRefusal) {
      vi.spyOn(
        conductor as unknown as {
          projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
        },
        'projectPendingAsBuiltRemediationFindings',
      ).mockResolvedValue('forced projection refusal');
    }
    await conductor.run();
    return observed;
  }

  function expectOneAsBuiltTerminalBefore(
    observed: readonly ConductorEvent[],
    nextType: 'kickback' | 'loop_halt',
  ): void {
    const started = observed.filter(
      (event) => event.type === 'step_started' && event.step === 'architecture_review_as_built',
    );
    const terminals = observed.filter(
      (event) =>
        (event.type === 'step_completed' || event.type === 'step_failed') &&
        event.step === 'architecture_review_as_built',
    );
    const terminalIndex = observed.findIndex(
      (event) =>
        (event.type === 'step_completed' || event.type === 'step_failed') &&
        event.step === 'architecture_review_as_built',
    );
    const nextIndex = observed.findIndex((event) => event.type === nextType);
    expect({ starts: started.length, terminals: terminals.length, terminalBeforeExit: terminalIndex < nextIndex })
      .toEqual({ starts: 1, terminals: 1, terminalBeforeExit: true });
  }

  it('emits one terminal before each remediable route, cap halt, design halt, and invalid halt', async () => {
    const remediable = await runSerialAsBuiltExit({ report: REMEDIABLE_REPORT });
    expectOneAsBuiltTerminalBefore(remediable, 'kickback');

    const cap = await runSerialAsBuiltExit({ report: REMEDIABLE_REPORT, priorLap: true });
    expectOneAsBuiltTerminalBefore(cap, 'loop_halt');

    const design = await runSerialAsBuiltExit({
      report: REMEDIABLE_REPORT.replace('REMEDIABLE', 'DESIGN'),
    });
    expectOneAsBuiltTerminalBefore(design, 'loop_halt');

    const invalid = await runSerialAsBuiltExit({ report: 'Verdict: BLOCKED\n' });
    expectOneAsBuiltTerminalBefore(invalid, 'loop_halt');
  });

  it('keeps a kill-switch-disabled remediable report as a needs-human halt with one terminal', async () => {
    const observed = await runSerialAsBuiltExit({
      report: REMEDIABLE_REPORT,
      remediationEnabled: false,
    });

    expectOneAsBuiltTerminalBefore(observed, 'loop_halt');
    const halt = observed.find((event) => event.type === 'loop_halt');
    expect(halt).toMatchObject({
      reason: expect.stringContaining('as-built review verdict is BLOCKED'),
    });
    expect(observed.some((event) => event.type === 'kickback')).toBe(false);
  });

  async function runGroupedAsBuiltExit(input: {
    report: string;
    priorLap?: boolean;
    maxRemediationLaps?: number;
    projectionRefusal?: boolean;
    remediationEnabled?: boolean;
    daemon?: boolean;
    writeRemediationPlan?: boolean;
    staleRemediationPlan?: boolean;
  }): Promise<ConductorEvent[]> {
    const dir = await fixture();
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    const slug = 'as-built-group-lifecycle';
    const state: Record<string, unknown> = {
      feature_desc: slug,
      complexity_tier: 'L',
      track: 'product',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'manual_test') break;
      state[step.name] = 'done';
    }
    Object.assign(state, {
      manual_test: 'pending',
      prd_audit: 'pending',
      architecture_review_as_built: 'pending',
      rebase: 'skipped',
      finish: 'done',
    });
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await Promise.all([
      writeState(statePath, state as ConductState),
      writeFile(
        join(dir, '.docs', 'plans', `${slug}.md`),
        [1, 2, 3, 4].map((id) => `### Task ${id}: Existing work ${id}`).join('\n'),
      ),
      writeFile(
        join(dir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      ),
    ]);
    if (input.priorLap) {
      await writeKickbackLedger(dir, {
        version: 1,
        gates: {
          architecture_review_as_built: {
            count: 0,
            cumulative: 0,
            treeHash: null,
            lastReason: '',
            priorVerdict: true,
            resolvedBefore: 0,
            laps: input.priorLap ? 1 : 0,
          },
        },
      } as never);
    }
    const events = new ConductorEventEmitter();
    const observed: ConductorEvent[] = [];
    for (const type of ['parallel_started', 'parallel_completed', 'parallel_failure', 'step_refused', 'kickback', 'loop_halt'] as const) {
      events.on(type, (event) => { observed.push(event); });
    }
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'manual_test') {
          await writeFile(join(dir, '.pipeline', 'manual-test-results.md'), '| Story | Result |\n| --- | --- |\n| S1 | PASS |\n');
        } else if (step === 'prd_audit') {
          await writeFile(join(dir, '.pipeline', 'prd-audit.md'), [
            '**PRD:** none',
            '',
            '## Verdict Table',
            '| Criterion | Grade | Plan task | PRD: | Evidence |',
            '| --- | --- | --- | --- | --- |',
            '| S1.1 | PASS | — | FR-1 | evidence.ts:1 |',
          ].join('\n'));
        } else if (step === 'architecture_review_as_built') {
          await writeAsBuilt(dir, input.report);
        } else if (step === 'remediate' && input.writeRemediationPlan !== false) {
          await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'ARCH-1', disposition: 'build', category: null,
              rationale: 'Add the approved guard.',
              tasks: [{ id: 'approved-guard', title: 'Add the approved guard' }],
            }],
          }));
          if (input.staleRemediationPlan) {
            // Predate the session: the reader classifies an mtime before
            // session_started_at as a stale plan.
            const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
            await utimes(join(dir, '.pipeline', 'remediation.json'), past, past);
          }
        } else if (step === 'build') {
          return { success: false, error: 'stop after lifecycle route' };
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: input.daemon ?? true,
      verifyArtifacts: true,
      fromStep: 'manual_test',
      maxRetries: 1,
      config: {
        architecture_review_as_built: {
          remediation: { enabled: input.remediationEnabled ?? true },
          max_remediation_laps: input.maxRemediationLaps ?? 2,
        },
      } as never,
    });
    if (input.projectionRefusal) {
      vi.spyOn(
        conductor as unknown as {
          projectPendingAsBuiltRemediationFindings: () => Promise<string | undefined>;
        },
        'projectPendingAsBuiltRemediationFindings',
      ).mockResolvedValue('forced projection refusal');
    }
    await conductor.run();
    return observed;
  }

  function expectOneGroupTerminalBefore(
    observed: readonly ConductorEvent[],
    nextType: 'kickback' | 'loop_halt',
  ): void {
    const started = observed.filter(
      (event) => event.type === 'parallel_started' && event.step === 'manual_test',
    );
    const terminals = observed.filter(
      (event) =>
        (event.type === 'parallel_completed' || event.type === 'parallel_failure') &&
        event.step === 'manual_test',
    );
    const terminalIndex = observed.findIndex(
      (event) =>
        (event.type === 'parallel_completed' || event.type === 'parallel_failure') &&
        event.step === 'manual_test',
    );
    const nextIndex = observed.findIndex((event) => event.type === nextType);
    expect({ starts: started.length, terminals: terminals.length, terminalBeforeExit: terminalIndex < nextIndex })
      .toEqual({ starts: 1, terminals: 1, terminalBeforeExit: true });
  }

  it('closes the validation-group lifecycle exactly once for each as-built route and halt', async () => {
    const remediable = await runGroupedAsBuiltExit({ report: REMEDIABLE_REPORT });
    expectOneGroupTerminalBefore(remediable, 'kickback');

    const cap = await runGroupedAsBuiltExit({
      report: REMEDIABLE_REPORT,
      priorLap: true,
      maxRemediationLaps: 1,
    });
    expectOneGroupTerminalBefore(cap, 'loop_halt');

    const design = await runGroupedAsBuiltExit({
      report: REMEDIABLE_REPORT.replace('REMEDIABLE', 'DESIGN'),
    });
    expectOneGroupTerminalBefore(design, 'loop_halt');

    const invalid = await runGroupedAsBuiltExit({ report: 'Verdict: BLOCKED\n' });
    expectOneGroupTerminalBefore(invalid, 'loop_halt');
  });

  it.each([
    {
      name: 'remediation is disabled',
      input: { remediationEnabled: false },
      cause: 'remediation is disabled by architecture_review_as_built.remediation.enabled',
    },
    {
      name: 'the run is not a daemon',
      input: { daemon: false },
      cause: 'remediation runs only in daemon mode',
    },
    {
      name: 'the planner writes no remediation plan',
      input: { writeRemediationPlan: false },
      cause: 'the planner wrote no remediation plan',
    },
  ])('renders the remediable group-halt cause and findings when $name', async ({ input, cause }) => {
    const observed = await runGroupedAsBuiltExit({ report: REMEDIABLE_REPORT, ...input });
    const halt = observed.find((event) => event.type === 'loop_halt');

    expect(halt).toMatchObject({
      reason: expect.stringContaining(`remediation did not route: ${cause}`),
    });
    expect(halt?.reason).toContain('Blocking findings:');
    expect(halt?.reason).toContain('ARCH-1 (REMEDIABLE;');
    expect(halt?.reason).not.toContain('shipped code violates an approved architecture decision');
    expect(observed.some((event) => event.type === 'kickback')).toBe(false);
  });

  it('renders the stale-plan group-halt cause and lists the REMEDIABLE finding with its clause', async () => {
    const observed = await runGroupedAsBuiltExit({ report: REMEDIABLE_REPORT, staleRemediationPlan: true });
    const halt = observed.find((event) => event.type === 'loop_halt');

    expect(halt?.reason).toContain('stale');
    expect(halt?.reason).toContain('Blocking findings:');
    expect(halt?.reason).toContain('ARCH-1 (REMEDIABLE; Task 1');
    expect(observed.some((event) => event.type === 'kickback')).toBe(false);
  });

  it('renders the Blocking findings listing exactly once for a DESIGN-class group halt', async () => {
    const observed = await runGroupedAsBuiltExit({
      report: REMEDIABLE_REPORT.replace('REMEDIABLE', 'DESIGN'),
    });
    const halt = observed.find((event) => event.type === 'loop_halt');

    expect((halt?.reason ?? '').split('Blocking findings:').length - 1).toBe(1);
  });

  it('keeps the no-verdict-line group halt free of findings and remediation wording', async () => {
    const observed = await runGroupedAsBuiltExit({ report: '# As-Built Architecture Review\n\nNo verdict here.\n' });
    const halt = observed.find((event) => event.type === 'loop_halt');

    expect(halt).toBeDefined();
    expect(halt?.reason).not.toContain('Blocking findings:');
    expect(halt?.reason).not.toContain('remediation did not route');
  });

  it('names the planner no-plan cause and lists the findings on the serial as-built halt', async () => {
    const observed = await runSerialAsBuiltExit({ report: REMEDIABLE_REPORT, writeRemediationPlan: false });
    const halt = observed.find((event) => event.type === 'loop_halt');

    expect(halt?.reason).toContain('remediation did not route: the planner wrote no remediation plan');
    expect(halt?.reason).toContain('Blocking findings:');
    expect(halt?.reason).toContain('ARCH-1 (REMEDIABLE;');
    expect(observed.some((event) => event.type === 'kickback')).toBe(false);
  });

  it('names the parser fault when the validation-group as-built report is invalid', async () => {
    const observed = await runGroupedAsBuiltExit({ report: 'Verdict: BLOCKED\n' });

    expect(observed.find((event) => event.type === 'loop_halt')).toMatchObject({
      reason: expect.stringContaining(
        'Blocking Findings parse fault: As-built BLOCKED report is missing its Blocking Findings table.',
      ),
    });
  });

  it('closes serial and validation-group executions before projection-refusal halts', async () => {
    const serial = await runSerialAsBuiltExit({
      report: 'Verdict: APPROVED\n',
      projectionRefusal: true,
    });
    expectOneAsBuiltTerminalBefore(serial, 'loop_halt');

    const grouped = await runGroupedAsBuiltExit({
      report: 'Verdict: APPROVED\n',
      projectionRefusal: true,
    });
    expectOneGroupTerminalBefore(grouped, 'loop_halt');
  });

  it('records only the capped prd_audit addition from a validation group with prd and as-built evidence, then halts on as-built BLOCKED', async () => {
    const dir = await fixture();
    const pipeline = join(dir, '.pipeline');
    const statePath = join(pipeline, 'conduct-state.json');
    const slug = 'as-built-verdict';
    await Promise.all([
      mkdir(join(dir, '.docs', 'plans'), { recursive: true }),
      mkdir(join(dir, '.docs', 'stories'), { recursive: true }),
      mkdir(join(dir, '.docs', 'specs'), { recursive: true }),
    ]);
    await writeFile(join(dir, '.docs', 'plans', `${slug}.md`), '# Plan\n\n### Task 1: existing work\n\n**Files:** src/feature.ts\n\n**Criterion:** S1.1\n');
    await writeFile(join(dir, '.docs', 'stories', `${slug}.md`), '# Stories\n\n## Story 1\n\n### Happy Path\n\n- Given x, when y, then z.\n');
    await writeFile(join(dir, '.docs', 'specs', `${slug}.md`), '# PRD\n\n## Functional Requirements\n\n- **FR-1:** The requested result exists.\n');
    await writeFile(join(pipeline, 'task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));

    const fromIndex = ALL_STEPS.findIndex((step) => step.name === 'manual_test');
    const state: Record<string, unknown> = {
      feature_desc: slug,
      complexity_tier: 'L',
      track: 'product',
      run_started_at: Date.now() - 1_000,
    };
    for (const [index, step] of ALL_STEPS.entries()) state[step.name] = index < fromIndex ? 'done' : 'pending';
    state.rebase = 'done';
    state.finish = 'done';
    await writeState(statePath, state as ConductState);

    const calls: StepName[] = [];
    const remediationReasons: string[] = [];
    const events = new ConductorEventEmitter();
    const kicks: Array<{ from: string; to: string }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kicks.push({ from: event.from, to: event.to });
    });
    const runner: StepRunner = {
      run: vi.fn(async (step, _state, options) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(join(pipeline, 'manual-test-results.md'), '| Story | Result |\n|---|---|\n| S1 | PASS |\n');
        } else if (step === 'prd_audit') {
          await writeFile(join(pipeline, 'prd-audit.md'), [
            '**PRD:** present',
            '',
            '## Verdict Table',
            '| Criterion | Grade | Plan task | Evidence |',
            '|---|---|---|---|',
            '| S1.1 | FIXABLE | 1 | Missing implementation |',
            '',
            '## FR Evidence',
            '| FR | Verdict | Gap-class | Evidence | Accepted? |',
            '|---|---|---|---|---|',
            '| FR-1 | MISSING | impl-gap | src/feature.ts:1 | no |',
          ].join('\n'));
        } else if (step === 'architecture_review_as_built') {
          await writeAsBuilt(dir, 'Verdict: BLOCKED\n');
        } else if (step === 'remediate') {
          remediationReasons.push(options?.retryReason ?? '');
          await writeFile(join(pipeline, 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'S1.1',
              disposition: 'build',
              category: null,
              rationale: 'implement the existing planned task',
              tasks: [{ id: 'S1.1-fix', title: 'Implement the missing planned behavior' }],
            }, {
              id: 'ARCH-1',
              disposition: 'build',
              category: null,
              rationale: 'This as-built concern remains terminal in this round.',
              tasks: [{ id: 'arch-fix', title: 'Do not append this as-built task' }],
            }],
          }));
        }
        return { success: true };
      }),
      resetSession: async () => {},
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      fromStep: 'manual_test',
      verifyArtifacts: true,
      maxRetries: 1,
      config: {
        prd_audit: { max_appended_ratio: 1 },
      } as never,
      git: async (args) => args.includes('--symbolic-full-name') ? { stdout: 'refs/remotes/origin/feature/as-built-verdict\n' } : { stdout: '' },
    });

    await conductor.run();

    expect(calls).toContain('remediate');
    expect(calls).not.toContain('build');
    expect(kicks).not.toContainEqual(expect.objectContaining({ to: 'build' }));
    expect(remediationReasons).toEqual([
      expect.stringContaining('.pipeline/prd-audit.md'),
    ]);
    expect(remediationReasons[0]).toContain('.pipeline/architecture-review-as-built.md');
    await expect(readFile(join(pipeline, 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    const plan = await readFile(join(dir, '.docs', 'plans', `${slug}.md`), 'utf8');
    expect(plan).toContain('rem-prd-audit-S1.1-fix');
    expect(plan).not.toContain('architecture-review-as-built');
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 1 } },
      growth: { added: 1, byGate: { prd_audit: 1 } },
    });
  });
});
