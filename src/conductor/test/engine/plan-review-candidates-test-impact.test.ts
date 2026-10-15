// Covers: task:4
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_IMPACT_TERM_FILE_LIMIT, testImpactCandidates } from '../../src/engine/plan-review-candidates.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-test-impact-'));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([path, contents]) => {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }));
  return root;
}

const STACKED_PRS_PLAN = `# Plan

### Task 1: Add stacked PR support
**Files likely touched:**
- \`src/conductor/src/engine/engineer/land-spec.ts\`

**Steps:**
1. Add a \`stacked_prs\` reference to the land command.
`;

describe('testImpactCandidates', () => {
  it('names the #3036 test line and changing task when no task lists the impacted test', async () => {
    const worktreePath = await fixture({
      'src/conductor/test/engine/land-spec.test.ts': [
        "import { expect, it } from 'vitest';",
        "it('keeps stacked_prs confined to config', () => expect('stacked_prs').toBe('stacked_prs'));",
        "// engine/config.ts and types/config.ts are the only references.",
      ].join('\n'),
    });

    await expect(testImpactCandidates({ worktreePath, planText: STACKED_PRS_PLAN })).resolves.toContainEqual(
      expect.objectContaining({
        taskId: '1',
        testPath: 'src/conductor/test/engine/land-spec.test.ts',
        evidence: 'src/conductor/test/engine/land-spec.test.ts:2',
        matchedTerm: 'stacked_prs',
      }),
    );
  });

  it('does not emit a candidate when any task lists the impacted test', async () => {
    const worktreePath = await fixture({
      'src/conductor/test/engine/land-spec.test.ts': "expect('stacked_prs').toBeDefined();\n",
    });
    const planText = `${STACKED_PRS_PLAN}
### Task 2: Update the assertion
**Files likely touched:**
- \`src/conductor/test/engine/land-spec.test.ts\`
`;

    await expect(testImpactCandidates({ worktreePath, planText })).resolves.toEqual([]);
  });

  it('returns no candidates without throwing when the worktree has no test files', async () => {
    const worktreePath = await fixture({
      'src/conductor/src/engine/engineer/land-spec.ts': 'export const land = true;\n',
    });

    await expect(testImpactCandidates({ worktreePath, planText: STACKED_PRS_PLAN })).resolves.toEqual([]);
  });

  it('treats a shell suite under the top-level test directory as a test file', async () => {
    const worktreePath = await fixture({
      'test/test_provider_skill_contracts.sh': 'rg src/conductor/src/engine/engineer/land-spec.ts skills\n',
    });

    await expect(testImpactCandidates({ worktreePath, planText: STACKED_PRS_PLAN })).resolves.toContainEqual(
      expect.objectContaining({
        taskId: '1',
        testPath: 'test/test_provider_skill_contracts.sh',
        evidence: 'test/test_provider_skill_contracts.sh:1',
        matchedTerm: 'land-spec.ts',
      }),
    );
  });

  it('ignores numeric and two-character backticked terms that cannot identify an impacted test', async () => {
    const worktreePath = await fixture({
      'src/conductor/test/engine/numbers.test.ts': "expect([1, 2, 'T1', 'r1']).toHaveLength(4);\n",
    });
    const planText = `# Plan

### Task 1: Route hosts
**Files likely touched:**
- \`src/conductor/src/engine/routing/router.ts\`

**Steps:**
1. Route host \`1\`, then \`2\`, for task \`T1\` in round \`r1\`.
`;

    await expect(testImpactCandidates({ worktreePath, planText })).resolves.toEqual([]);
  });

  it('drops a term found in more test files than the specificity limit while keeping a specific term', async () => {
    const common = Object.fromEntries(Array.from({ length: TEST_IMPACT_TERM_FILE_LIMIT + 1 }, (_, index) => [
      `src/conductor/test/engine/common-${index}.test.ts`, "expect('prd_audit').toBeDefined();\n",
    ]));
    const worktreePath = await fixture({
      ...common,
      'src/conductor/test/engine/specific.test.ts': "expect('routeAdmittedRound').toBeDefined();\n",
    });
    const planText = `# Plan

### Task 1: Route rounds
**Files likely touched:**
- \`src/conductor/src/engine/routing/router.ts\`

**Steps:**
1. Call \`routeAdmittedRound\` from the \`prd_audit\` gap loop.
`;

    const candidates = await testImpactCandidates({ worktreePath, planText });
    expect(candidates).toEqual([expect.objectContaining({
      taskId: '1',
      testPath: 'src/conductor/test/engine/specific.test.ts',
      matchedTerm: 'routeAdmittedRound',
    })]);
  });

  it('returns at most maxCandidates rows, most specific terms first', async () => {
    const worktreePath = await fixture({
      'src/conductor/test/engine/a.test.ts': "expect('alphaTerm').toBeDefined();\nexpect('betaTerm').toBeDefined();\n",
      'src/conductor/test/engine/b.test.ts': "expect('betaTerm').toBeDefined();\n",
      'src/conductor/test/engine/c.test.ts': "expect('gammaTerm').toBeDefined();\n",
    });
    const planText = `# Plan

### Task 1: Use terms
**Files likely touched:**
- \`src/conductor/src/engine/terms.ts\`

**Steps:**
1. Use \`betaTerm\`, \`alphaTerm\` and \`gammaTerm\`.
`;

    const candidates = await testImpactCandidates({ worktreePath, planText, maxCandidates: 2 });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.matchedTerm)).not.toContain('betaTerm');
  });
});
