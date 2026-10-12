// Covers: task:5
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseWiringSurface,
  reachabilityCandidates,
} from '../../src/engine/plan-review-candidates.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-reachability-'));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([path, contents]) => {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }));
  return root;
}

const PROJECT_CHILD_OWNERSHIP_PLAN = `# Plan

### Task 7: Add child ownership resolver
**Files likely touched:**
- \`src/conductor/src/engine/project-child-ownership.ts\`

**Steps:**
1. Export \`projectChildOwnership\` for a later ticket to consume.

**Done when:**
- [test] The resolver reports child ownership.
`;

describe('parseWiringSurface', () => {
  it('returns the surface and committed production caller from its table', () => {
    expect(parseWiringSurface(`## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| \`projectChildOwnership\` | \`runProjectCommand\` in the CLI dispatcher |

## Risks
`)).toEqual([{
      surface: 'projectChildOwnership',
      productionCaller: 'runProjectCommand in the CLI dispatcher',
    }]);
  });
});

describe('reachabilityCandidates', () => {
  it('names an uncalled export, its introducing task, plan evidence, and searched source paths', async () => {
    const worktreePath = await fixture({
      'src/conductor/src/engine/project-child-ownership.ts': 'export const projectChildOwnership = () => true;\n',
      'src/conductor/test/engine/project-child-ownership.test.ts': 'projectChildOwnership();\n',
    });

    await expect(reachabilityCandidates({
      worktreePath,
      planText: PROJECT_CHILD_OWNERSHIP_PLAN,
      architectureReviewText: '',
    })).resolves.toEqual([expect.objectContaining({
      lens: 'reachability',
      identifier: 'projectChildOwnership',
      taskId: '7',
      evidence: 'plan.md:8',
      searchedPaths: [],
    })]);
  });

  it('does not flag an export named by a Done-when command that exists in source', async () => {
    const worktreePath = await fixture({
      'src/conductor/src/engine/project-child-ownership.ts': 'export const projectChildOwnership = () => true;\n',
      'src/conductor/src/engine/cli.ts': 'export const runProjectCommand = () => true;\n',
    });
    const planText = `${PROJECT_CHILD_OWNERSHIP_PLAN}
### Task 8: Wire the command
**Done when:**
- The existing \`runProjectCommand\` CLI command observes \`projectChildOwnership\`.
`;

    await expect(reachabilityCandidates({ worktreePath, planText, architectureReviewText: '' }))
      .resolves.toEqual([]);
  });

  it('does not flag a Wiring Surface item with an existing non-test production caller', async () => {
    const worktreePath = await fixture({
      'src/conductor/src/engine/project-child-ownership.ts': 'export const projectChildOwnership = () => true;\n',
      'src/conductor/src/engine/cli.ts': 'import { projectChildOwnership } from "./project-child-ownership.js";\n',
    });

    await expect(reachabilityCandidates({
      worktreePath,
      planText: PROJECT_CHILD_OWNERSHIP_PLAN,
      architectureReviewText: `## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| \`projectChildOwnership\` | CLI dispatcher |
`,
    })).resolves.toEqual([]);
  });

  it('uses plan exports without throwing when the architecture review has no Wiring Surface', async () => {
    const worktreePath = await fixture({
      'src/conductor/src/engine/project-child-ownership.ts': 'export const projectChildOwnership = () => true;\n',
    });

    await expect(reachabilityCandidates({
      worktreePath,
      planText: PROJECT_CHILD_OWNERSHIP_PLAN,
      architectureReviewText: '## Risks\n\nNo wiring table here.\n',
    })).resolves.toContainEqual(expect.objectContaining({
      identifier: 'projectChildOwnership',
      taskId: '7',
      evidence: 'plan.md:8',
    }));
  });
});
