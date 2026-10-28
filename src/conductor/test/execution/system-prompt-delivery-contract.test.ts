// Covers: task:14
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Options as ExecaOptions } from 'execa';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import {
  BUILT_IN_PROVIDERS,
  type BuiltInProviderId,
} from '../../src/execution/provider-catalog.js';
import { PiProvider, type PiEnvironment } from '../../src/execution/pi-provider.js';

type DeliveryCapture = {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly files: ReadonlyMap<string, string>;
};

type DeliveryHarness = {
  invoke(systemPrompt: string): Promise<DeliveryCapture>;
  assertShortTransport(capture: DeliveryCapture): void;
};

const prompt = 'perform the requested work';

const invokeOptions = (systemPrompt: string): InvokeOptions => ({
  prompt,
  systemPrompt,
  sessionId: 'delivery-contract',
  resume: false,
});

function completedClaudeResult() {
  return {
    stdout: JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }),
    stderr: '',
    exitCode: 0,
    failed: false,
  };
}

function completedCodexResult() {
  return {
    stdout: [
      JSON.stringify({ type: 'thread.started', thread_id: 'delivery-contract' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join('\n'),
    stderr: '',
    exitCode: 0,
    failed: false,
  };
}

function completedPiResult() {
  return {
    stdout: JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    }),
    stderr: '',
    exitCode: 0,
  };
}

async function captureDelivery(
  args: readonly string[],
  options: ExecaOptions,
  fileFlags: readonly ('--append-system-prompt' | '--append-system-prompt-file')[],
): Promise<DeliveryCapture> {
  const files = new Map<string, string>();
  for (const [index, value] of args.entries()) {
    if (!fileFlags.includes(value as typeof fileFlags[number])) continue;
    const path = args[index + 1];
    if (!path) continue;
    try {
      files.set(path, await readFile(path, 'utf8'));
    } catch {
      // Pi's installed HARNESS.md is represented by the fake environment;
      // only the per-invocation system-prompt file needs capturing here.
    }
  }
  return { argv: [...args], stdin: String(options.input ?? ''), files };
}

const harnesses = {
  claude: {
    async invoke(systemPrompt: string): Promise<DeliveryCapture> {
      let capture: DeliveryCapture | undefined;
      const provider = new ClaudeProvider(undefined, (async (
        _file: string,
        args: readonly string[],
        options: ExecaOptions,
      ) => {
        capture = await captureDelivery(args, options, ['--append-system-prompt-file']);
        return completedClaudeResult() as never;
      }) as never, 'claude');

      await provider.invoke(invokeOptions(systemPrompt));
      return capture!;
    },
    assertShortTransport(capture: DeliveryCapture): void {
      const index = capture.argv.indexOf('--append-system-prompt-file');
      const path = capture.argv[index + 1];
      expect(index).toBeGreaterThanOrEqual(0);
      expect(capture.files.get(path!)).toBe('S');
    },
  },
  codex: {
    async invoke(systemPrompt: string): Promise<DeliveryCapture> {
      let capture: DeliveryCapture | undefined;
      const provider = new CodexProvider(
        async () => ({
          stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }),
          exitCode: 0,
        }),
        'codex',
        undefined,
        (async (
          _file: string,
          args: readonly string[],
          options: ExecaOptions,
        ) => {
          capture = await captureDelivery(args, options, []);
          return completedCodexResult() as never;
        }) as never,
      );

      await provider.invoke(invokeOptions(systemPrompt));
      return capture!;
    },
    assertShortTransport(capture: DeliveryCapture): void {
      expect(capture.stdin).toBe(`S\n\n${prompt}`);
    },
  },
  pi: {
    async invoke(systemPrompt: string): Promise<DeliveryCapture> {
      let capture: DeliveryCapture | undefined;
      const environment: PiEnvironment = {
        stat: async (path) => path === '/unused-home/.agents/skills/HARNESS.md'
          ? { isFile: () => true, isDirectory: () => false }
          : stat(path),
        access: async () => {},
        env: {},
        homeDir: () => '/unused-home',
        cwd: () => '/unused-cwd',
      };
      const provider = new PiProvider('pi', async (_file, args, options) => {
        capture = await captureDelivery(args, options, ['--append-system-prompt']);
        return completedPiResult();
      }, environment);

      await provider.invoke({ ...invokeOptions(systemPrompt), cwd: '/unused-cwd' });
      return capture!;
    },
    assertShortTransport(capture: DeliveryCapture): void {
      const flags = capture.argv.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const path = capture.argv[flags[1]! + 1];
      expect(capture.files.get(path!)).toBe('S');
    },
  },
} satisfies Record<BuiltInProviderId, DeliveryHarness>;

function assertDeliversSystemPrompt(id: string, capture: DeliveryCapture, text: string): void {
  const fileDelivered = [...capture.files.entries()].some(([path, contents]) =>
    (capture.argv.includes('--append-system-prompt') || capture.argv.includes('--append-system-prompt-file'))
    && capture.argv.includes(path)
    && contents === text,
  );
  if (capture.stdin.startsWith(text) || fileDelivered) return;
  throw new Error(`${id} did not deliver the engine system prompt`);
}

type ProviderDescriptor = {
  readonly id: string;
  createAdapter(): Pick<LLMProvider, 'systemPromptCapability'>;
};

async function runDeliveryContract(descriptor: ProviderDescriptor, harness: DeliveryHarness): Promise<void> {
  expect(descriptor.createAdapter().systemPromptCapability).toEqual({ deliversSystemPrompt: true });

  const shortCapture = await harness.invoke('S');
  assertDeliversSystemPrompt(descriptor.id, shortCapture, 'S');
  harness.assertShortTransport(shortCapture);

  const largePrompt = 'S'.repeat(307_200);
  const largeCapture = await harness.invoke(largePrompt);
  assertDeliversSystemPrompt(descriptor.id, largeCapture, largePrompt);
  expect(largeCapture.argv.some((value) => value.includes(largePrompt))).toBe(false);
}

describe('built-in system-prompt delivery contract', () => {
  for (const descriptor of BUILT_IN_PROVIDERS) {
    it(`${descriptor.id} declares and delivers system prompts`, async () => {
      await runDeliveryContract(descriptor, harnesses[descriptor.id]);
    });
  }

  it('names a built-in fixture that drops the system prompt', async () => {
    const droppedAdapter: Pick<LLMProvider, 'systemPromptCapability' | 'invoke'> = {
      systemPromptCapability: { deliversSystemPrompt: true },
      async invoke(options): Promise<InvokeResult> {
        return { success: true, output: options.prompt, exitCode: 0 };
      },
    };
    const fixture = {
      ...BUILT_IN_PROVIDERS[0],
      id: 'drops-system-prompt',
      createAdapter: () => droppedAdapter,
    };
    const fixtureHarness: DeliveryHarness = {
      async invoke(systemPrompt: string): Promise<DeliveryCapture> {
        const result = await droppedAdapter.invoke(invokeOptions(systemPrompt));
        return { argv: [], stdin: result.output, files: new Map() };
      },
      assertShortTransport: () => {},
    };

    await expect(runDeliveryContract(fixture, fixtureHarness)).rejects.toThrow(/drops-system-prompt/);
  });
});
