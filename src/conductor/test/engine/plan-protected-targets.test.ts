import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanPlanProtectedTargets } from '../../src/engine/plan-protected-targets.js';
import { TASK_HEADER_PATTERN } from '../../src/engine/plan-task-parse.js';
import {
  detectPlanProtectedTargetsCommand,
  planProtectedTargetsCommand,
} from '../../src/cli.js';

function taskBlock(plan: string, taskId: string): string | undefined {
  let currentTaskIds: string[] = [];
  let currentTaskLines: string[] = [];

  const finishCurrentTask = () => {
    if (currentTaskIds.includes(taskId)) return currentTaskLines.join('\n');
    return undefined;
  };

  for (const line of plan.split('\n')) {
    const header = line.match(TASK_HEADER_PATTERN);
    if (header) {
      const completedTask = finishCurrentTask();
      if (completedTask !== undefined) return completedTask;
      currentTaskIds = (header[1] ?? header[2] ?? header[3] ?? header[4])
        .split(',')
        .flatMap((id) => {
          const trimmed = id.trim();
          const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
          if (!range) return [trimmed];
          return Array.from(
            { length: Number(range[2]) - Number(range[1]) + 1 },
            (_, offset) => String(Number(range[1]) + offset),
          );
        });
      currentTaskLines = [line];
    } else if (currentTaskIds.length > 0) {
      currentTaskLines.push(line);
    }
  }

  return finishCurrentTask();
}

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

  it('rejects an undeclared task that cites a foreign protected artifact', () => {
    const plan = `### Task 16: Review the existing decision
Read \`.docs/specs/2026-07-04-operator-park.md\` first.
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([
      { taskId: '16', path: '.docs/specs/2026-07-04-operator-park.md' },
    ]);
  });

  it('rejects a declared task that cites a foreign protected artifact', () => {
    const plan = `### Task 17: Review the existing decision
**Files:** .docs/validation/report.md
Read \`.docs/decisions/adr-2026-01-01-other.md\` first.
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([
      { taskId: '17', path: '.docs/decisions/adr-2026-01-01-other.md' },
    ]);
  });

  it('still rejects the foreign prose reference without a Files line', () => {
    const plan = `### Task 18: Review the existing decision
Read \`.docs/decisions/adr-2026-01-01-other.md\` first.
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([
      { taskId: '18', path: '.docs/decisions/adr-2026-01-01-other.md' },
    ]);
  });

  it('allows an own-feature story path', () => {
    const plan = `### Task 19: Amend this feature's story
**Files:** .docs/stories/feature.md
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([]);
  });

  it('allows tasks that name only source and validation paths', () => {
    const plan = `### Task 20: Add validation coverage
**Files:**
- src/conductor/src/engine/plan-protected-targets.ts
- .docs/validation/report.md
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([]);
  });

  it('rejects a declared task that cites a protected artifact as context', () => {
    const plan = `### Task 17: Implement the scanner
**Files:** src/conductor/src/x.ts
Read \`.docs/specs/other-feature.md\` as context.
`;

    expect(scanPlanProtectedTargets(plan, 'feature')).toEqual([
      { taskId: '17', path: '.docs/specs/other-feature.md' },
    ]);
  });

  it('reports only protected paths present in their task across the plan corpus', async () => {
    const plansDirectory = resolve(fileURLToPath(new URL('../../../../.docs/plans/', import.meta.url)));
    const planFiles = (await readdir(plansDirectory))
      .filter((entry) => entry.endsWith('.md'))
      .sort();

    for (const planFile of planFiles) {
      const plan = await readFile(join(plansDirectory, planFile), 'utf8');
      const violations = scanPlanProtectedTargets(plan, basename(planFile, '.md'));

      for (const violation of violations) {
        const relevantTask = taskBlock(plan, violation.taskId);
        expect(relevantTask, `${planFile} Task ${violation.taskId}`).toBeDefined();
        expect(relevantTask, `${planFile} Task ${violation.taskId}`).toContain(violation.path);
      }
    }
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
