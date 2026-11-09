// Covers: task:6
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { dispatchGitGuard } from './dispatch-git-guard.js';

interface CodexProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
  threadIds: string[];
}

type CodexFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

async function createFake(script?: CodexFakeScript): Promise<CodexProviderFake> {
  const loaded = await import('./codex-provider-fake.js').catch(() => null);
  const factory = (loaded as {
    createCodexProviderFake?: (script?: CodexFakeScript) => CodexProviderFake;
  } | null)?.createCodexProviderFake;
  expect(factory, 'codex-provider-fake.ts must export createCodexProviderFake').toBeTypeOf('function');
  return factory!(script);
}

function options(overrides: Partial<InvokeOptions> = {}): InvokeOptions {
  return {
    prompt: 'Complete the task.',
    sessionId: 'session-1',
    resume: false,
    ...overrides,
  };
}

describe('createCodexProviderFake', () => {
  it('declares the same execution capabilities as CodexProvider', async () => {
    const fake = await createFake();
    const real = new CodexProvider(dispatchGitGuard);

    expect(fake.provider.supportsSessionResume).toBe(real.supportsSessionResume);
    expect(fake.provider.lifecycleCapability).toEqual(real.lifecycleCapability);
    expect(fake.provider.nativeSchemaCapability).toEqual(real.nativeSchemaCapability);
    expect(fake.provider.systemPromptCapability).toEqual(real.systemPromptCapability);
  });

  it('records a permitted native-schema invocation with a structured terminal result', async () => {
    const fake = await createFake();
    const structured = await fake.provider.invoke(options({ nativeSchema: { type: 'object' } }));

    expect(structured).toMatchObject({ success: true, exitCode: 0 });
    expect(structured.finalStructuredResult).toBeDefined();
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects a denied permit before recording, minting a thread, or observing a spawn', async () => {
    const fake = await createFake();
    const onSpawn = vi.fn();

    await expect(fake.provider.invoke(options({
      onSpawn,
      spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
    }))).rejects.toThrow('revoked');

    expect(fake.calls).toEqual([]);
    expect(fake.threadIds).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('returns a script result unchanged after recording the permitted call', async () => {
    const scripted = { success: false, output: 'scripted', exitCode: 3 };
    const fake = await createFake(() => scripted);

    await expect(fake.provider.invoke(options())).resolves.toBe(scripted);
    expect(fake.calls).toEqual([options()]);
  });

  it('keeps the fresh-session thread and resume behavior unchanged', async () => {
    const fake = await createFake();

    const cold = await fake.provider.invoke(options());
    const resumed = await fake.provider.invoke(options({ resume: true }));

    expect(cold.success).toBe(true);
    expect(fake.threadIds).toHaveLength(1);
    expect(resumed).toMatchObject({
      success: false,
      output: 'no rollout found for thread id session-1',
      exitCode: 1,
    });
  });

  it('does not import a process-launching module', async () => {
    const source = await readFile(fileURLToPath(new URL('./codex-provider-fake.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/(?:from|import)\s+['"](?:execa|child_process|node:child_process)['"]/);
  });
});
