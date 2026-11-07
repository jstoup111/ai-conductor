// Covers: task:6
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';

const FEATURE = 'dependency-gate';
const STORY = `# Stories
**Status:** Accepted

## Story 1: Dependency validation

### Happy Path
- Given a plan, when its dependencies are valid, then it passes.

### Negative Paths
- Given an invalid plan, when it is checked, then it is rejected.
`;

function plan(dependencies: readonly [string, string][]): string {
  return dependencies.map(([dependency, type], index) => `### Task ${index + 1}: ${type}
**Story:** Story 1
**Type:** ${type}
**Dependencies:** ${dependency}`).join('\n\n');
}

let repo: string;

async function write(relativePath: string, contents: string): Promise<void> {
  const path = join(repo, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function addPlan(contents: string): Promise<void> {
  await write(`.docs/plans/${FEATURE}.md`, contents);
}

async function expectPlanGate() {
  return checkGateCompletion(repo, 'plan', { featureDesc: FEATURE });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'plan-gate-dependencies-'));
  await initTestRepo(repo);
  await write(`.docs/stories/${FEATURE}.md`, STORY);
  await commitAll(repo, 'base stories');
  const { execa } = await import('execa');
  await execa('git', ['checkout', '-b', 'feature'], { cwd: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('plan gate dependency validation', () => {
  it('rejects cycles in a plan newly authored on the feature branch', async () => {
    await addPlan(plan([['Task 2', 'happy-path'], ['Task 1', 'negative-path']]));
    await commitAll(repo, 'add cyclic plan');

    const result = await expectPlanGate();

    expect(result.done).toBe(false);
    expect(result.reason).toContain('1');
    expect(result.reason).toContain('2');
  });

  it('accepts a conforming plan newly authored on the feature branch', async () => {
    await addPlan(plan([['none', 'happy-path'], ['Task 1', 'negative-path']]));
    await commitAll(repo, 'add conforming plan');

    await expect(expectPlanGate()).resolves.toEqual({ done: true });
  });

  it('rejects unknown dependencies and missing lines in newly authored plans', async () => {
    await addPlan(plan([['none', 'happy-path'], ['Task 99', 'negative-path']]));
    await commitAll(repo, 'add unknown dependency plan');

    const unknown = await expectPlanGate();
    expect(unknown.done).toBe(false);
    expect(unknown.reason).toContain('Task 2');
    expect(unknown.reason).toContain('Task 99');

    await addPlan(`### Task 1: happy
**Story:** Story 1
**Type:** happy-path

### Task 2: negative
**Story:** Story 1
**Type:** negative-path

## Task Dependency Graph
- Task 2 depends on Task 1
`);
    await commitAll(repo, 'replace with section-only plan');

    const missingLines = await expectPlanGate();
    expect(missingLines.done).toBe(false);
    expect(missingLines.reason).toContain('Task 1');
    expect(missingLines.reason).toContain('Task 2');
  });

  it('keeps the presence-only check for plans inherited from the default branch', async () => {
    const { execa } = await import('execa');
    await execa('git', ['checkout', 'main'], { cwd: repo });
    await addPlan(plan([['Tasks 1–9', 'happy-path'], ['Tasks 1–9', 'negative-path']]));
    await commitAll(repo, 'add inherited malformed plan');
    await execa('git', ['checkout', 'feature'], { cwd: repo });
    await execa('git', ['merge', '--ff-only', 'main'], { cwd: repo });

    await expect(expectPlanGate()).resolves.toEqual({ done: true });

    await addPlan(`${plan([['Tasks 1–9', 'happy-path'], ['Tasks 1–9', 'negative-path']])}

### Task rem-1: remediation
`);
    await commitAll(repo, 'append remediation task');

    await expect(expectPlanGate()).resolves.toEqual({ done: true });
  });

  it('falls back to the presence check when the merge base is unresolved', async () => {
    const nonRepo = await mkdtemp(join(tmpdir(), 'plan-gate-dependencies-non-repo-'));
    try {
      const storiesPath = join(nonRepo, '.docs/stories', `${FEATURE}.md`);
      const planPath = join(nonRepo, '.docs/plans', `${FEATURE}.md`);
      await mkdir(dirname(storiesPath), { recursive: true });
      await mkdir(dirname(planPath), { recursive: true });
      await writeFile(storiesPath, STORY);
      await writeFile(planPath, `${plan([['none', 'happy-path'], ['Task 1', 'negative-path']])}

## Task Dependency Graph
`);

      await expect(checkGateCompletion(nonRepo, 'plan', { featureDesc: FEATURE })).resolves.toEqual(expect.objectContaining({
        done: true,
        reason: expect.stringMatching(/skipped.*merge-base/i),
      }));

      await writeFile(planPath, `### Task 1: happy
**Story:** Story 1
**Type:** happy-path

### Task 2: negative
**Story:** Story 1
**Type:** negative-path
`);
      const noTree = await checkGateCompletion(nonRepo, 'plan', { featureDesc: FEATURE });
      expect(noTree.done).toBe(false);
      expect(noTree.reason).toContain('plan has no task dependency tree');
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });
});
