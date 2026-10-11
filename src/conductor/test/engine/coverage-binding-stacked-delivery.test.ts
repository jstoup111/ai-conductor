// Covers: task:12, task:14, task:17, task:19
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const TEMPORARY_DIRECTORIES: string[] = [];

const STORIES = `# Stories: stacked runner

## Story 1: First

### Acceptance Criteria

- Given a first child, when it runs, then it passes.

## Story 2: Second

### Acceptance Criteria

- Given a second child, when it runs, then it passes.
`;

function task(id: number, story: string): string {
  return `### Task ${id}: Task ${id}\n**Story:** ${story}\n**Dependencies:** none\n**Done when:**\n- Child ${id} passes.\n`;
}

function plan(spanning = false): string {
  return [
    '# Implementation Plan: stacked runner',
    '',
    '**Stories:** .docs/stories/stacked-runner.md',
    '',
    '## Slices',
    '',
    '| Slice | Title | Tasks |',
    '| --- | --- | --- |',
    `| 1 | First | ${spanning ? '1, 2' : '1'} |`,
    `| 2 | Second | ${spanning ? '3' : '2, 3'} |`,
    '',
    task(1, '1'),
    task(2, '2'),
    task(3, spanning ? '2' : 'n/a'),
  ].join('\n');
}

async function fixture(options: { spanning?: boolean; config: string }) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'coverage-binding-stacked-root-'));
  const projectDir = join(projectRoot, 'feature-worktree');
  TEMPORARY_DIRECTORIES.push(projectRoot);
  const featureDesc = 'stacked-runner';
  const planPath = join(projectDir, '.docs', 'plans', `${featureDesc}.md`);
  await Promise.all([
    mkdir(join(projectRoot, '.ai-conductor'), { recursive: true }),
    mkdir(join(projectRoot, 'skills', 'tdd'), { recursive: true }),
    mkdir(join(projectDir, '.docs', 'plans'), { recursive: true }),
    mkdir(join(projectDir, '.docs', 'stories'), { recursive: true }),
    mkdir(join(projectDir, '.docs', 'complexity'), { recursive: true }),
  ]);
  await writeFile(join(projectRoot, 'skills', 'tdd', 'SKILL.md'), '# tdd\n');
  await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), options.config);
  await writeFile(planPath, plan(options.spanning));
  await writeFile(join(projectDir, '.docs', 'stories', `${featureDesc}.md`), STORIES);
  await writeFile(join(projectDir, '.docs', 'complexity', `${featureDesc}.md`), 'Tier: M\nStacked-Delivery: approved\n');
  const provider: LLMProvider = { lifecycleCapability: { synchronousSpawnPermit: true }, invoke: vi.fn() };
  const runner = new DefaultStepRunner(provider, 'stacked-runner-session', projectDir, {
    featureDesc,
    planPath,
    projectRoot,
    config: { coverage_binding: { judge: { enabled: false } }, stacked_prs: { enabled: false } },
  });
  return { featureDesc, planPath, projectDir, provider, projectRoot, runner };
}

afterEach(async () => {
  await Promise.all(TEMPORARY_DIRECTORIES.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('coverage-binding stacked delivery', () => {
  it('uses fresh canonical config and proceeds for an eligible sliced plan', async () => {
    const subject = await fixture({ config: 'stacked_prs:\n  enabled: true\n  max_slices: 2\n' });

    await expect(subject.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({
      success: true,
      output: 'coverage_binding judge disabled',
    });
    expect(JSON.parse(await readFile(join(subject.projectDir, '.pipeline', 'coverage-binding.json'), 'utf8'))).toMatchObject({
      status: 'disabled',
      storyOwnership: { '1': 1, '2': 2 },
    });
  });

  it('builds flat without a refusal when story ownership spans child positions', async () => {
    const subject = await fixture({ spanning: true, config: 'stacked_prs:\n  enabled: true\n  max_slices: 2\n' });

    await expect(subject.runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
    const envelope = JSON.parse(await readFile(join(subject.projectDir, '.pipeline', 'coverage-binding.json'), 'utf8'));
    expect(envelope).toMatchObject({ status: 'disabled', sliceMembership: { taskSlices: { '1': 1, '2': 1, '3': 2 } } });
    expect(envelope.storyOwnership).toBeUndefined();
  });

  it('builds flat without a refusal when fresh max_slices or resolved custom steps make the plan ineligible', async () => {
    const subject = await fixture({ config: [
      'stacked_prs:',
      '  enabled: true',
      '  max_slices: 1',
      'steps:',
      '  lint_gate:',
      '    after: test_suite',
      '    skill: skills/tdd/SKILL.md',
    ].join('\n') });

    const result = await subject.runner.run('coverage_binding', { complexity_tier: 'M' });

    expect(result).toMatchObject({ success: true });
    expect(result.refusal).toBeUndefined();
    const envelope = JSON.parse(await readFile(join(subject.projectDir, '.pipeline', 'coverage-binding.json'), 'utf8'));
    expect(envelope).toMatchObject({ status: 'disabled', sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 2 } } });
    expect(envelope.storyOwnership).toBeUndefined();
  });
});
