// RED (Task 1): parsePlanTaskPaths and TASK_ID_PATTERN must be relocatable
// to a standalone module (plan-task-parse.ts) that does not depend on
// autoheal.ts's evidence-derivation logic. wiring-probe.ts and wired-into.ts
// must be able to import these from the new module directly, so a later
// phase can gut autoheal.ts's evidence-derivation logic without breaking the
// wiring-reachability gate.
import { describe, expect, it } from 'vitest';
import { parsePlanTaskPaths, TASK_ID_PATTERN } from '../../src/engine/plan-task-parse.js';

describe('plan-task-parse.ts (relocated shared utilities, #relocate-for-wiring)', () => {
  it('exports TASK_ID_PATTERN matching the H9 id grammar', () => {
    expect(TASK_ID_PATTERN).toBe('[A-Za-z0-9._-]+');
  });

  it('exports a working parsePlanTaskPaths', () => {
    const plan = `# Plan

### Task 1: Do the thing
**Files:** \`src/foo.ts\`
`;
    const result = parsePlanTaskPaths(plan);
    expect(Array.from(result.keys())).toEqual(['1']);
    expect(Array.from(result.get('1') ?? [])).toEqual(['src/foo.ts']);
  });

  it('marks explicit Files declarations while preserving their resolved paths', () => {
    const result = parsePlanTaskPaths(`### Task 1: First
**Files:** src/one.ts; src/two.ts

### Task 2: Inherits
**Files:** same as Task 1

### Task 3: Legacy
- \`src/incidental.ts\`
`);

    expect(Array.from(result.get('1') ?? [])).toEqual(['src/one.ts', 'src/two.ts']);
    expect(Array.from(result.get('2') ?? [])).toEqual(['src/one.ts', 'src/two.ts']);
    expect(result.declaredTaskIds).toEqual(new Set(['1', '2']));
  });
});
