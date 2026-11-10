// Covers: task:5
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PiProvider } from '../../src/execution/pi-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
} from '../../src/execution/llm-provider.js';
import { dispatchGitGuard } from './dispatch-git-guard.js';

interface PiProviderFake {
  provider: LLMProvider;
  calls: InvokeOptions[];
}

type PiFakeScript = (
  options: InvokeOptions,
  call: number,
) => InvokeResult | undefined;

async function createFake(script?: PiFakeScript): Promise<PiProviderFake> {
  const loaded = await import('./pi-provider-fake.js').catch(() => null);
  const factory = (loaded as {
    createPiProviderFake?: (script?: PiFakeScript) => PiProviderFake;
  } | null)?.createPiProviderFake;
  expect(factory, 'pi-provider-fake.ts must export createPiProviderFake').toBeTypeOf('function');
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

describe('createPiProviderFake', () => {
  it('declares the same execution capabilities as PiProvider', async () => {
    const fake = await createFake();
    const real = new PiProvider(dispatchGitGuard);

    expect(fake.provider.supportsSessionResume).toBe(real.supportsSessionResume);
    expect(fake.provider.lifecycleCapability).toEqual(real.lifecycleCapability);
    expect(fake.provider.nativeSchemaCapability).toEqual(real.nativeSchemaCapability);
    expect(fake.provider.systemPromptCapability).toEqual(real.systemPromptCapability);
  });

  it('records permitted calls and returns a native structured terminal result', async () => {
    const fake = await createFake();
    const onSpawn = vi.fn();

    await expect(fake.provider.invoke(options({ onSpawn }))).resolves.toMatchObject({
      success: true,
      exitCode: 0,
    });
    const structured = await fake.provider.invoke(options({ nativeSchema: { type: 'object' } }));

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toEqual(options({ onSpawn }));
    expect(onSpawn).toHaveBeenCalledOnce();
    expect(structured.output).not.toBe('');
    expect(structured.finalStructuredResult).toBeDefined();
  });

  it('rejects a denied permit before recording or observing a spawn', async () => {
    const fake = await createFake();
    const onSpawn = vi.fn();

    await expect(fake.provider.invoke(options({
      onSpawn,
      spawnPermit: () => ({ permitted: false, reason: 'revoked' }),
    }))).rejects.toThrow('revoked');

    expect(fake.calls).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('returns a script result unchanged after recording the permitted call', async () => {
    const scripted = { success: false, output: 'scripted', exitCode: 3 };
    const fake = await createFake(() => scripted);

    await expect(fake.provider.invoke(options())).resolves.toBe(scripted);
    expect(fake.calls).toEqual([options()]);
  });

  it('does not import a process-launching module', async () => {
    const source = await readFile(fileURLToPath(new URL('./pi-provider-fake.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/(?:from|import)\s+['"](?:execa|child_process|node:child_process)['"]/);
  });
});
