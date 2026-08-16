/**
 * RED acceptance coverage for jstoup111/ai-conductor#1579.
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Stories 1-3 cross real plan parsing, build-review input assembly, frozen
 *   source projection, rubric projection, and monolithic prompt rendering.
 *   That multi-operation flow is covered here.
 * - Stories 4-5 are single-operation skill-text contracts. Plan Tasks 9-11
 *   own their lower-layer contract coverage; they are not duplicated here.
 *
 * Production call sites exercised:
 * - src/engine/build-review-inputs.ts: assembleBuildReviewInputs
 * - src/engine/build-review-projections.ts: deriveBuildReviewRubricProjections
 * - src/engine/build-review-prompt.ts: buildGraderPrompt
 *
 * The LLM grader is a third-party boundary and is intentionally not invoked.
 * The deterministic terminal observations are the immutable rubric inputs and
 * the rendered grader contract required by the accepted stories and ADR.
 *
 * Verify-claims: every asserted marker, path, exception predicate, and
 * completeness rule is stated by the accepted stories and approved ADR. No
 * unconfirmed load-bearing assumption is encoded here.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import { makeGitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const PLAN_PATH = '.docs/plans/feature.md';
const FEATURE_PATH = 'src/a.ts';
const TEST_PATH = 'test/a.test.ts';
const scratchRoots: string[] = [];

interface VerifyOnlyEntry {
  taskId: string;
  behavior: string;
  paths: readonly string[];
}

interface Fixture {
  root: string;
  head: string;
  planPath: string;
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: root });
  return stdout.trim();
}

async function writeRepoFile(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function makeFixture(planBody: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'verify-only-build-review-'));
  scratchRoots.push(root);

  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.test');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await writeRepoFile(root, '.gitignore', '.pipeline/\n');
  await writeRepoFile(root, PLAN_PATH, planBody);
  await writeRepoFile(root, FEATURE_PATH, 'export const existingBehavior = true;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-q', '-m', 'base behavior and approved plan');

  // A local-path origin exercises the real fresh-base path without network or
  // any third-party boundary.
  await git(root, 'remote', 'add', 'origin', root);
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  await git(root, 'checkout', '-q', '-b', 'feat/verify-only-evidence');
  await writeRepoFile(
    root,
    TEST_PATH,
    "import { existingBehavior } from '../src/a.js';\nvoid existingBehavior;\n",
  );
  await git(root, 'add', TEST_PATH);
  await git(root, 'commit', '-q', '-m', 'test: document existing behavior');
  const head = await git(root, 'rev-parse', 'HEAD');

  return { root, head, planPath: join(root, PLAN_PATH) };
}

function currentProof(head: string) {
  return {
    inspectTestSuite: async () => ({
      status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' },
    } as never),
  };
}

function verifyOnlyContext(value: unknown): readonly VerifyOnlyEntry[] | undefined {
  return (value as { verifyOnlyContext?: readonly VerifyOnlyEntry[] }).verifyOnlyContext;
}

function projectionSource(inputs: Awaited<ReturnType<typeof assembleBuildReviewInputs>>) {
  return deriveBuildReviewRubricProjections({
    lapId: 'lap-verify-only',
    inputs,
    tautology: {
      changedTestSelectors: [TEST_PATH],
      revertedProductionManifest: [],
      preflightEvidence: { classification: 'red' },
    },
  } as never);
}

describe('acceptance: plan-marked verify-only maintenance reaches both build_review lanes (#1579)', () => {
  it('threads exact task evidence through the frozen snapshot, projections, and grader contract', async () => {
    const fixture = await makeFixture([
      '# Approved plan',
      '',
      '### Task 3: Document existing behavior',
      '**Verify-only:** yes',
      '**Files likely touched:**',
      `- \`${FEATURE_PATH}\``,
      `- \`${TEST_PATH}\``,
      '',
    ].join('\n'));

    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );
    const expected = [{
      taskId: '3',
      behavior: 'Document existing behavior',
      paths: [FEATURE_PATH, TEST_PATH],
    }];

    expect(verifyOnlyContext(inputs)).toEqual(expected);
    expect(verifyOnlyContext(inputs.sourceSnapshot)).toEqual(expected);
    expect(Object.isFrozen(verifyOnlyContext(inputs.sourceSnapshot))).toBe(true);

    const projections = projectionSource(inputs);
    for (const projection of Object.values(projections)) {
      expect(verifyOnlyContext(projection)).toEqual(expected);
    }
    expect(projections.tautology).not.toHaveProperty('planBody');

    const prompt = buildGraderPrompt(inputs);
    expect(prompt).toContain('## Engine-parsed verify-only tasks');
    expect(prompt).toContain('Task 3');
    expect(prompt).toContain(FEATURE_PATH);
    expect(prompt).toContain(TEST_PATH);
    expect(prompt).toMatch(/evidence, not an exemption/i);
    expect(prompt).toMatch(/4\. Verify-only maintenance:/);
    expect(prompt).toMatch(/engine.*block lists.*verify-only task/i);
    expect(prompt).toMatch(/changed test.*declared files|behavior.*task verifies/i);
    expect(prompt).toMatch(/no new assertion.*behavior.*diff introduces/i);
    expect(prompt).toContain('A changed test qualifying under none of these exceptions is measured normally.');
    expect(prompt).toMatch(/listed in the engine-parsed verify-only block.*no implementation diff/i);
    expect(prompt).toContain('Completeness must be judged holistically');
    expect(prompt).toContain('per-task SHA/reachability');
  });

  it('keeps unmarked, malformed, and headerless plan text outside the exemption', async () => {
    const fixture = await makeFixture([
      '# Approved plan',
      '',
      '### Task 4: Ordinary behavioral change',
      '**Verify-only:** maybe',
      '**Files likely touched:**',
      `- \`${FEATURE_PATH}\``,
      `- \`${TEST_PATH}\``,
      '',
      'Verify-only: yes appears in headerless prose but belongs to no task.',
    ].join('\n'));

    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );

    expect(verifyOnlyContext(inputs)).toEqual([]);
    expect(verifyOnlyContext(inputs.sourceSnapshot)).toEqual([]);
    for (const projection of Object.values(projectionSource(inputs))) {
      expect(verifyOnlyContext(projection)).toEqual([]);
    }

    const prompt = buildGraderPrompt(inputs);
    const heading = '## Engine-parsed verify-only tasks';
    const start = prompt.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(prompt.slice(start)).toContain('(none)');
  });
});
