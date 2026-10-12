// Covers: task:4
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { testImpactCandidates } from '../../src/engine/plan-review-candidates.js';

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
});
