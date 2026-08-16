import { describe, expect, it } from 'vitest';

import type { BuildReviewFinding } from '../src/engine/build-review-domain.js';
import { planContractPointers, priorAttemptPointers } from '../src/engine/remediation-context-pointers.js';

describe('planContractPointers', () => {
  it('renders a concise plan-contract pointer for a completeness finding anchored to Task 1', () => {
    const plan = `# Implementation Plan

### Task 1: Join remediation findings to the plan contract

**Steps:**
1. This detailed implementation text must not appear in the pointer.
`;

    expect(
      planContractPointers(
        [
          {
            concernKind: 'missing-outcome',
            summary: 'The remediation context omits the governing plan task.',
            evidenceLocations: ['src/engine/conductor.ts:1'],
            anchor: {
              rubric: 'completeness',
              planTask: '1',
              missingOutcome: 'renders the plan contract pointer',
            },
          },
        ],
        plan,
        '.docs/plans/remediation-context.md',
      ),
    ).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 1 (anchor: renders the plan contract pointer)',
    ]);
  });

  it('resolves a file-anchored scope finding only when one task owns the file', () => {
    const plan = `# Implementation Plan

### Task 2: Own a focused engine file
**Files:** src/engine/owned.ts

### Task 3: First shared-file task
**Files:** src/engine/shared.ts

### Task 4: Second shared-file task
**Files:** src/engine/shared.ts
`;

    expect(
      planContractPointers(
        [
          {
            concernKind: 'out-of-scope-change',
            summary: 'The owned file is outside the approved scope.',
            evidenceLocations: ['src/engine/owned.ts:1'],
            anchor: { rubric: 'scope', path: 'src/engine/owned.ts', relation: 'outside-plan' },
          },
          {
            concernKind: 'out-of-scope-change',
            summary: 'The shared file has more than one plan owner.',
            evidenceLocations: ['src/engine/shared.ts:1'],
            anchor: { rubric: 'scope', path: 'src/engine/shared.ts', relation: 'outside-plan' },
          },
          {
            concernKind: 'out-of-scope-change',
            summary: 'The unmapped file has no plan owner.',
            evidenceLocations: ['src/engine/unmapped.ts:1'],
            anchor: { rubric: 'scope', path: 'src/engine/unmapped.ts', relation: 'outside-plan' },
          },
        ],
        plan,
        '.docs/plans/remediation-context.md',
      ),
    ).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 2 (anchor: src/engine/owned.ts)',
    ]);
  });

  it('resolves a tautology changed test only when one task owns the file', () => {
    const plan = `# Implementation Plan

### Task 2: Own a focused test file
**Files:** src/engine/owned.test.ts

### Task 3: First shared-test task
**Files:** src/engine/shared.test.ts

### Task 4: Second shared-test task
**Files:** src/engine/shared.test.ts
`;

    expect(
      planContractPointers(
        [
          {
            concernKind: 'tautological-test',
            summary: 'The owned test does not distinguish the changed behavior.',
            evidenceLocations: ['src/engine/owned.test.ts:1'],
            anchor: {
              rubric: 'tautology',
              changedTest: 'src/engine/owned.test.ts',
              exercisedBehavior: 'owns a focused test file',
              violationKind: 'still-passes-before-change',
            },
          },
          {
            concernKind: 'tautological-test',
            summary: 'The shared test has more than one plan owner.',
            evidenceLocations: ['src/engine/shared.test.ts:1'],
            anchor: {
              rubric: 'tautology',
              changedTest: 'src/engine/shared.test.ts',
              exercisedBehavior: 'is shared',
              violationKind: 'still-passes-before-change',
            },
          },
          {
            concernKind: 'tautological-test',
            summary: 'The unmapped test has no plan owner.',
            evidenceLocations: ['src/engine/unmapped.test.ts:1'],
            anchor: {
              rubric: 'tautology',
              changedTest: 'src/engine/unmapped.test.ts',
              exercisedBehavior: 'is unmapped',
              violationKind: 'still-passes-before-change',
            },
          },
        ],
        plan,
        '.docs/plans/remediation-context.md',
      ),
    ).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 2 (anchor: src/engine/owned.test.ts)',
    ]);
  });

  it('resolves a root-cause locus only when one task owns the file', () => {
    const plan = `# Implementation Plan

### Task 2: Own a focused engine file
**Files:** src/engine/root-owned.ts

### Task 3: First shared-file task
**Files:** src/engine/root-shared.ts

### Task 4: Second shared-file task
**Files:** src/engine/root-shared.ts
`;

    expect(
      planContractPointers(
        [
          {
            concernKind: 'incomplete-root-cause-fix',
            summary: 'The owned locus identifies the missing mechanism.',
            evidenceLocations: ['src/engine/root-owned.ts:1'],
            anchor: {
              rubric: 'rootCause',
              statedDefect: 'The governing plan task is unavailable.',
              locus: 'src/engine/root-owned.ts',
              relation: 'omits the ownership join',
            },
          },
          {
            concernKind: 'incomplete-root-cause-fix',
            summary: 'The shared locus has more than one plan owner.',
            evidenceLocations: ['src/engine/root-shared.ts:1'],
            anchor: {
              rubric: 'rootCause',
              statedDefect: 'The governing plan task is unavailable.',
              locus: 'src/engine/root-shared.ts',
              relation: 'omits the ownership join',
            },
          },
          {
            concernKind: 'incomplete-root-cause-fix',
            summary: 'The unmapped locus has no plan owner.',
            evidenceLocations: ['src/engine/root-unmapped.ts:1'],
            anchor: {
              rubric: 'rootCause',
              statedDefect: 'The governing plan task is unavailable.',
              locus: 'src/engine/root-unmapped.ts',
              relation: 'omits the ownership join',
            },
          },
        ],
        plan,
        '.docs/plans/remediation-context.md',
      ),
    ).toEqual([
      'plan contract: .docs/plans/remediation-context.md — Task 2 (anchor: src/engine/root-owned.ts)',
    ]);
  });

  it('renders concise references to same-anchor findings from prior review laps', () => {
    const currentFinding: BuildReviewFinding = {
      concernKind: 'out-of-scope-change',
      summary: 'The current change is outside the approved plan.',
      evidenceLocations: ['src/engine/conductor.ts:1'],
      anchor: { rubric: 'scope', path: 'src/engine/conductor.ts', relation: 'outside-plan' },
    };
    const priorLaps: readonly {
      artifactPath: string;
      findings: readonly { findingRef: string; finding: BuildReviewFinding }[];
    }[] = [
      {
        artifactPath: '.pipeline/build-review/lap-1/scope.json',
        findings: [{
          findingRef: 'finding-1',
          finding: {
            concernKind: 'out-of-scope-change',
            summary: 'The first lap described a different scope concern.',
            evidenceLocations: ['src/engine/conductor.ts:10'],
            anchor: { rubric: 'scope', path: 'src/engine/conductor.ts', relation: 'outside-plan' },
          },
        }],
      },
      {
        artifactPath: '.pipeline/build-review/lap-2/scope.json',
        findings: [{
          findingRef: 'finding-2',
          finding: {
            concernKind: 'out-of-scope-change',
            summary: 'The second lap described another scope concern.',
            evidenceLocations: ['src/engine/conductor.ts:20'],
            anchor: { rubric: 'scope', path: 'src/engine/conductor.ts', relation: 'outside-plan' },
          },
        }],
      },
    ];

    expect(priorAttemptPointers([currentFinding], priorLaps)).toEqual([
      'prior attempts (2): .pipeline/build-review/lap-1/scope.json#finding-1, .pipeline/build-review/lap-2/scope.json#finding-2',
    ]);
  });

  it('renders a prior-attempt pointer when a same root-cause anchor has a drifted concern kind', () => {
    const anchor = {
      rubric: 'rootCause' as const,
      statedDefect: 'Equivalent prior attempts must remain visible.',
      locus: 'src/engine/remediation-context-pointers.ts',
      relation: 'joins findings by anchor rather than concern label',
    };

    expect(priorAttemptPointers([{
      concernKind: 'missing-anchor-join',
      summary: 'The current review describes the same underlying defect differently.',
      evidenceLocations: ['src/engine/remediation-context-pointers.ts:52'],
      anchor,
    }], [{
      artifactPath: '.pipeline/build-review/lap-prior/rootCause.json',
      findings: [{
        findingRef: 'finding-prior',
        finding: {
          concernKind: 'incomplete-root-cause-fix',
          summary: 'The prior review used another concern label.',
          evidenceLocations: ['src/engine/remediation-context-pointers.ts:52'],
          anchor,
        },
      }],
    }])).toEqual([
      'prior attempts (1): .pipeline/build-review/lap-prior/rootCause.json#finding-prior',
    ]);
  });

  it('ignores unresolvable plan, prior-lap, and malformed finding inputs', () => {
    const scopeFinding: BuildReviewFinding = {
      concernKind: 'out-of-scope-change',
      summary: 'The current change is outside the approved plan.',
      evidenceLocations: ['src/engine/conductor.ts:1'],
      anchor: { rubric: 'scope', path: 'src/engine/conductor.ts', relation: 'outside-plan' },
    };
    const differentAnchorFinding: BuildReviewFinding = {
      concernKind: 'out-of-scope-change',
      summary: 'The prior change was anchored to another file.',
      evidenceLocations: ['src/engine/other.ts:1'],
      anchor: { rubric: 'scope', path: 'src/engine/other.ts', relation: 'outside-plan' },
    };

    const results = [
      planContractPointers([{
        concernKind: 'missing-outcome',
        summary: 'The requested plan task is absent.',
        evidenceLocations: ['src/engine/conductor.ts:1'],
        anchor: { rubric: 'completeness', planTask: '999', missingOutcome: 'renders the plan contract pointer' },
      }], '### Task 1: Existing task\n', '.docs/plans/remediation-context.md'),
      priorAttemptPointers([scopeFinding], [{
        artifactPath: '.pipeline/build-review/lap-different/scope.json',
        findings: [{ findingRef: 'finding-different', finding: differentAnchorFinding }],
      }]),
      priorAttemptPointers([scopeFinding], [
        null as unknown as Parameters<typeof priorAttemptPointers>[1][number],
        {
          artifactPath: '.pipeline/build-review/lap-valid/scope.json',
          findings: [{ findingRef: 'finding-valid', finding: scopeFinding }],
        },
      ]),
      planContractPointers([null as unknown as BuildReviewFinding], '', '.docs/plans/remediation-context.md'),
      priorAttemptPointers([{} as unknown as BuildReviewFinding], []),
    ];

    expect(results).toEqual([
      [],
      [],
      ['prior attempts (1): .pipeline/build-review/lap-valid/scope.json#finding-valid'],
      [],
      [],
    ]);
  });
});
