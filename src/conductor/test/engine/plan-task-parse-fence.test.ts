import { describe, expect, it } from 'vitest';

import { parsePlanTaskPaths } from '../../src/engine/plan-task-parse.js';
import { scanPlanProtectedTargets } from '../../src/engine/plan-protected-targets.js';

const featureStem = 'this-feature';
const fixture = `# Implementation Plan

### Task 1: Declare source paths
**Files:** src/one.ts; \`test/one.test.ts\`

### Task 2: Inherit the declaration
**Files**: same as Task 1

### Task 3: Keep legacy fallback and protected citations separate
Read \`.docs/specs/other-feature.md\` before editing.
- \`src/fallback.ts\`

### Task 4: Use the template Files block
**Files likely touched:**
- .docs/plans/other-feature.md — protected target
- src/four.ts — implementation

### Task 5: Name this feature's protected artifact
**Files:** .docs/stories/this-feature.md
`;

describe('plan task Files convention fence', () => {
  it('preserves Files grammar, metadata, and protected-target violations after wiring removal', () => {
    const parsed = parsePlanTaskPaths(fixture, featureStem);

    expect(Array.from(parsed.entries())).toEqual([
      ['1', new Set(['src/one.ts', 'test/one.test.ts'])],
      ['2', new Set(['src/one.ts', 'test/one.test.ts'])],
      ['3', new Set(['src/fallback.ts'])],
      ['4', new Set(['.docs/plans/other-feature.md', 'src/four.ts'])],
      ['5', new Set(['.docs/stories/this-feature.md'])],
    ]);
    expect(parsed.hasFilesLineByTaskId).toEqual(new Map([
      ['1', true],
      ['2', true],
      ['3', false],
      ['4', true],
      ['5', true],
    ]));
    expect(parsed.foreignProtectedReferencesByTaskId).toEqual(new Map([
      ['3', new Set(['.docs/specs/other-feature.md'])],
    ]));
    expect(scanPlanProtectedTargets(fixture, featureStem)).toEqual([
      { taskId: '3', path: '.docs/specs/other-feature.md' },
      { taskId: '4', path: '.docs/plans/other-feature.md' },
    ]);
  });
});
