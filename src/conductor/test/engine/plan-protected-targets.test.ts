import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanPlanProtectedTargets } from '../../src/engine/plan-protected-targets.js';
import {
  detectPlanProtectedTargetsCommand,
  planProtectedTargetsCommand,
} from '../../src/index.js';

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

  it('reports the inheriting task for another feature’s sealed path', () => {
    const plan = `# Implementation Plan

### Task 14: Amend another feature’s accepted story

**Files:**
- .docs/stories/another-feature.md

### Task 15: Add related coverage

**Files:** same as Task 14
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([
      { taskId: '14', path: '.docs/stories/another-feature.md' },
      { taskId: '15', path: '.docs/stories/another-feature.md' },
    ]);
  });

  it('allows a sealed artifact that names the plan feature', () => {
    const plan = `# Implementation Plan

### Task 15: Amend this feature's accepted story

**Files:**
- .docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([]);
  });

  it('allows a .docs path outside the sealed artifact directories', () => {
    const plan = `# Implementation Plan

### Task 16: Write build evidence

**Files:**
- .docs/decisions/build-tasks-can-amend-protected-docs-artifacts-ame.md
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([]);
  });

  it('allows a task naming only ordinary source paths', () => {
    const plan = `# Implementation Plan

### Task 17: Implement the scanner

**Files:**
- src/conductor/src/engine/plan-protected-targets.ts
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([]);
  });

  it('does not produce violations for a clean in-memory plan', () => {
    const plan = `# Implementation Plan

### Task 18: Update this feature's plan

**Files:**
- .docs/plans/build-tasks-can-amend-protected-docs-artifacts-ame.md

### Task 19: Add scanner coverage

**Files:**
- src/conductor/test/engine/plan-protected-targets.test.ts
`;

    expect(scanPlanProtectedTargets(plan, 'build-tasks-can-amend-protected-docs-artifacts-ame')).toEqual([]);
  });

  it('blocks a violating plan and names every offending task and path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-protected-targets-cli-'));
    const planPath = join(dir, 'feature.md');
    await writeFile(planPath, `# Implementation Plan

### Task 20: Amend another feature's stories

**Files:**
- .docs/stories/another-feature.md

### Task 21: Amend another feature's plan

**Files:**
- .docs/plans/yet-another-feature.md
`);

    try {
      const command = detectPlanProtectedTargetsCommand([
        'node',
        'conduct-ts',
        'plan-protected-targets',
        planPath,
      ]);
      const output: string[] = [];

      expect(command).not.toBeNull();
      await expect(planProtectedTargetsCommand(command!, { print: (line) => output.push(line) })).resolves.toBe(1);
      expect(output.join('\n')).toContain('Task 20');
      expect(output.join('\n')).toContain('.docs/stories/another-feature.md');
      expect(output.join('\n')).toContain('Task 21');
      expect(output.join('\n')).toContain('.docs/plans/yet-another-feature.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows a clean plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plan-protected-targets-cli-'));
    const planPath = join(dir, 'feature.md');
    await writeFile(planPath, `# Implementation Plan

### Task 22: Amend this feature's accepted story

**Files:**
- .docs/stories/feature.md
`);

    try {
      const command = detectPlanProtectedTargetsCommand([
        'node',
        'conduct-ts',
        'plan-protected-targets',
        planPath,
      ]);
      const output: string[] = [];

      expect(command).not.toBeNull();
      await expect(planProtectedTargetsCommand(command!, { print: (line) => output.push(line) })).resolves.toBe(0);
      expect(output.join('\n')).toMatch(/no protected-target violations/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
