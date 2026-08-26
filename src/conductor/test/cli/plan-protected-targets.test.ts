import { describe, expect, it } from 'vitest';

import { planProtectedTargetsCommand } from '../../src/cli.js';

describe('plan-protected-targets CLI', () => {
  it('names the violating task and protected path, then directs an amendment to DECIDE', async () => {
    const output: string[] = [];

    await expect(
      planProtectedTargetsCommand(
        { kind: 'plan-protected-targets', path: '/plans/current-feature.md' },
        {
          print: (line) => output.push(line),
          readFile: async () => `# Implementation Plan

### Task 42: Amend another feature's accepted story

Read \`.docs/stories/another-feature.md\` before implementing the task.
`,
        },
      ),
    ).resolves.toBe(1);

    expect(output.join('\n')).toMatchInlineSnapshot(
      `"Task 42: .docs/stories/another-feature.md — return this amendment to DECIDE; BUILD tasks must not target protected artifacts."`,
    );
    expect(output.join('\n')).not.toContain('add **Files:**');
  });

  it('exits zero and reports no violations for a clean plan', async () => {
    const output: string[] = [];

    await expect(
      planProtectedTargetsCommand(
        { kind: 'plan-protected-targets', path: '/plans/current-feature.md' },
        {
          print: (line) => output.push(line),
          readFile: async () => `# Implementation Plan

### Task 43: Implement the scanner

**Files:**
- src/conductor/src/engine/plan-protected-targets.ts
`,
        },
      ),
    ).resolves.toBe(0);

    expect(output).toEqual(['No protected-target violations found.']);
  });
});
