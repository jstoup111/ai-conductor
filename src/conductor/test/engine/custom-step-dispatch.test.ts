// Covers: task:9
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ projectRoot: string; config: HarnessConfig }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'custom-step-dispatch-'));
  temporaryRoots.push(projectRoot);
  const skill = '.ai-conductor/skills/renamed-directory/SKILL.md';
  const skillPath = join(projectRoot, skill);
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, '---\nname: maintain-documentation\n---\n');
  return {
    projectRoot,
    config: { steps: { 'docs-gate': { after: 'finish', skill, enforcement: 'advisory' } } },
  };
}

async function dispatch(
  projectRoot: string,
  config: HarnessConfig,
  step: string,
  providerKey = 'claude',
): Promise<{ result: Awaited<ReturnType<DefaultStepRunner['run']>>; provider: LLMProvider }> {
  const provider: LLMProvider = {
    invoke: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
  };
  const runner = new DefaultStepRunner(provider, 'custom-step-session', projectRoot, {
    config,
    providerKey,
  });
  return {
    result: await runner.run(step as StepName, {} as ConductState),
    provider,
  };
}

describe('custom step dispatch', () => {
  it('dispatches the configured skill name to Claude instead of the custom step key', async () => {
    const { projectRoot, config } = await fixture();
    const { provider } = await dispatch(projectRoot, config, 'docs-gate');

    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0]?.prompt).toBe('/maintain-documentation');
  });

  it('uses Codex native syntax for the configured custom skill', async () => {
    const { projectRoot, config } = await fixture();
    const { provider } = await dispatch(projectRoot, config, 'docs-gate', 'codex');

    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0]?.prompt).toBe('$maintain-documentation');
  });

  it('re-renders the configured custom skill for each provider during fallback', async () => {
    const { projectRoot, config } = await fixture();
    config.llm_provider = ['claude', 'codex'];
    config.steps!['docs-gate']!.llm_provider = 'claude';
    const claude: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: false,
        output: 'Claude unavailable',
        exitCode: 1,
        providerUnavailable: true,
        providerUnavailableScope: 'run',
        providerUnavailableReason: 'Claude unavailable',
      }),
    };
    const codex: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({ success: true, output: 'done', exitCode: 0 }),
    };
    const runner = new DefaultStepRunner(claude, 'custom-step-fallback', projectRoot, {
      config,
      providerExecution: {
        configuredProviders: ['claude', 'codex'],
        runtimes: new ProviderRuntimeSet([
          {
            key: 'claude', provider: claude, policy: CLAUDE_MODEL_POLICY, builtIn: true,
            lifecycleCapability: { synchronousSpawnPermit: true },
            availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
          },
          {
            key: 'codex', provider: codex, policy: CODEX_MODEL_POLICY, builtIn: true,
            lifecycleCapability: { synchronousSpawnPermit: true },
            availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
          },
        ]),
        sessions: new ProviderSessionStore(),
      },
    });
    await runner.resetSession('docs-gate' as StepName);

    const result = await runner.run('docs-gate' as StepName, {} as ConductState);
    const prompts = [
      vi.mocked(claude.invoke).mock.calls[0]?.[0]?.prompt,
      vi.mocked(codex.invoke).mock.calls[0]?.[0]?.prompt,
    ];

    expect({ success: result.success, prompts }).toEqual({
      success: true,
      prompts: ['/maintain-documentation', '$maintain-documentation'],
    });
    expect(prompts).not.toContain('docs-gate');
  });

  it.each([
    ['maintain-documentation', '/maintain-documentation'],
    ['release-disposition', '/release-disposition'],
  ])('keeps this repository custom step %s on its recorded base prompt', async (step, expectedPrompt) => {
    const config: HarnessConfig = {
      steps: {
        'maintain-documentation': {
          after: 'rebase',
          skill: '.agents/skills/maintain-documentation/SKILL.md',
          enforcement: 'gating',
        },
        'release-disposition': {
          after: 'maintain-documentation',
          skill: '.agents/skills/release-disposition/SKILL.md',
          enforcement: 'gating',
        },
      },
    };
    const { provider } = await dispatch(join(process.cwd(), '../..'), config, step);

    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0]?.prompt).toBe(expectedPrompt);
  });

  it('never sends the custom step key as the skill invocation', async () => {
    const { projectRoot, config } = await fixture();
    const { provider } = await dispatch(projectRoot, config, 'docs-gate');

    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0]?.prompt).not.toContain('docs-gate');
  });

  it('fails before provider invocation when the configured skill has no name', async () => {
    const { projectRoot, config } = await fixture();
    const configuredPath = config.steps?.['docs-gate']?.skill!;
    await writeFile(join(projectRoot, configuredPath), '---\ndescription: missing name\n---\n');
    const { provider, result } = await dispatch(projectRoot, config, 'docs-gate');

    expect({ result, calls: vi.mocked(provider.invoke).mock.calls.length }).toEqual({
      result: {
        success: false,
        output: expect.stringContaining(`docs-gate: configured skill ${configuredPath}`),
      },
      calls: 0,
    });
  });

  it('fails before provider invocation when the configured skill file is removed', async () => {
    const { projectRoot, config } = await fixture();
    const configuredPath = config.steps?.['docs-gate']?.skill!;
    await rm(join(projectRoot, configuredPath));
    const { provider, result } = await dispatch(projectRoot, config, 'docs-gate');

    expect({ result, calls: vi.mocked(provider.invoke).mock.calls.length }).toEqual({
      result: {
        success: false,
        output: expect.stringContaining(`docs-gate: configured skill ${configuredPath}`),
      },
      calls: 0,
    });
  });

  it('leaves a registry-rendered built-in step unchanged despite a skill override', async () => {
    const { projectRoot } = await fixture();
    const { provider } = await dispatch(projectRoot, {
      steps: { plan: { skill: '.ai-conductor/skills/renamed-directory/SKILL.md' } },
    }, 'plan');

    expect(vi.mocked(provider.invoke).mock.calls[0]?.[0]?.prompt).toBe('/plan');
  });
});
