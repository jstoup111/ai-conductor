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
});
