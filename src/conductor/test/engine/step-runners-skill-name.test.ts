// Covers: task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function skillRoot(frontmatter: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'step-skill-name-'));
  roots.push(root);
  const directory = join(root, 'skills', 'explore');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), frontmatter);
  return root;
}

async function renamedSkillRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'step-skill-name-renamed-'));
  roots.push(root);
  await Promise.all([
    'build-review-security',
    'rebase-regrade',
    'rebase',
    'conduct',
    'pr',
  ].map(async (skill) => {
    const directory = join(root, 'skills', skill);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), `---\nname: ac-${skill}\n---\n`);
  }));
  return root;
}

describe('DefaultStepRunner skill-name root', () => {
  it('renders a built-in invocation from the served skill frontmatter', async () => {
    const root = await skillRoot('---\nname: ac-explore\n---\n');
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    });

    await runner.run('explore', {});

    expect(invoke.mock.calls[0]?.[0].prompt).toBe('$ac-explore');
  });

  it('falls back to the directory name when the root is null', async () => {
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', '/project', { providerKey: 'codex' });

    await runner.run('explore', {});

    expect(invoke.mock.calls[0]?.[0].prompt).toBe('$explore');
  });

  it('reports a missing served skill without invoking the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'step-skill-name-missing-'));
    roots.push(root);
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const result = await new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    }).run('explore', {});

    expect({ success: result.success, output: result.output, calls: invoke.mock.calls.length }).toEqual({
      success: false,
      output: expect.stringMatching(new RegExp(`step explore.*${join(root, 'skills', 'explore', 'SKILL.md')}`)),
      calls: 0,
    });
  });

  it('reports unclosed served frontmatter without invoking the provider', async () => {
    const root = await skillRoot('---\nname: ac-explore\n');
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const result = await new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    }).run('explore', {});

    expect({ success: result.success, output: result.output, calls: invoke.mock.calls.length }).toEqual({
      success: false,
      output: expect.stringMatching(/step explore.*Unclosed SKILL\.md frontmatter/),
      calls: 0,
    });
  });
});

describe('DefaultStepRunner auxiliary and legacy skill names', () => {
  it.each([
    ['claude', '/'],
    ['codex', '$'],
  ] as const)('uses frontmatter names for auxiliary and legacy %s dispatches', async (providerKey, prefix) => {
    const root = await renamedSkillRoot();
    const invoke = vi.fn(async () => ({
      success: true,
      output: 'MODELS: 0\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S',
      exitCode: 0,
    }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey,
      skillNameRoot: root,
    });

    await (runner as unknown as {
      dispatchBuildReviewRubric: (branch: unknown, projection: unknown) => Promise<unknown>;
    }).dispatchBuildReviewRubric({
      rubric: 'security',
      skillName: 'build-review-security',
      policy: {
        enabled: true, llm_provider: providerKey, model: 'test', effort: 'high',
        model_fallback_ladder: [], max_retries: 0, escalate: false,
      },
    }, {
      rubric: 'security', contractVersion: 'v1', projectionVersion: 'v1',
      lapId: 'lap', snapshotDigest: 'sha256:test', digest: 'sha256:test',
    });
    await runner.dispatchRebaseRegradeJudgement('Judge the rebase.');
    await runner.resolveRebaseConflict({
      conflicts: [], projectRoot: root, baseRef: 'origin/main',
    });
    await runner.assessComplexity();
    const finishPrompt = await (runner as unknown as {
      buildSystemPrompt: (step: 'finish', autonomous: boolean, retryReason?: string, finishProsePass?: 'author') => Promise<string>;
    }).buildSystemPrompt('finish', false, undefined, 'author');

    const prompts = invoke.mock.calls.map(([options]) => options.prompt);
    expect(prompts).toEqual(expect.arrayContaining([
      expect.stringContaining(`${prefix}ac-build-review-security\n\n`),
      `${prefix}ac-rebase-regrade\n\nJudge the rebase.`,
      '/ac-rebase',
      '/ac-conduct complexity',
    ]));
    expect(finishPrompt).toContain('`/ac-pr`');
    expect(finishPrompt).toContain('`$ac-pr`');
  });

  it.each([
    ['claude', '/'],
    ['codex', '$'],
  ] as const)('keeps shipped auxiliary and legacy %s prompts unchanged', async (providerKey, prefix) => {
    const invoke = vi.fn(async () => ({
      success: true,
      output: 'MODELS: 0\nINTEGRATIONS: 0\nAUTH: 0\nSTATE_MACHINES: 0\nSTORIES: 1\nTIER: S',
      exitCode: 0,
    }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', '/project', { providerKey });

    await runner.dispatchRebaseRegradeJudgement('Judge the rebase.');
    await runner.resolveRebaseConflict({ conflicts: [], projectRoot: '/project', baseRef: 'origin/main' });
    await runner.assessComplexity();
    const finishPrompt = await (runner as unknown as {
      buildSystemPrompt: (step: 'finish', autonomous: boolean, retryReason?: string, finishProsePass?: 'author') => Promise<string>;
    }).buildSystemPrompt('finish', false, undefined, 'author');

    expect(invoke.mock.calls.map(([options]) => options.prompt)).toEqual(expect.arrayContaining([
      `${prefix}rebase-regrade\n\nJudge the rebase.`,
      '/rebase',
      '/conduct complexity',
    ]));
    expect(finishPrompt).toContain('`/pr`');
    expect(finishPrompt).toContain('`$pr`');
  });
});
