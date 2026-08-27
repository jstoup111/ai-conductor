// Covers: task:4
// Test: coherence artifact parser (coherence-validator.ts)
//
// Covers parseCoherenceArtifact(text | null):
//   - well-formed table → typed rows across all four row classes
//   - missing file (null input) → 'missing-coherence-artifact'
//   - zero-byte/whitespace-only text → 'empty-coherence-artifact'
//   - corrupted/unparseable table → 'unparseable-coherence-artifact'
//   - three distinct error kinds, never collapsed into one generic error

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseCoherenceArtifact,
  crossCheckIds,
  checkAdrCoverage,
  checkOutcomeCoverage,
  checkFrCoverage,
  checkStoryFrTieOut,
  checkStoryCoverage,
  checkCriterionCoverage,
  checkOrphanTasks,
  checkCoverageTableConsistency,
  renderGapReport,
  validateCoherence,
  scanDuplicateClaim,
  advisoryDuplicateClaimWarn,
  resolveRequiredLayers,
  runCoherenceGate,
  type CrossCheckInputs,
  type CoherenceGap,
  type ValidateCoherenceInputs,
} from '../../../src/engine/engineer/coherence-validator.js';
import { evaluateCoherenceWaiver } from '../../../src/engine/engineer/coherence-waiver.js';
import { extractAuthoritativeStoryCriteria } from '../../../src/engine/artifacts.js';
import { AuthoringGuard } from '../../../src/engine/engineer/authoring-guard.js';
import type { GitRunner, GitResult } from '../../../src/engine/rebase.js';
import type { RunOverlapScanArgs } from '../../../src/engine/overlap-scan.js';

const execFile = promisify(execFileCallback);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd });
}

// A scripted GitRunner: matches argv prefixes to canned results, and records
// every invocation so tests can assert zero-network-call behavior.
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  return { git, calls };
}

const WELL_FORMED = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, task-1 | covered | "ship the widget" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets ship" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
`;

describe('parseCoherenceArtifact', () => {
  it('parses a well-formed table into typed rows across all four row classes', () => {
    const result = parseCoherenceArtifact(WELL_FORMED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(4);

    const outcome = result.rows.find((r) => r.rowClass === 'outcome');
    expect(outcome).toEqual({
      rowClass: 'outcome',
      id: 'outcome-1',
      citedIds: ['story-1', 'task-1'],
      verdict: 'covered',
      quote: 'ship the widget',
    });

    const fr = result.rows.find((r) => r.rowClass === 'fr');
    expect(fr).toEqual({
      rowClass: 'fr',
      id: 'FR-1',
      citedIds: ['story-1'],
      verdict: 'covered',
      quote: 'FR-1: widgets ship',
    });

    const story = result.rows.find((r) => r.rowClass === 'story');
    expect(story).toEqual({
      rowClass: 'story',
      id: 'story-1',
      citedIds: ['task-1', 'task-2'],
      verdict: 'covered',
      quote: 'As a user...',
    });

    const task = result.rows.find((r) => r.rowClass === 'task');
    expect(task).toEqual({
      rowClass: 'task',
      id: 'task-1',
      citedIds: ['story-1'],
      verdict: 'covered',
      quote: 'Task 1: build widget',
    });
  });

  it('parses an adr row class', () => {
    const result = parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-2026-08-10 | story-1 | covered | "records the decision" |
`);

    expect(result).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'adr',
          id: 'adr-2026-08-10',
          citedIds: ['story-1'],
          verdict: 'covered',
          quote: 'records the decision',
        },
      ],
    });
  });

  it('parses a criterion row with its task evidence and optional disposition', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget, when shipped, then it arrives. | task-1, task-2 | covered | "Task 2 ships the widget." |  |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'criterion',
          criterion: 'Given a widget, when shipped, then it arrives.',
          citedIds: ['task-1', 'task-2'],
          verdict: 'covered',
          quote: 'Task 2 ships the widget.',
          disposition: undefined,
        },
      ],
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '  '],
  ])('defers a %s criterion quote to coverage validation', (_label, quote) => {
    const literalCriterion = 'Given a widget, when shipped, then it arrives.';
    const criterion = `Story 1 happy: ${literalCriterion}`;
    const stories = `# Stories

## Story 1: Widget

### Happy Path
- ${literalCriterion}
`;
    const plan = `# Plan

### Task 1: Ship widget
**Story:** Story 1
**Type:** happy-path

Ship the widget with arrival tracking.
`;
    const parsed = parseCoherenceArtifact(
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | ${criterion} | task-1 | covered | "${quote}" | diff-local |
`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const emptyQuoteResult = checkCriterionCoverage(parsed.rows, stories, plan);
    expect(emptyQuoteResult).toEqual({
      ok: false,
      reason: 'criterion-gap',
      gaps: [
        expect.objectContaining({
          gapId: 'criterion:quote-empty:1',
          detail: expect.stringContaining(literalCriterion),
        }),
      ],
    });

    const missingTaskResult = checkCriterionCoverage(
      [
        {
          rowClass: 'criterion',
          criterion,
          citedIds: ['task-99'],
          verdict: 'covered',
          quote: 'Ship the widget with arrival tracking.',
          disposition: 'diff-local',
        },
      ],
      stories,
      plan,
    );
    expect(missingTaskResult).toEqual({
      ok: false,
      reason: 'criterion-gap',
      gaps: [
        expect.objectContaining({
          gapId: 'criterion:task-missing:1:99',
          detail: expect.stringContaining('which does not exist in the plan'),
        }),
      ],
    });
    if (emptyQuoteResult.ok || missingTaskResult.ok) return;
    expect(emptyQuoteResult.gaps[0].detail).not.toBe(missingTaskResult.gaps[0].detail);
    expect(emptyQuoteResult.gaps[0].detail).toContain('empty coverage quote');
  });

  it('rejects a criterion row with no cited task evidence as criterion-specific unparseable data', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget, when shipped, then it arrives. |  | covered | "Task 2 ships the widget." | diff-local |
`),
    ).toEqual({
      ok: false,
      reason: 'unparseable-criterion-row',
      detail: { line: 3, message: 'criterion row must cite at least one task id' },
    });
  });

  it.each(['covered', 'gap', 'fail'] as const)(
    'parses the closed criterion verdict %s as its typed value',
    (verdict) => {
      expect(
        parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget, when shipped, then it arrives. | task-1 | ${verdict} | "Task 1 owns the widget." | diff-local |
`),
      ).toEqual({
        ok: true,
        rows: [
          {
            rowClass: 'criterion',
            criterion: 'Given a widget, when shipped, then it arrives.',
            citedIds: ['task-1'],
            verdict,
            quote: 'Task 1 owns the widget.',
            disposition: 'diff-local',
          },
        ],
      });
    },
  );

  it('rejects probably-covered for the named criterion with the criterion-specific parse reason', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget, when shipped, then it arrives. | task-1 | probably-covered | "Task 1 owns the widget." | diff-local |
`),
    ).toMatchObject({
      ok: false,
      reason: 'unparseable-criterion-row',
      detail: { line: 3, message: expect.stringContaining('probably-covered') },
    });
  });

  it('keeps legacy rows affirmative-by-default for an unknown verdict', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| story | story-1 | task-1 | probably-covered | "Task 1 owns the widget." |
`),
    ).toEqual({
      ok: true,
      rows: [
        {
          rowClass: 'story',
          id: 'story-1',
          citedIds: ['task-1'],
          verdict: 'probably-covered',
          quote: 'Task 1 owns the widget.',
        },
      ],
    });
  });

  it('rejects the unknown decision row class after allowing adr', () => {
    expect(
      parseCoherenceArtifact(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| decision | adr-2026-08-10 | story-1 | covered | "records the decision" |
`),
    ).toMatchObject({
      ok: false,
      reason: 'unparseable-coherence-artifact',
      detail: { line: 3, message: expect.stringContaining('decision') },
    });
  });

  it('rejects a missing file (null input) as missing-coherence-artifact', () => {
    const result = parseCoherenceArtifact(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-coherence-artifact');
  });

  it.each(['', '   ', '\n\n\t  \n'])(
    'rejects zero-byte/whitespace-only text %p as empty-coherence-artifact',
    (input) => {
      const result = parseCoherenceArtifact(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('empty-coherence-artifact');
    },
  );

  it.each([
    ['prose with no table at all', 'not a table, just prose about the feature.'],
    ['a header row but no data rows', '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n'],
    [
      'a row with a missing column',
      '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| outcome | outcome-1 | story-1 |\n',
    ],
    [
      'a row with an unrecognized row class',
      '| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| widget | outcome-1 | story-1 | covered | "x" |\n',
    ],
  ])('rejects corrupted table (%s) as unparseable-coherence-artifact', (_label, input) => {
    const result = parseCoherenceArtifact(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unparseable-coherence-artifact');
  });

  it('produces three distinct error kinds, never a single generic error', () => {
    const missing = parseCoherenceArtifact(null);
    const empty = parseCoherenceArtifact('   ');
    const unparseable = parseCoherenceArtifact('garbled nonsense');
    expect(missing.ok).toBe(false);
    expect(empty.ok).toBe(false);
    expect(unparseable.ok).toBe(false);
    if (missing.ok || empty.ok || unparseable.ok) return;
    const reasons = new Set([missing.reason, empty.reason, unparseable.reason]);
    expect(reasons.size).toBe(3);
  });
});

describe('crossCheckIds', () => {
  const STORIES_TEXT = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;

  const PLAN_TEXT = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Ship widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/ship.ts
`;

  const PRD_TEXT = `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`;

  const OUTCOME_BULLETS = ['- Ship widgets reliably.', '- Support returns.'];

  const WELL_FORMED_REAL = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "ship widgets" |
| outcome | outcome-2 | story-2 | covered | "support returns" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets" |
| fr | FR-2 | story-2 | covered | "FR-2: widgets" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| story | story-2 | task-1 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
| task | task-2 | story-1 | covered | "Task 2: ship widget" |
`;

  function inputsFor(overrides: Partial<CrossCheckInputs> = {}): CrossCheckInputs {
    return {
      storiesText: STORIES_TEXT,
      planText: PLAN_TEXT,
      prdText: PRD_TEXT,
      outcomeCount: OUTCOME_BULLETS.length,
      ...overrides,
    };
  }

  function parsedRows(text: string) {
    const result = parseCoherenceArtifact(text);
    if (!result.ok) throw new Error('fixture must parse');
    return result.rows;
  }

  it('passes when every cited id resolves against real stories/plan/PRD/outcome inputs', () => {
    const result = crossCheckIds(parsedRows(WELL_FORMED_REAL), inputsFor());
    expect(result).toEqual({ ok: true });
  });

  it('accepts an ADR row whose id resolves against the supplied ADR pool', () => {
    const withAdr = `${WELL_FORMED_REAL}| adr | adr-2026-08-10-coherence-pool | story-1 | covered | "records the decision" |\n`;

    expect(
      crossCheckIds(
        parsedRows(withAdr),
        inputsFor({ adrIds: new Set(['adr-2026-08-10-coherence-pool']) }),
      ),
    ).toEqual({ ok: true });
  });

  it('rejects an ADR row whose id is absent from the supplied ADR pool', () => {
    const withFabricatedAdr = `${WELL_FORMED_REAL}| adr | adr-2026-08-10-fabricated | story-1 | covered | "records the decision" |\n`;

    expect(
      crossCheckIds(
        parsedRows(withFabricatedAdr),
        inputsFor({ adrIds: new Set(['adr-2026-08-10-real']) }),
      ),
    ).toEqual({
      ok: false,
      reason: 'fabricated-id',
      rowClass: 'adr',
      rowId: 'adr-2026-08-10-fabricated',
      fabricatedId: 'adr-2026-08-10-fabricated',
    });
  });

  it('rejects a row citing a fabricated story id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| task | task-1 | story-1 | covered | "Task 1: build widget" |',
      '| task | task-1 | story-99 | covered | "Task 1: build widget" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('task');
    expect(result.rowId).toBe('task-1');
    expect(result.fabricatedId).toBe('story-99');
  });

  it('rejects a row citing a fabricated task id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| story | story-1 | task-1, task-2 | covered | "As a user..." |',
      '| story | story-1 | task-1, task-99 | covered | "As a user..." |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('story');
    expect(result.rowId).toBe('story-1');
    expect(result.fabricatedId).toBe('task-99');
  });

  it('rejects a row citing a fabricated FR id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| fr | FR-1 | story-1 | covered | "FR-1: widgets" |',
      '| fr | FR-99 | story-1 | covered | "FR-1: widgets" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('fr');
    expect(result.rowId).toBe('FR-99');
  });

  it('rejects a row citing a fabricated outcome id, naming the row', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| outcome | outcome-1 | story-1 | covered | "ship widgets" |',
      '| outcome | outcome-99 | story-1 | covered | "ship widgets" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('outcome');
    expect(result.rowId).toBe('outcome-99');
  });

  it('rejects a task row citing an id that resolves to no known class (nonexistent id in cited-ids)', () => {
    const withFabrication = WELL_FORMED_REAL.replace(
      '| task | task-2 | story-1 | covered | "Task 2: ship widget" |',
      '| task | task-2 | story-1, ghost-id | covered | "Task 2: ship widget" |',
    );
    const result = crossCheckIds(parsedRows(withFabrication), inputsFor());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fabricated-id');
    expect(result.rowClass).toBe('task');
    expect(result.rowId).toBe('task-2');
    expect(result.fabricatedId).toBe('ghost-id');
  });
});

describe('checkAdrCoverage', () => {
  function rowsFrom(text: string) {
    const result = parseCoherenceArtifact(text);
    if (!result.ok) throw new Error('fixture must parse');
    return result.rows;
  }

  it('reports an ADR pool member that has no matching adjudication row', () => {
    expect(checkAdrCoverage([], new Set(['adr-decision']))).toEqual({
      ok: false,
      reason: 'adr-gap',
      gaps: [{ gapId: 'adr-decision' }],
    });
  });

  it.each(['gap', 'fail'])('blocks an ADR row with the negative %s verdict', (verdict) => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-decision | story-1 | ${verdict} | "not adjudicated" |
`),
        new Set(['adr-decision']),
      ),
    ).toEqual({
      ok: false,
      reason: 'adr-gap',
      gaps: [{ gapId: 'adr-decision' }],
    });
  });

  it('blocks a covered ADR row without a counterpart citation', () => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-decision |  | covered | "decision recorded" |
`),
        new Set(['adr-decision']),
      ),
    ).toEqual({
      ok: false,
      reason: 'adr-gap',
      gaps: [{ gapId: 'adr-decision' }],
    });
  });

  it('treats an ADR row with an unrecognized verdict affirmatively', () => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-decision | story-1 | needs-human-review | "decision recorded" |
`),
        new Set(['adr-decision']),
      ),
    ).toEqual({ ok: true });
  });

  it('blocks an unknown-verdict ADR row without a counterpart citation', () => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-decision |  | needs-human-review | "decision recorded" |
`),
        new Set(['adr-decision']),
      ),
    ).toEqual({
      ok: false,
      reason: 'adr-gap',
      gaps: [{ gapId: 'adr-decision' }],
    });
  });

  it('passes a covered ADR row with a counterpart citation', () => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-decision | story-1 | covered | "decision recorded" |
`),
        new Set(['adr-decision']),
      ),
    ).toEqual({ ok: true });
  });

  it('passes when every ADR in the pool has a covered row', () => {
    expect(
      checkAdrCoverage(
        rowsFrom(`| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| adr | adr-first | story-1 | covered | "first decision" |
| adr | adr-second | story-1 | covered | "second decision" |
`),
        new Set(['adr-first', 'adr-second']),
      ),
    ).toEqual({ ok: true });
  });
});

describe('checkOutcomeCoverage', () => {
  const BULLETS = ['- Ship widgets reliably.', '- Support returns.'];

  function rowsFrom(text: string) {
    const result = parseCoherenceArtifact(text);
    if (!result.ok) throw new Error('fixture must parse');
    return result.rows;
  }

  it('passes silently when every outcome bullet has an affirmative row', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-2 | covered | "Support returns." |
`;
    const result = checkOutcomeCoverage(
      rowsFrom(text),
      BULLETS,
      new Set(['story-1', 'story-2']),
    );
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap outcome-<n> quoting the bullet when a bullet has no row', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS, new Set(['story-1', 'story-2']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-2');
    expect(result.gaps[0].bullet).toBe('- Support returns.');
  });

  it('reports a gap outcome-<n> when the matching row has a negative verdict', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-2 | gap | "Support returns." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS, new Set(['story-1', 'story-2']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-2');
    expect(result.gaps[0].bullet).toBe('- Support returns.');
  });

  it('reports a gap outcome-<n> when the row has an affirmative verdict but a blank Cited-Ids cell', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 |  | covered | "Support returns." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS, new Set(['story-1', 'story-2']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-2');
    expect(result.gaps[0].bullet).toBe('- Support returns.');
  });

  it('reports a gap outcome-<n> when the row cites only a non-story id despite an affirmative verdict', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | task-1 | covered | "Support returns." |
`;
    const result = checkOutcomeCoverage(rowsFrom(text), BULLETS, new Set(['story-1', 'story-2']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outcome-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-2');
    expect(result.gaps[0].bullet).toBe('- Support returns.');
  });

  it('surfaces a gap when coverage is asserted via a nonexistent story id (reuses the fabrication path)', () => {
    const text = `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "Ship widgets reliably." |
| outcome | outcome-2 | story-99 | covered | "Support returns." |
`;
    const rows = rowsFrom(text);
    const crossCheck = crossCheckIds(rows, {
      storiesText: `# Stories\n\n## Story 1: Widget shipping\n\n### Acceptance Criteria\n#### Happy Path\n- Given a widget, when shipped, then it arrives.\n`,
      planText: null,
      prdText: null,
      outcomeCount: BULLETS.length,
    });
    expect(crossCheck.ok).toBe(false);
    if (crossCheck.ok) return;
    expect(crossCheck.reason).toBe('fabricated-id');
    expect(crossCheck.fabricatedId).toBe('story-99');
  });
});

describe('checkFrCoverage', () => {
  const PRD_TEXT = `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`;

  it('passes when every PRD FR is cited by a story Requirement line and transitively by a task', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1, FR-2

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap for an FR cited by no story', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fr-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].frId).toBe('FR-2');
    expect(result.gaps[0].storyId).toBeUndefined();
  });

  it('reports a transitive gap naming both the FR and the story when the only citing story has no task', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns
**Requirement:** FR-2

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts
`;
    // FR-2 is cited by story 2, but no task cites story 2 — a transitive
    // gap, not masked as either a plain uncovered-FR or silently passing.
    const result = checkFrCoverage(PRD_TEXT, storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fr-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].frId).toBe('FR-2');
    expect(result.gaps[0].storyId).toBe('2');
  });

  it('passes trivially (no PRD, technical track) when prdText is null', () => {
    const result = checkFrCoverage(null, '## Story 1\n', '### Task 1\n');
    expect(result).toEqual({ ok: true });
  });
});

describe('checkStoryFrTieOut (PRD <-> stories tie-out, reverse direction)', () => {
  const PRD_TEXT = `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`;

  it('passes when every story Requirement line cites only FRs the PRD actually declares', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

## Story 2: Widget returns
**Requirement:** FR-2
`;
    expect(checkStoryFrTieOut(PRD_TEXT, storiesText)).toEqual({ ok: true });
  });

  it('reports a phantom-FR gap for a story citing an FR the PRD never declares', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

## Story 2: Widget teleportation
**Requirement:** FR-9
`;
    const result = checkStoryFrTieOut(PRD_TEXT, storiesText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('story-fr-gap');
    // FR-2 has no story — that is checkFrCoverage's job, not this layer's.
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toEqual({
      gapId: 'story-2',
      kind: 'phantom-fr',
      storyId: '2',
      title: 'Widget teleportation',
      frIds: ['FR-9'],
    });
  });

  it('reports an untraced-story gap for a story with no FR citation while a PRD declares FRs', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1, FR-2

## Story 2: Widget polishing
**Requirement:** none
`;
    const result = checkStoryFrTieOut(PRD_TEXT, storiesText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('story-fr-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('story-2');
    expect(result.gaps[0].kind).toBe('untraced-story');
    expect(result.gaps[0].frIds).toEqual([]);
  });

  it('reports every offending story, not just the first', () => {
    const storiesText = `# Stories

## Story 1: Widget teleportation
**Requirement:** FR-9

## Story 2: Widget polishing

## Story 3: Widget shipping
**Requirement:** FR-1, FR-2
`;
    const result = checkStoryFrTieOut(PRD_TEXT, storiesText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((g) => g.gapId)).toEqual(['story-1', 'story-2']);
    expect(result.gaps.map((g) => g.kind)).toEqual(['phantom-fr', 'untraced-story']);
  });

  it('reports a story citing both a real and a phantom FR as a phantom-fr gap naming only the phantom', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1, FR-7, FR-2, FR-8
`;
    const result = checkStoryFrTieOut(PRD_TEXT, storiesText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].kind).toBe('phantom-fr');
    expect(result.gaps[0].frIds).toEqual(['FR-7', 'FR-8']);
  });

  it('passes trivially on the technical track (prdText null) — no phantom requirement layer', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
`;
    expect(checkStoryFrTieOut(null, storiesText)).toEqual({ ok: true });
  });

  it('passes trivially when the PRD declares no FRs at all', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping
`;
    expect(checkStoryFrTieOut('# PRD\n\n## Overview\n\nProse only.\n', storiesText)).toEqual({
      ok: true,
    });
  });
});

describe('checkStoryCoverage', () => {
  it('passes when every story id is cited by ≥1 task **Story:** line', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts

### Task 2: Build returns
**Story:** Story 2 (happy path)
**Files:** src/returns.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports a gap naming the uncovered story id and title', () => {
    const storiesText = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.

## Story 2: Widget returns

### Acceptance Criteria
#### Happy Path
- Given a widget, when returned, then it is refunded.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('story-gap');
    if (result.reason !== 'story-gap') return;
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('story-2');
    expect(result.gaps[0].title).toBe('Widget returns');
  });

  it('fails closed with unparseable-stories when the stories file has zero parseable blocks', () => {
    const storiesText = `# Stories

Just some prose, no story headings at all.
`;
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Files:** src/widget.ts
`;
    const result = checkStoryCoverage(storiesText, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unparseable-stories');
  });
});

describe('checkOrphanTasks', () => {
  const STORIES_TEXT = `# Stories

## Story 1: Widget shipping

### Acceptance Criteria
#### Happy Path
- Given a widget, when shipped, then it arrives.
`;

  it('treats a task citing an existing story id as covered', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('treats an infrastructure task with a non-empty declared purpose as covered', () => {
    const planText = `# Plan

### Task 2: Test scaffolding
**Story:** none (infrastructure: test scaffolding for S2)
**Type:** infrastructure
**Files:** test/setup.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('treats a refactor task with a non-empty declared purpose as covered', () => {
    const planText = `# Plan

### Task 3: Cleanup
**Story:** none (refactor: dedupe helper functions)
**Type:** refactor
**Files:** src/util.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result).toEqual({ ok: true });
  });

  it('reports task-<id> when a task cites only nonexistent story ids', () => {
    const planText = `# Plan

### Task 4: Build gizmo
**Story:** Story 99 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('task-4');
  });

  it('reports task-<id> for an infrastructure task with an empty/missing **Story:** line', () => {
    const planText = `# Plan

### Task 5: Scaffolding
**Story:**
**Type:** infrastructure
**Files:** test/setup.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('task-5');
  });

  it('reports task-<id> when there is no **Story:** line and the type is not infrastructure/refactor', () => {
    const planText = `# Plan

### Task 6: Mystery work
**Type:** happy-path
**Files:** src/mystery.ts
`;
    const result = checkOrphanTasks(STORIES_TEXT, planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('orphan-task');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('task-6');
  });
});

describe('checkCoverageTableConsistency', () => {
  it('reports claim-<row> when a coverage-table row cites a task id absent from the task tree', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 1 | 99 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('coverage-table-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('claim-2');
    expect(result.gaps[0].detail).toContain('99');
  });

  it('reports claim-<row> when a table pair contradicts the task tree\'s actual **Story:** citations', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Build gizmo
**Story:** Story 2 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 2 | 1 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('coverage-table-gap');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('claim-2');
  });

  it('passes when the coverage table is consistent with the task tree', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Build gizmo
**Story:** Story 2 (happy path)
**Type:** happy-path
**Files:** src/gizmo.ts

## Coverage Check

| Story | Tasks |
|---|---|
| 1 | 1 |
| 2 | 2 |
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result).toEqual({ ok: true });
  });

  it('passes when the plan has no Coverage Check table at all', () => {
    const planText = `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)
**Type:** happy-path
**Files:** src/widget.ts
`;
    const result = checkCoverageTableConsistency(planText);
    expect(result).toEqual({ ok: true });
  });
});

describe('validateCoherence + renderGapReport (aggregated deterministic gap report)', () => {
  // Fixture that trivially trips three distinct gap classes at once:
  //   - outcome: the staged outcome bullet has no outcome-1 row at all
  //   - fr: FR-1 is cited by story-1, but story-1 has no covering task
  //   - story: story-1 is declared but no plan task cites it
  const storiesTextThreeGaps = `# Stories

## Story 1: Ship the widget
**Requirement:** FR-1
As a user, I want a widget.
`;
  const planTextThreeGaps = `# Plan

No tasks yet.
`;
  const threeGapInputs: ValidateCoherenceInputs = {
    rows: [],
    outcomeBullets: ['Reduce checkout latency'],
    prdText: '## Functional Requirements\n\nFR-1: widgets ship\n',
    storiesText: storiesTextThreeGaps,
    planText: planTextThreeGaps,
  };

  it('aggregates gaps from three different classes into one report', () => {
    const result = validateCoherence(threeGapInputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(3);
    const layers = result.gaps.map((g) => g.layer).sort();
    expect(layers).toEqual(['fr', 'outcome', 'story']);

    for (const gap of result.gaps) {
      expect(gap.gapId.length).toBeGreaterThan(0);
      expect(gap.artifact.length).toBeGreaterThan(0);
      expect(gap.item.length).toBeGreaterThan(0);
      expect(result.report).toContain(gap.gapId);
      expect(result.report).toContain(gap.artifact);
      expect(result.report).toContain(gap.item);
    }
  });

  it('reports the specific gap id for a single gap, not generic-only wording', () => {
    const inputs: ValidateCoherenceInputs = {
      // No outcome-1 row at all: everything else (fr/story/orphan/table)
      // is set up to pass cleanly, so exactly one gap (outcome-1) survives.
      rows: [],
      outcomeBullets: ['Reduce checkout latency'],
      prdText: null,
      storiesText: `# Stories

## Story 1: Ship the widget
**Requirement:** none
`,
      planText: `# Plan

### Task 1: Build the widget
**Story:** Story 1
**Type:** happy-path
`,
    };

    const result = validateCoherence(inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].gapId).toBe('outcome-1');
    expect(result.report).toContain('outcome-1');
    expect(result.report).toContain('Reduce checkout latency');
    // Not generic-only: the specific bullet text and id must both appear.
    expect(result.report).not.toMatch(/^# Coherence gaps\n\n- \*\*outcome-\d+\*\* \(intake outcomes\): ""\n$/);
  });

  it('surfaces a story citing a phantom FR as a story-fr layer gap in the aggregated report', () => {
    const inputs: ValidateCoherenceInputs = {
      rows: [],
      outcomeBullets: [],
      prdText: '## Functional Requirements\n\n- FR-1: widgets ship\n',
      storiesText: `# Stories

## Story 1: Ship the widget
**Requirement:** FR-1, FR-4
`,
      planText: `# Plan

### Task 1: Build the widget
**Story:** Story 1
**Type:** happy-path
`,
    };

    const result = validateCoherence(inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Coverage is complete in every existing layer — the only defect is the
    // reverse direction (a story asserting an FR the PRD never declares).
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].layer).toBe('story-fr');
    expect(result.gaps[0].gapId).toBe('story-1');
    expect(result.gaps[0].artifact).toBe('stories');
    expect(result.gaps[0].item).toContain('FR-4');
    expect(result.report).toContain('story-1');
    expect(result.report).toContain('FR-4');
  });

  it('surfaces a story with no FR citation as an untraced-story gap when the PRD declares FRs', () => {
    const inputs: ValidateCoherenceInputs = {
      rows: [],
      outcomeBullets: [],
      prdText: '## Functional Requirements\n\n- FR-1: widgets ship\n',
      storiesText: `# Stories

## Story 1: Ship the widget
**Requirement:** FR-1

## Story 2: Polish the widget
`,
      planText: `# Plan

### Task 1: Build the widget
**Story:** Story 1
**Type:** happy-path

### Task 2: Polish the widget
**Story:** Story 2
**Type:** happy-path
`,
    };

    const result = validateCoherence(inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].layer).toBe('story-fr');
    expect(result.gaps[0].gapId).toBe('story-2');
    expect(result.gaps[0].item).toMatch(/no.*Requirement/i);
  });

  it('does not run the tie-out layer on the technical track (prdText nulled by the caller)', () => {
    const inputs: ValidateCoherenceInputs = {
      rows: [],
      outcomeBullets: [],
      prdText: null,
      storiesText: `# Stories

## Story 1: Ship the widget
`,
      planText: `# Plan

### Task 1: Build the widget
**Story:** Story 1
**Type:** happy-path
`,
    };
    expect(validateCoherence(inputs)).toEqual({ ok: true });
  });

  it('runs ADR coverage only when the ADR layer is required', () => {
    const inputs: ValidateCoherenceInputs = {
      rows: [],
      outcomeBullets: [],
      prdText: null,
      storiesText: `## Story 1: Ship the widget\n`,
      planText: `### Task 1: Build the widget\n**Story:** Story 1\n`,
      adrIds: new Set(['adr-decision']),
      requiredLayers: new Set(['adr']),
    };

    const result = validateCoherence(inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(['adr-decision']);
  });

  it('produces byte-identical reports for identical gap input, twice', () => {
    const gaps: CoherenceGap[] = [
      { layer: 'story', gapId: 'story-2', artifact: 'stories', item: 'Ship the gizmo' },
      { layer: 'outcome', gapId: 'outcome-1', artifact: 'intake outcomes', item: 'Reduce latency' },
      { layer: 'orphan-task', gapId: 'task-9', artifact: 'plan', item: 'Unrelated task' },
    ];

    const first = renderGapReport(gaps);
    const second = renderGapReport([...gaps]);
    expect(first).toBe(second);

    // Deterministic sort: outcome (layer 0) before story (layer 2) before
    // orphan-task (layer 3), regardless of input order.
    const outcomeIdx = first.indexOf('outcome-1');
    const storyIdx = first.indexOf('story-2');
    const orphanIdx = first.indexOf('task-9');
    expect(outcomeIdx).toBeGreaterThan(-1);
    expect(outcomeIdx).toBeLessThan(storyIdx);
    expect(storyIdx).toBeLessThan(orphanIdx);
  });

  it('renders ADR gaps after outcome gaps in a fixed order across multi-layer reports', () => {
    const gaps: CoherenceGap[] = [
      { layer: 'story', gapId: 'story-2', artifact: 'stories', item: 'Ship the gizmo' },
      { layer: 'adr', gapId: 'adr-payment-terms', artifact: 'ADRs', item: 'payment terms are unadjudicated' },
      { layer: 'outcome', gapId: 'outcome-1', artifact: 'intake outcomes', item: 'Reduce latency' },
      { layer: 'adr', gapId: 'adr-retry-policy', artifact: 'ADRs', item: 'retry policy has failed' },
    ];

    const first = renderGapReport(gaps);
    const second = renderGapReport([...gaps]);

    expect(first).toBe(second);
    expect(first).toContain('adr-payment-terms');
    expect(first).toContain('payment terms are unadjudicated');
    expect(first).toContain('adr-retry-policy');
    expect(first).toContain('retry policy has failed');
    expect(first.indexOf('outcome-1')).toBeLessThan(first.indexOf('adr-payment-terms'));
    expect(first.indexOf('adr-payment-terms')).toBeLessThan(first.indexOf('story-2'));
    expect(first.indexOf('adr-retry-policy')).toBeLessThan(first.indexOf('story-2'));
  });

  it('renders each gap with its id, source artifact, and quoted item', () => {
    const gaps: CoherenceGap[] = [
      { layer: 'fr', gapId: 'FR-3', artifact: 'PRD', item: 'FR-3 is not cited by any story' },
    ];
    const report = renderGapReport(gaps);
    expect(report).toContain('FR-3');
    expect(report).toContain('PRD');
    expect(report).toContain('FR-3 is not cited by any story');
    // Not generic-only: the specific id must appear, not just a bare "gap" word.
    expect(report).not.toMatch(/^# Coherence gaps\n\nNo gaps found\.\n$/);
  });
});

describe('scanDuplicateClaim (Task 14, offline)', () => {
  const REF = 'acme/app#527';

  it('reports a duplicate:<ref> gap naming the conflicting slug when a default-branch intake marker carries the same Source-Ref', async () => {
    const { git, calls } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/other-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/other-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: other-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('duplicate-claim');
    expect(result.gapId).toBe(`duplicate:${REF}`);
    expect(result.conflictingSlug).toBe('other-spec');
    expect(result.gap.gapId).toBe(`duplicate:${REF}`);
    expect(result.gap.layer).toBe('duplicate-claim');
    expect(result.gap.item).toContain('other-spec');

    // Offline: only git was invoked, no gh/fetch/network call of any kind.
    expect(calls.every((c) => c[0] !== 'fetch')).toBe(true);
  });

  it('passes with zero network calls when no default-branch intake marker matches the Source-Ref', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { git, calls } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/unrelated-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/unrelated-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: unrelated-spec\n\nSource-Ref: acme/app#999\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(true);
    expect(calls.every((c) => c[0] !== 'fetch' && c[0] !== 'gh')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('excludes its own slug so a spec never flags itself as its own duplicate', async () => {
    const { git } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/this-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/this-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: this-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git, excludeSlug: 'this-spec' });
    expect(result.ok).toBe(true);
  });

  it('trivially passes when there is no usable sourceRef, with zero git/network calls', async () => {
    const { git, calls } = fakeGit([]);
    const result = await scanDuplicateClaim('/repo', 'main', undefined, { git });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('integrates the duplicate:<ref> gap id with the Task 13 waiver vocabulary', async () => {
    const { git } = fakeGit([
      {
        match: ['ls-tree', '-r', '--name-only', 'main', '--', '.docs/intake'],
        result: { exitCode: 0, stdout: '.docs/intake/other-spec.md\n' },
      },
      {
        match: ['show', 'main:.docs/intake/other-spec.md'],
        result: { exitCode: 0, stdout: `# Intake origin: other-spec\n\nSource-Ref: ${REF}\n` },
      },
    ]);

    const result = await scanDuplicateClaim('/repo', 'main', REF, { git });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const verdict = await evaluateCoherenceWaiver({
      gaps: [result.gap],
      changedFiles: [{ status: 'A', path: '.docs/coherence-waivers/my-plan.md' }],
      readText: async () =>
        `Waives: ${result.gapId}\nRationale: operator approved re-claim of the same intake.\n`,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe('ADR coherence waiver integration (Task 12)', () => {
  it.each([
    ['waives', 'adr-payment-terms', true],
    ['does not waive with a different id', 'adr-other-decision', false],
  ])('%s an ADR gap only when its exact id is named', async (_case, waivedId, expectedOk) => {
    const verdict = await evaluateCoherenceWaiver({
      gaps: [
        {
          layer: 'adr',
          gapId: 'adr-payment-terms',
          artifact: 'ADRs',
          item: 'adr-payment-terms has no affirmative adjudication row',
        },
      ],
      changedFiles: [{ status: 'A', path: '.docs/coherence-waivers/payment-terms.md' }],
      readText: async () => `Waives: ${waivedId}\nRationale: documented exception.\n`,
    });

    expect(verdict.ok).toBe(expectedOk);
  });
});

describe('advisoryDuplicateClaimWarn (fail-open, reuses overlap-scan.ts)', () => {
  it('is fail-open on a network/scan error: the warn is skipped, never throwing', async () => {
    const throwingGit: GitRunner = async () => {
      throw new Error('network error: could not resolve origin');
    };
    const args: RunOverlapScanArgs = {
      candidateFiles: ['src/foo.ts'],
      git: throwingGit,
      resolver: { resolve: vi.fn() } as unknown as RunOverlapScanArgs['resolver'],
      sourceRef: 'acme/app#527',
      localBase: 'main',
    };

    await expect(advisoryDuplicateClaimWarn(args)).resolves.toBeNull();
  });

  it('delegates to overlap-scan.ts machinery (no second scanner) and returns its report on success', async () => {
    const { git } = fakeGit([
      { match: ['symbolic-ref', 'refs/remotes/origin/HEAD'], result: { exitCode: 1 } },
      { match: ['rev-parse', '--verify', 'main'], result: { exitCode: 0 } },
      { match: ['for-each-ref'], result: { exitCode: 0, stdout: '' } },
    ]);
    const args: RunOverlapScanArgs = {
      candidateFiles: ['src/foo.ts'],
      git,
      resolver: { resolve: vi.fn(async () => ({ kind: 'unblocked' })) } as unknown as RunOverlapScanArgs['resolver'],
      sourceRef: 'acme/app#527',
      localBase: 'main',
    };

    const report = await advisoryDuplicateClaimWarn(args);
    expect(report).not.toBeNull();
    expect(report?.seamOverlaps).toEqual([]);
    expect(report?.skipNotes).toEqual([]);
  });
});

describe('resolveRequiredLayers (Task 15: tier gating, layer degradation, no-retroactivity)', () => {
  const WITH_COHERENCE = ['.docs/coherence/my-plan.md'];
  const LEGACY = ['.docs/plan/my-plan.md', 'src/foo.ts'];

  it('disengages for tier S BEFORE any other check — even with a legacy change set and no outcomes', () => {
    const result = resolveRequiredLayers('/wt', 'S', 'product', [], LEGACY);
    expect(result).toEqual({ engaged: false, reason: 'tier-exempt' });
  });

  it('disengages for tier S even when the change set carries a coherence artifact', () => {
    const result = resolveRequiredLayers('/wt', 'S', 'technical', ['outcome bullet'], WITH_COHERENCE);
    expect(result.engaged).toBe(false);
    if (result.engaged) return;
    expect(result.reason).toBe('tier-exempt');
  });

  it('disengages tier S before deriving ADR requirements', () => {
    expect(
      resolveRequiredLayers('/wt', 'S', 'product', [], [
        '.docs/coherence/foo.md',
        '.docs/decisions/adr-foo.md',
      ]),
    ).toEqual({ engaged: false, reason: 'tier-exempt' });
  });

  it('technical track marker skips the FR layer but keeps story/orphan-task/coverage-table enforced', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'technical', [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
    if (!result.engaged) return;
    expect(result.layers.has('fr')).toBe(false);
    expect(result.layers.has('story')).toBe(true);
    expect(result.layers.has('orphan-task')).toBe(true);
    expect(result.layers.has('coverage-table')).toBe(true);
  });

  it('product track requires the FR layer', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
    if (!result.engaged) return;
    expect(result.layers.has('fr')).toBe(true);
  });

  it('no staged/committed outcomes skips the outcome layer, but orphan-task stays required', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
    if (!result.engaged) return;
    expect(result.layers.has('outcome')).toBe(false);
    expect(result.layers.has('orphan-task')).toBe(true);
  });

  it('non-empty outcome bullets require the outcome layer', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', ['Desired outcome: X'], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
    if (!result.engaged) return;
    expect(result.layers.has('outcome')).toBe(true);
  });

  it('no track marker (undefined) defaults to product, per parseTrack default semantics', () => {
    const result = resolveRequiredLayers('/wt', 'M', undefined, [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
    if (!result.engaged) return;
    expect(result.layers.has('fr')).toBe(true);
  });

  it('a legacy change set (no .docs/coherence/ path) disengages the gate entirely', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', ['Desired outcome: X'], LEGACY);
    expect(result).toEqual({ engaged: false, reason: 'legacy-change-set' });
  });

  it('disengages legacy change sets before deriving ADR requirements', () => {
    expect(
      resolveRequiredLayers('/wt', 'M', 'product', [], ['.docs/decisions/adr-foo.md']),
    ).toEqual({ engaged: false, reason: 'legacy-change-set' });
  });

  it('accepts a changeSet as a Set<string> as well as an array', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], new Set(WITH_COHERENCE));
    expect(result.engaged).toBe(true);
  });

  it('M-tier engages normally: the S-tier exemption never leaks to non-S tiers', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
  });

  it('requires the ADR layer when a product coherence change set includes an ADR', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], [
      '.docs/coherence/foo.md',
      '.docs/decisions/adr-something.md',
    ]);
    expect(result.engaged && result.layers.has('adr')).toBe(true);
  });

  it('does not require the ADR layer for exact non-ADR decision filenames', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], [
      '.docs/coherence/foo.md',
      '.docs/decisions/architecture-review-something.md',
      '.docs/decisions/review-something.md',
    ]);
    expect(result.engaged && result.layers.has('adr')).toBe(false);
  });

  it('omits the ADR layer when an engaged M-tier product change set has no ADR path', () => {
    const result = resolveRequiredLayers('/wt', 'M', 'product', [], ['.docs/coherence/foo.md']);
    expect(result).toEqual({
      engaged: true,
      layers: new Set(['fr', 'story', 'criterion', 'orphan-task', 'coverage-table']),
    });
  });

  it('L-tier engages normally too', () => {
    const result = resolveRequiredLayers('/wt', 'L', 'product', [], WITH_COHERENCE);
    expect(result.engaged).toBe(true);
  });
});

describe('criterion coverage (Tasks 4-18, 24)', () => {
  const stories = `# Stories

## Story 1: Widget

### Happy Path
- Given a widget, when it ships, then it arrives

### Negative Paths
- Given a broken widget, when it ships, then it is rejected
`;
  const plan = `# Plan

### Task 1: Ship widget
**Story:** Story 1
**Type:** happy-path

Ship the widget with
arrival tracking.

### Task 2: Reject broken widget
**Story:** Story 1
**Type:** negative-path

Reject the broken widget before shipping.
`;
  const criterion = 'Story 1 happy: Given a widget, when it ships, then it arrives';
  const negativeCriterion = 'Story 1 negative: Given a broken widget, when it ships, then it is rejected';

  function rows(tableRows: string[]) {
    const parsed = parseCoherenceArtifact(
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |\n` +
        `| --- | --- | --- | --- | --- | --- |\n${tableRows.join('\n')}\n`,
    );
    expect(parsed.ok).toBe(true);
    return parsed.ok ? parsed.rows : [];
  }

  const completeRows = () =>
    rows([
      `| criterion | ${criterion} | task-1 | covered | "Ship the widget with arrival tracking." | diff-local |`,
      `| criterion | ${negativeCriterion} | task-2 | covered | "Reject the broken widget before shipping." | diff-local |`,
    ]);

  it('accepts every extracted criterion when its quote is in a cited task, including normalized whitespace', () => {
    const valid = rows([
      `| criterion | ${criterion} | task-1 | covered | "Ship the   widget with arrival tracking." | diff-local |`,
      `| criterion | ${negativeCriterion} | task-2 | covered | "Reject the broken widget before shipping." | diff-local |`,
    ]);
    expect(checkCriterionCoverage(valid, stories, plan)).toEqual({ ok: true });
  });

  // Plan Task 10 — the gate and acceptance_specs share one extractor. The
  // gate's enumeration for an empty artifact is deep-equal, in order and in
  // identity form, to `extractAuthoritativeStoryCriteria` over the same
  // stories text — the exact function `groundDispositionOnlyEvidence` calls.
  // Pointing either call site at a different extractor breaks the equality.
  it('enumerates the identical criterion set as the acceptance_specs extractor (plan Task 10)', () => {
    const authoritative = extractAuthoritativeStoryCriteria(stories);
    expect(authoritative).toEqual([criterion, negativeCriterion]);
    const result = checkCriterionCoverage([], stories, plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.criterion)).toEqual(authoritative);
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(
      authoritative.map((_, index) => `criterion:omitted:${index + 1}`),
    );
  });

  // Plan Task 15 — the #1799 exemplar: a row claiming its cited task carries
  // three acceptance variants while the task's committed text assigns two.
  // The quote is the claim, and the claim's text is absent from the task.
  it('rejects the #1799 exemplar — a claimed third acceptance variant the task does not carry', () => {
    const exemplarStories = `# Stories

## Story 2: Acceptance variants

### Happy Path
- Given a spec, when it lands, then all three acceptance variants are covered
`;
    const exemplarPlan = `# Plan

### Task 1: Cover the variants
**Story:** Story 2
**Type:** happy-path

Cover the two acceptance variants: created and updated.
`;
    const exemplarCriterion =
      'Story 2 happy: Given a spec, when it lands, then all three acceptance variants are covered';
    const parsed = parseCoherenceArtifact(
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |\n` +
        `| --- | --- | --- | --- | --- | --- |\n` +
        `| criterion | ${exemplarCriterion} | task-1 | covered | "Cover the three acceptance variants: created, updated and deleted." | diff-local |\n`,
    );
    expect(parsed.ok).toBe(true);
    const result = checkCriterionCoverage(parsed.ok ? parsed.rows : [], exemplarStories, exemplarPlan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(['criterion:quote-ungrounded:1']);
    expect(result.gaps[0].detail).toContain(exemplarCriterion);
    expect(result.gaps[0].detail).toContain('task-1');
  });

  // Plan Task 15 — the stale-quote case: the same rows pass against the plan
  // text the quote was authored from, then fail after the task's wording is
  // edited. Two runs over edited text prove the gate re-derives task bodies
  // instead of caching a prior verdict.
  it('re-checks a previously valid quote after the cited task body is edited (plan Task 15)', () => {
    const valid = completeRows();
    expect(checkCriterionCoverage(valid, stories, plan)).toEqual({ ok: true });
    const editedPlan = plan.replace(
      'Ship the widget with\narrival tracking.',
      'Dispatch the widget with delivery confirmation.',
    );
    const rerun = checkCriterionCoverage(valid, stories, editedPlan);
    expect(rerun.ok).toBe(false);
    if (rerun.ok) return;
    expect(rerun.gaps.map((gap) => gap.gapId)).toEqual(['criterion:quote-ungrounded:1']);
    expect(rerun.gaps[0].detail).toContain(criterion);
  });

  it('reports omitted, invented, and duplicate criteria with stable waivable ids', () => {
    const invalid = rows([
      `| criterion | ${criterion} | task-1 | covered | "Ship the widget with arrival tracking." | diff-local |`,
      `| criterion | ${criterion} | task-1 | covered | "Ship the widget with arrival tracking." | diff-local |`,
      `| criterion | invented criterion | task-1 | covered | "Ship the widget with arrival tracking." | diff-local |`,
    ]);
    const result = checkCriterionCoverage(invalid, stories, plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(
      expect.arrayContaining(['criterion:duplicate:1', 'criterion:omitted:2', 'criterion:invented:3']),
    );
    expect(result.gaps.map((gap) => gap.detail).join('\n')).toContain(negativeCriterion);
  });

  it('rejects a stale or misattributed quote and an unknown cited task', () => {
    const invalid = rows([
      `| criterion | ${criterion} | task-2 | covered | "Ship the widget with arrival tracking." | diff-local |`,
      `| criterion | ${negativeCriterion} | task-99 | covered | "Reject the broken widget before shipping." | diff-local |`,
    ]);
    const result = checkCriterionCoverage(invalid, stories, plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(
      expect.arrayContaining(['criterion:quote-ungrounded:1', 'criterion:task-missing:2:99']),
    );
    expect(result.gaps.map((gap) => gap.detail).join('\n')).toContain(criterion);
  });

  it('requires a non-negative, closed diff-locality disposition without inspecting criterion prose', () => {
    const missing = rows([
      `| criterion | ${criterion} | task-1 | covered | "Ship the widget with arrival tracking." |  |`,
      `| criterion | ${negativeCriterion} | task-2 | covered | "Reject the broken widget before shipping." | outside-diff |`,
    ]);
    const result = checkCriterionCoverage(missing, stories, plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((gap) => gap.gapId)).toEqual(
      expect.arrayContaining(['criterion:disposition-missing:1', 'criterion:disposition-negative:2']),
    );
    expect(
      parseCoherenceArtifact(`| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | ${criterion} | task-1 | covered | "Ship the widget with arrival tracking." | maybe-local |
`),
    ).toMatchObject({
      ok: false,
      reason: 'unparseable-criterion-row',
      detail: { line: 3, message: expect.stringContaining('maybe-local') },
    });
  });

  // Plan Task 17 — the #1799 census regression, using the real criterion text
  // that invalidated itself between authoring and BUILD. Recovered verbatim
  // from `git show e93914b2f^:.docs/plans/plan-tasks-lack-falsifiable-done-criteria-so-revie.md`
  // line 99, as a fixture rather than a paraphrase: the point is that THIS
  // sentence is the one that rotted, because its truth depends on state
  // outside the feature's own diff.
  //
  // Per adr-2026-08-23-diff-locality-is-an-authored-disposition the engine
  // never infers diff-locality — it reads the authored cell and nothing else.
  // So the census criterion is rejected exactly when its author says
  // `outside-diff`, and accepted when they say `diff-local`, with identical
  // prose either way. The pair is the proof; neither half alone shows it.
  describe('the census criterion (#1799, plan Task 17)', () => {
    const CENSUS =
      'A corpus test over every landed plan on main finds exactly one plan with a non-empty map and an empty map for every other.';
    // `extractAuthoritativeStoryCriteria` (artifacts.ts:1774) only enumerates a
    // bullet carrying both `given` and `then`, so the recovered sentence cannot
    // BE a criterion — it was a plan Done-when bullet, which is exactly where
    // the #1799 defect lived. It is carried verbatim INSIDE a well-formed
    // criterion instead, so the fixture is still the real rotted text and not a
    // paraphrase.
    const censusStories = `# Stories

## Story 1: Census

### Happy Path
- Given a plan whose Done-when reads "${CENSUS}", when the coherence gate reads its criterion row, then the land is rejected unless the row is dispositioned diff-local
`;
    const censusPlan = `# Plan

### Task 1: Census the corpus
**Story:** Story 1
**Type:** happy-path

Count the landed plans on main.
`;
    const censusCriterion =
      `Story 1 happy: Given a plan whose Done-when reads "${CENSUS}", when the coherence gate reads its criterion row, then the land is rejected unless the row is dispositioned diff-local`;

    const censusRow = (disposition: string) => {
      const parsed = parseCoherenceArtifact(
        `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |\n` +
          `| --- | --- | --- | --- | --- | --- |\n` +
          `| criterion | ${censusCriterion} | task-1 | covered | "Count the landed plans on main." | ${disposition} |\n`,
      );
      expect(parsed.ok).toBe(true);
      return parsed.ok ? parsed.rows : [];
    };

    it('is rejected when its author dispositions it `outside-diff`, naming the criterion', () => {
      const result = checkCriterionCoverage(censusRow('outside-diff'), censusStories, censusPlan);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.gaps.map((gap) => gap.gapId)).toEqual(['criterion:disposition-negative:1']);
      expect(result.gaps[0].detail).toContain(CENSUS);
    });

    it('is accepted with identical prose when dispositioned `diff-local` — the cell decides, not the words', () => {
      expect(checkCriterionCoverage(censusRow('diff-local'), censusStories, censusPlan).ok).toBe(true);
    });

    it('never inspects criterion prose for corpus-shaped wording', () => {
      // The censoring signal, if one existed, would live in these words. A
      // keyword matcher over them is the anti-pattern the ADR rejected, so
      // assert the engine is not doing it: same words, opposite verdicts above.
      for (const word of ['corpus', 'landed plan', 'main']) {
        expect(CENSUS).toContain(word);
      }
      expect(checkCriterionCoverage(censusRow('diff-local'), censusStories, censusPlan).ok).toBe(true);
    });
  });

  it('enumerates every coverage-layer rejection as a stable waiver-compatible gap', async () => {
    const coverageLayerRejectionClasses = [
      'omitted',
      'invented',
      'duplicate',
      'verdict',
      'disposition-missing',
      'disposition-negative',
      'task-missing',
      'quote-empty',
      'quote-ungrounded',
    ] as const;
    type CoverageLayerRejectionClass = (typeof coverageLayerRejectionClasses)[number];

    const expectedGapIds: Record<CoverageLayerRejectionClass, string> = {
      omitted: 'criterion:omitted:2',
      invented: 'criterion:invented:9',
      duplicate: 'criterion:duplicate:1',
      verdict: 'criterion:verdict:3',
      'disposition-missing': 'criterion:disposition-missing:4',
      'disposition-negative': 'criterion:disposition-negative:5',
      'task-missing': 'criterion:task-missing:6:99',
      'quote-empty': 'criterion:quote-empty:7',
      'quote-ungrounded': 'criterion:quote-ungrounded:8',
    };
    const coverageStories = `# Stories

## Story 1: Coverage rejection classes

### Happy Path
- Given a duplicate widget, when it ships, then it arrives
- Given an omitted widget, when it ships, then it arrives
- Given a verdict widget, when it ships, then it arrives
- Given a missing-disposition widget, when it ships, then it arrives
- Given a negative-disposition widget, when it ships, then it arrives
- Given a missing-task widget, when it ships, then it arrives
- Given an empty-quote widget, when it ships, then it arrives
- Given an ungrounded-quote widget, when it ships, then it arrives
`;
    const coveragePlan = `# Plan

### Task 1: Duplicate evidence
Duplicate evidence.

### Task 2: Verdict evidence
Verdict evidence.

### Task 3: Missing disposition evidence
Missing disposition evidence.

### Task 4: Negative disposition evidence
Negative disposition evidence.

### Task 5: Empty quote evidence
Empty quote evidence.

### Task 6: Grounded quote evidence
Grounded quote evidence.
`;
    const coverageRows = rows([
      '| criterion | Story 1 happy: Given a duplicate widget, when it ships, then it arrives | task-1 | covered | "Duplicate evidence." | diff-local |',
      '| criterion | Story 1 happy: Given a duplicate widget, when it ships, then it arrives | task-1 | covered | "Duplicate evidence." | diff-local |',
      '| criterion | Story 1 happy: Given a verdict widget, when it ships, then it arrives | task-2 | gap | "Verdict evidence." | diff-local |',
      '| criterion | Story 1 happy: Given a missing-disposition widget, when it ships, then it arrives | task-3 | covered | "Missing disposition evidence." |  |',
      '| criterion | Story 1 happy: Given a negative-disposition widget, when it ships, then it arrives | task-4 | covered | "Negative disposition evidence." | outside-diff |',
      '| criterion | Story 1 happy: Given a missing-task widget, when it ships, then it arrives | task-99 | covered | "Missing task evidence." | diff-local |',
      '| criterion | Story 1 happy: Given an empty-quote widget, when it ships, then it arrives | task-5 | covered |  | diff-local |',
      '| criterion | Story 1 happy: Given an ungrounded-quote widget, when it ships, then it arrives | task-6 | covered | "Ungrounded quote evidence." | diff-local |',
      '| criterion | invented criterion | task-1 | covered | "Duplicate evidence." | diff-local |',
    ]);

    const result = checkCriterionCoverage(coverageRows, coverageStories, coveragePlan);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const emittedGapIds = result.gaps.map((gap) => gap.gapId);
    const registeredGapIds = coverageLayerRejectionClasses.map(
      (rejectionClass) => expectedGapIds[rejectionClass],
    );
    expect(emittedGapIds).toHaveLength(coverageLayerRejectionClasses.length);
    expect(new Set(emittedGapIds)).toEqual(new Set(registeredGapIds));

    const waiverPath = '.docs/coherence-waivers/coverage-rejection-classes.md';
    const waiverVerdict = await evaluateCoherenceWaiver({
      gaps: result.gaps.map((gap) => ({
        layer: 'criterion',
        gapId: gap.gapId,
        artifact: 'coverage table',
        item: gap.detail,
      })),
      changedFiles: [{ status: 'A', path: waiverPath }],
      readText: async (path) =>
        path === waiverPath
          ? `Waives: ${registeredGapIds.join(', ')}\nRationale: coverage rejection ids are registered for waiver evaluation.\n`
          : null,
    });
    expect(waiverVerdict).toEqual({ ok: true });
  });

  it.each([
    [
      'wrong cell count',
      '| criterion | Given a widget, when shipped, then it arrives. | task-1 | covered | "Task 1 owns the widget." |',
    ],
    [
      'empty criterion',
      '| criterion |  | task-1 | covered | "Task 1 owns the widget." | diff-local |',
    ],
    [
      'unknown verdict',
      '| criterion | Given a widget, when shipped, then it arrives. | task-1 | probably-covered | "Task 1 owns the widget." | diff-local |',
    ],
    [
      'empty cited task ids',
      '| criterion | Given a widget, when shipped, then it arrives. |  | covered | "Task 1 owns the widget." | diff-local |',
    ],
    [
      'out-of-vocabulary disposition',
      '| criterion | Given a widget, when shipped, then it arrives. | task-1 | covered | "Task 1 owns the widget." | maybe-local |',
    ],
  ])('keeps malformed criterion rows non-waivable: %s', (_label, row) => {
    // S3.5 and S5.3 require malformed values to be refused rather than defaulted.
    const result = parseCoherenceArtifact(
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
${row}
`,
    );
    expect(result).toMatchObject({ ok: false, reason: 'unparseable-criterion-row' });
    if (result.ok) return;

    if (_label === 'wrong cell count') {
      expect(result.detail).toMatchObject({ line: 3, message: expect.stringContaining('expected 6 and actual 5') });
    } else if (_label === 'unknown verdict') {
      expect(result.detail).toMatchObject({ line: 3, message: expect.stringContaining('probably-covered') });
    } else if (_label === 'out-of-vocabulary disposition') {
      expect(result.detail).toMatchObject({ line: 3, message: expect.stringContaining('maybe-local') });
    } else if (_label === 'empty criterion') {
      expect(result.detail).toEqual({ line: 3, message: 'criterion text must not be empty' });
    } else {
      expect(result.detail).toEqual({ line: 3, message: 'criterion row must cite at least one task id' });
    }
  });

  it('keeps unparseable story criteria as a fail-closed check result, not a waiver-compatible gap', () => {
    expect(checkCriterionCoverage(completeRows(), '# Stories\n\n## Story 1: No scenarios\n', plan)).toEqual({
      ok: false,
      reason: 'unparseable-stories',
      gaps: [
        {
          gapId: 'criterion:stories-unparseable',
          criterion: '',
          detail: 'stories file has no parseable story criteria',
        },
      ],
    });
  });
});

describe('runCoherenceGate ADR pool (Task 7)', () => {
  it('keeps a deleted ADR out of the status-bearing ADR pool', async () => {
    const canonicalPath = await mkdtemp(join(tmpdir(), 'coherence-adr-pool-'));
    temporaryRepositories.push(canonicalPath);
    const worktreePath = join(canonicalPath, 'feature');

    await runGit(canonicalPath, ['init', '--initial-branch=main']);
    await runGit(canonicalPath, ['config', 'user.email', 'test@example.com']);
    await runGit(canonicalPath, ['config', 'user.name', 'Test User']);
    await mkdir(join(canonicalPath, '.docs/decisions'), { recursive: true });
    await writeFile(join(canonicalPath, '.docs/decisions/adr-deleted.md'), '# Deleted ADR\n');
    await runGit(canonicalPath, ['add', '.']);
    await runGit(canonicalPath, ['commit', '-m', 'seed ADR']);
    await runGit(canonicalPath, ['worktree', 'add', '-b', 'feature', worktreePath]);

    await unlink(join(worktreePath, '.docs/decisions/adr-deleted.md'));
    await writeFile(join(worktreePath, '.docs/decisions/adr-added.md'), '# Added ADR\n');
    await mkdir(join(worktreePath, '.docs/coherence'), { recursive: true });
    await writeFile(
      join(worktreePath, '.docs/coherence/idea.md'),
      `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "ship widgets" |
| outcome | outcome-2 | story-2 | covered | "support returns" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets" |
| fr | FR-2 | story-2 | covered | "FR-2: widgets" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| story | story-2 | task-1 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
| task | task-2 | story-1 | covered | "Task 2: ship widget" |
| adr | adr-added | story-1 | covered | "records the new decision" |
| adr | adr-deleted | story-1 | covered | "records the removed decision" |
`,
    );
    await runGit(worktreePath, ['add', '-A']);
    await runGit(worktreePath, ['commit', '-m', 'replace ADR']);

    await expect(
      runCoherenceGate({
        worktreePath,
        canonicalPath,
        tier: 'M',
        track: 'product',
        sourceRef: undefined,
        planStem: 'idea',
        storiesText: `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

## Story 2: Widget returns
**Requirement:** FR-2
`,
        planText: `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts

### Task 2: Ship widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/ship.ts
`,
        prdText: `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`,
        outcomeBullets: ['- Ship widgets reliably.', '- Support returns.'],
        ideaFiles: new Set(['.docs/coherence/idea.md', '.docs/decisions/adr-added.md']),
        guard: new AuthoringGuard(worktreePath),
      }),
    ).rejects.toThrow('fabricated-id "adr-deleted"');
  });

  it('passes a deletion-only ADR change set with the ADR layer engaged over an empty pool', async () => {
    const canonicalPath = await mkdtemp(join(tmpdir(), 'coherence-adr-deletion-only-'));
    temporaryRepositories.push(canonicalPath);
    const worktreePath = join(canonicalPath, 'feature');

    await runGit(canonicalPath, ['init', '--initial-branch=main']);
    await runGit(canonicalPath, ['config', 'user.email', 'test@example.com']);
    await runGit(canonicalPath, ['config', 'user.name', 'Test User']);
    await mkdir(join(canonicalPath, '.docs/decisions'), { recursive: true });
    await writeFile(join(canonicalPath, '.docs/decisions/adr-removed.md'), '# Removed ADR\n');
    await runGit(canonicalPath, ['add', '.']);
    await runGit(canonicalPath, ['commit', '-m', 'seed ADR']);
    await runGit(canonicalPath, ['worktree', 'add', '-b', 'feature', worktreePath]);

    await unlink(join(worktreePath, '.docs/decisions/adr-removed.md'));
    await mkdir(join(worktreePath, '.docs/coherence'), { recursive: true });
    await writeFile(
      join(worktreePath, '.docs/coherence/idea.md'),
      `# Coherence Map

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1 | covered | "ship widgets" |
| outcome | outcome-2 | story-2 | covered | "support returns" |
| fr | FR-1 | story-1 | covered | "FR-1: widgets" |
| fr | FR-2 | story-2 | covered | "FR-2: widgets" |
| story | story-1 | task-1, task-2 | covered | "As a user..." |
| story | story-2 | task-2 | covered | "As a user..." |
| task | task-1 | story-1 | covered | "Task 1: build widget" |
| task | task-2 | story-2 | covered | "Task 2: ship widget" |
| criterion | Story 1 happy: Given a widget, when shipped, then it arrives | task-1 | covered | "Build widget arrival." | diff-local |
| criterion | Story 2 happy: Given a return, when requested, then it is accepted | task-2 | covered | "Return requests are accepted." | diff-local |
`,
    );
    await runGit(worktreePath, ['add', '-A']);
    await runGit(worktreePath, ['commit', '-m', 'remove ADR']);

    const ideaFiles = new Set(['.docs/coherence/idea.md', '.docs/decisions/adr-removed.md']);
    const required = resolveRequiredLayers(worktreePath, 'M', 'product', ['- Ship widgets reliably.'], ideaFiles);
    expect(required.engaged && required.layers.has('adr')).toBe(true);

    await expect(
      runCoherenceGate({
        worktreePath,
        canonicalPath,
        tier: 'M',
        track: 'product',
        sourceRef: undefined,
        planStem: 'idea',
        storiesText: `# Stories

## Story 1: Widget shipping
**Requirement:** FR-1

### Happy Path
- Given a widget, when shipped, then it arrives

## Story 2: Widget returns
**Requirement:** FR-2

### Happy Path
- Given a return, when requested, then it is accepted
`,
        planText: `# Plan

### Task 1: Build widget
**Story:** Story 1 (FR-1)
**Type:** happy-path
**Files:** src/widget.ts

Build widget arrival.

### Task 2: Return widget
**Story:** Story 2 (FR-2)
**Type:** happy-path
**Files:** src/ship.ts

Return requests are accepted.
`,
        prdText: `# PRD

## Functional Requirements

- FR-1: Widgets can be shipped.
- FR-2: Widgets can be returned.
`,
        outcomeBullets: ['- Ship widgets reliably.', '- Support returns.'],
        ideaFiles,
        guard: new AuthoringGuard(worktreePath),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('runCoherenceGate criterion fail-closed guard', () => {
  it('carries an empty criterion row reason, line, and disagreement text through land', async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), 'coherence-empty-criterion-'));
    temporaryRepositories.push(worktreePath);
    await mkdir(join(worktreePath, '.docs/coherence'), { recursive: true });
    await writeFile(
      join(worktreePath, '.docs/coherence/idea.md'),
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | | task:1 | covered | evidence | diff-local |
`,
    );

    await expect(
      runCoherenceGate({
        worktreePath,
        canonicalPath: worktreePath,
        tier: 'M',
        track: 'technical',
        sourceRef: undefined,
        planStem: 'idea',
        storiesText: null,
        planText: null,
        prdText: null,
        outcomeBullets: [],
        ideaFiles: new Set(['.docs/coherence/idea.md']),
        guard: new AuthoringGuard(worktreePath),
      }),
    ).rejects.toThrow(/unparseable-criterion-row.*line 3.*criterion text must not be empty/is);
  });

  it('rejects a malformed coherence artifact before a waiver can bypass its parse failure', async () => {
    const canonicalPath = await mkdtemp(join(tmpdir(), 'coherence-parse-waiver-'));
    temporaryRepositories.push(canonicalPath);
    const worktreePath = join(canonicalPath, 'feature');

    await runGit(canonicalPath, ['init', '--initial-branch=main']);
    await runGit(canonicalPath, ['config', 'user.email', 'test@example.com']);
    await runGit(canonicalPath, ['config', 'user.name', 'Test User']);
    await writeFile(join(canonicalPath, 'README.md'), '# fixture\n');
    await runGit(canonicalPath, ['add', '.']);
    await runGit(canonicalPath, ['commit', '-m', 'seed fixture']);
    await runGit(canonicalPath, ['worktree', 'add', '-b', 'feature', worktreePath]);

    await mkdir(join(worktreePath, '.docs/coherence'), { recursive: true });
    await mkdir(join(worktreePath, '.docs/coherence-waivers'), { recursive: true });
    await writeFile(
      join(worktreePath, '.docs/coherence/idea.md'),
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Given a widget, when shipped, then it arrives. | task-1 | covered | "Task 1 builds the widget." |
`,
    );
    await writeFile(
      join(worktreePath, '.docs/coherence-waivers/idea.md'),
      'Waives: unparseable-criterion-row\nRationale: parsing failures must remain non-waivable.\n',
    );
    await runGit(worktreePath, ['add', '-A']);
    await runGit(worktreePath, ['commit', '-m', 'add malformed coherence artifact and waiver']);

    await expect(
      runCoherenceGate({
        worktreePath,
        canonicalPath,
        tier: 'M',
        track: 'technical',
        sourceRef: undefined,
        planStem: 'idea',
        storiesText: null,
        planText: null,
        prdText: null,
        outcomeBullets: [],
        ideaFiles: new Set(['.docs/coherence/idea.md', '.docs/coherence-waivers/idea.md']),
        guard: new AuthoringGuard(worktreePath),
      }),
    ).rejects.toThrow(/unparseable-criterion-row.*line 3.*expected 6 and actual 5/is);
  });

  it('rejects unparseable story criteria even when a fresh waiver names criterion:stories-unparseable', async () => {
    const canonicalPath = await mkdtemp(join(tmpdir(), 'coherence-criterion-unparseable-'));
    temporaryRepositories.push(canonicalPath);
    const worktreePath = join(canonicalPath, 'feature');

    await runGit(canonicalPath, ['init', '--initial-branch=main']);
    await runGit(canonicalPath, ['config', 'user.email', 'test@example.com']);
    await runGit(canonicalPath, ['config', 'user.name', 'Test User']);
    await writeFile(join(canonicalPath, 'README.md'), '# fixture\n');
    await runGit(canonicalPath, ['add', '.']);
    await runGit(canonicalPath, ['commit', '-m', 'seed fixture']);
    await runGit(canonicalPath, ['worktree', 'add', '-b', 'feature', worktreePath]);

    await mkdir(join(worktreePath, '.docs/coherence'), { recursive: true });
    await mkdir(join(worktreePath, '.docs/coherence-waivers'), { recursive: true });
    await writeFile(
      join(worktreePath, '.docs/coherence/idea.md'),
      `| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Story 1 happy: Given a widget, when shipped, then it arrives | task-1 | covered | "Task 1 builds the widget." | diff-local |
`,
    );
    await writeFile(
      join(worktreePath, '.docs/coherence-waivers/idea.md'),
      'Waives: criterion:stories-unparseable\nRationale: an attempted waiver must not clear malformed stories.\n',
    );
    await runGit(worktreePath, ['add', '-A']);
    await runGit(worktreePath, ['commit', '-m', 'add criterion waiver']);

    await expect(
      runCoherenceGate({
        worktreePath,
        canonicalPath,
        tier: 'M',
        track: 'technical',
        sourceRef: undefined,
        planStem: 'idea',
        storiesText: `# Stories

## Story 1: Widget shipping
`,
        planText: `# Plan

### Task 1: Build widget
**Story:** Story 1 (happy path)

Task 1 builds the widget.

## Coverage Check

| Story | Tasks |
| --- | --- |
| 1 | 1 |
`,
        prdText: null,
        outcomeBullets: [],
        ideaFiles: new Set(['.docs/coherence/idea.md', '.docs/coherence-waivers/idea.md']),
        guard: new AuthoringGuard(worktreePath),
      }),
    ).rejects.toThrow('criterion:stories-unparseable');
  });
});
