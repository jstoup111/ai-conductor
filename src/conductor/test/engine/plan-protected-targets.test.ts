import { describe, expect, it } from 'vitest';

import { scanPlanProtectedTargets } from '../../src/engine/plan-protected-targets.js';

describe('engine/plan-protected-targets', () => {
  it('reports every other-feature story artifact named by Task 14', () => {
    const plan = `# Implementation Plan

### Task 14: Amend accepted stories

**Files:**
- .docs/stories/another-feature.md
- .docs/stories/yet-another-feature.md
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([
      { taskId: '14', path: '.docs/stories/another-feature.md' },
      { taskId: '14', path: '.docs/stories/yet-another-feature.md' },
    ]);
  });
});
