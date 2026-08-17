/**
 * RED acceptance specs for
 * `.docs/stories/live-daemon-e2e-build-step-never-runs-a-real-agent.md`.
 *
 * The real provider subprocess is replaced at ClaudeProvider's production
 * subprocess seam. The opt-in smoke remains the only test allowed to call a
 * real agent.
 *
 * Existing coverage intentionally retained elsewhere:
 * - daemon-e2e-live-agent-tier.acceptance.test.ts owns the outcome-only
 *   terminal/commit/fixture/trailer assertions, workflow trigger contract,
 *   shared diagnostics, and credentialed skip predicate.
 * - lower-layer TDD owns individual helper boundary cases and token-meter
 *   arithmetic; this file owns the cross-boundary story contracts.
 */

import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type { InvokeResult } from '../../src/execution/llm-provider.js';

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LIVE_RUN_BODY_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/live-e2e-run-body.ts',
);
const LIVE_HOME_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/live-provider-home.ts',
);
const PREFLIGHT_PATH = join(
  CONDUCTOR_ROOT,
  'test/fixtures/step-command-preflight.ts',
);
const CONDUCTOR_PATH = join(CONDUCTOR_ROOT, 'src/engine/conductor.ts');

async function requiredSource(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required live-tier behavior is not implemented: ${path}: ${detail}`);
  });
}

type UnresolvedCommandResult = InvokeResult & {
  commandUnresolved?: boolean;
  commandUnresolvedName?: string;
};

function providerForEnvelope(envelope: Record<string, unknown>): ClaudeProvider {
  const subprocessFactory = () => Promise.resolve({
    stdout: JSON.stringify(envelope),
    stderr: '',
    exitCode: 0,
    failed: false,
  }) as never;
  return new ClaudeProvider(undefined, subprocessFactory);
}

async function invokeEnvelope(
  prompt: string,
  envelope: Record<string, unknown>,
): Promise<UnresolvedCommandResult> {
  return providerForEnvelope(envelope).invoke({
    prompt,
    sessionId: 'acceptance-unresolved-command',
    resume: false,
    dangerouslySkipPermissions: true,
  });
}

describe('live daemon E2E command resolution (#1311)', () => {
  it('provisions copied checkout skills inside the selected live case and routes that home into dispatch', async () => {
    const { provisionLiveProviderHome } = await import(/* @vite-ignore */ LIVE_HOME_PATH) as {
      provisionLiveProviderHome: (
        sourceRoot: string,
        descriptor: { id: string },
        provider: { prepareSelfHostAuth?: (context: unknown) => Promise<{ env?: NodeJS.ProcessEnv } | void> },
        baseDir?: string,
      ) => Promise<{
        homeDir: string;
        childEnv(): NodeJS.ProcessEnv;
        teardown(): Promise<void>;
      }>;
    };
    const { ProvisionedHome } = await import(/* @vite-ignore */ LIVE_RUN_BODY_PATH) as {
      ProvisionedHome: new (
        provider: unknown,
        selfHost: unknown,
      ) => { invoke(options: Record<string, unknown>): Promise<unknown>; dispatches: number };
    };

    const repoRoot = dirname(dirname(CONDUCTOR_ROOT));
    const baseDir = await mkdtemp(join(tmpdir(), 'live-home-acceptance-'));
    const prepareSelfHostAuth = vi.fn(async () => ({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-token' } }));
    const home = await provisionLiveProviderHome(repoRoot, { id: 'claude' }, { prepareSelfHostAuth }, baseDir);

    try {
      // The checkout's skills are COPIED into the throwaway home, not linked.
      expect(existsSync(join(home.homeDir, 'skills', 'tdd', 'SKILL.md'))).toBe(true);
      expect((await lstat(join(home.homeDir, 'skills'))).isSymbolicLink()).toBe(false);

      // The home is isolated: ambient credentials never leak between legs, the
      // selected provider's auth seam repopulates only its own credential, and
      // the child is pointed at the throwaway home.
      expect(prepareSelfHostAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', homeDir: home.homeDir }));
      const childEnv = home.childEnv();
      expect(childEnv.CLAUDE_CONFIG_DIR).toBe(home.homeDir);
      expect(childEnv.CODEX_API_KEY).toBeUndefined();
      expect(childEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe('fixture-token');

      // The provisioned home is what dispatch receives: ProvisionedHome
      // overrides any caller-supplied selfHost with the provisioned one.
      const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
      const selfHost = { executable: 'claude', env: childEnv, args: [], teardown: () => home.teardown() };
      const provisioned = new ProvisionedHome({ invoke }, selfHost);
      await provisioned.invoke({ prompt: 'fixture', sessionId: 'fixture', resume: false });
      expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ selfHost }));
      expect(provisioned.dispatches).toBe(1);
    } finally {
      await home.teardown();
      await rm(baseDir, { recursive: true, force: true });
    }

    // Teardown removed the throwaway home entirely.
    expect(existsSync(home.homeDir)).toBe(false);
  });

  it('preflights every registry-rendered command from the provisioned home before provider dispatch', async () => {
    const { dispatchableStepCommands } = await import(/* @vite-ignore */ PREFLIGHT_PATH) as {
      dispatchableStepCommands: ((providerKey: string) => readonly { step: string; skillName: string; rendered: string }[]) & {
        assertResolves: (
          homeDir: string,
          providerKey?: string,
          dependencies?: { access?: (path: string) => Promise<void> },
        ) => Promise<void>;
      };
    };
    const { dispatchAfterLivePreflight } = await import(/* @vite-ignore */ LIVE_RUN_BODY_PATH) as {
      dispatchAfterLivePreflight: <T>(
        home: { homeDir: string },
        dispatch: () => Promise<T>,
        providerKey: string,
        preflight?: (homeDir: string, providerKey?: string) => Promise<void>,
      ) => Promise<T>;
    };

    // The command set is registry-derived and non-empty; every entry renders a
    // provider-specific invocation for a skill the isolated home must resolve.
    const commands = dispatchableStepCommands('claude');
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.rendered).toContain(command.skillName);
    }

    // A home holding every registry skill passes preflight; a home missing one
    // fails it, naming the unresolved skill.
    const resolvedPaths: string[] = [];
    await dispatchableStepCommands.assertResolves('/provisioned-home', 'claude', {
      access: async (path: string) => { resolvedPaths.push(path); },
    });
    expect(resolvedPaths).toEqual(commands.map(
      (command) => join('/provisioned-home', 'skills', command.skillName, 'SKILL.md'),
    ));
    const missing = commands[0].skillName;
    await expect(dispatchableStepCommands.assertResolves('/provisioned-home', 'claude', {
      access: async (path: string) => {
        if (path.includes(join('skills', missing))) throw new Error('ENOENT');
      },
    })).rejects.toThrow(new RegExp(`Unable to resolve skills.*${missing}`));

    // Preflight gates dispatch: it runs against the provisioned home with the
    // provider key first, and a failed preflight prevents any dispatch.
    const order: string[] = [];
    const dispatch = vi.fn(async () => { order.push('dispatch'); return 'dispatched'; });
    await expect(dispatchAfterLivePreflight(
      { homeDir: '/provisioned-home' },
      dispatch,
      'claude',
      async (homeDir, providerKey) => { order.push(`preflight:${homeDir}:${providerKey}`); },
    )).resolves.toBe('dispatched');
    expect(order).toEqual(['preflight:/provisioned-home:claude', 'dispatch']);

    const blockedDispatch = vi.fn(async () => 'dispatched');
    await expect(dispatchAfterLivePreflight(
      { homeDir: '/provisioned-home' },
      blockedDispatch,
      'claude',
      async () => { throw new Error('Unable to resolve skills tdd'); },
    )).rejects.toThrow(/unable to resolve skills/i);
    expect(blockedDispatch).not.toHaveBeenCalled();
  });

  it('classifies the observed zero-turn unknown-command envelope as a named failure at the provider boundary', async () => {
    const result = await invokeEnvelope('/pipeline', {
      subtype: 'success',
      is_error: false,
      num_turns: 0,
      result: 'Unknown command: /pipeline',
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    expect(result).toMatchObject({
      success: false,
      exitCode: 0,
      commandUnresolved: true,
      commandUnresolvedName: 'pipeline',
    });
    expect(result.output).toContain('/pipeline');
  });

  it('does not misclassify ordinary prose, a bare zero-turn result, or a different command', async () => {
    const [prose, bareZeroTurn, differentCommand] = await Promise.all([
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 3,
        result: 'I fixed an unknown command reported by the test.',
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: 'No work was required.',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      invokeEnvelope('/pipeline', {
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: 'Unknown command: /stories',
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ]);

    for (const result of [prose, bareZeroTurn, differentCommand]) {
      expect(result.success).toBe(true);
      expect(result.commandUnresolved).toBeUndefined();
      expect(result.commandUnresolvedName).toBeUndefined();
    }
  });

  it('routes unresolved commands as zero-retry mechanical failures while preserving outcome-based regression diagnostics', async () => {
    const [conductor, runBody] = await Promise.all([
      requiredSource(CONDUCTOR_PATH),
      requiredSource(LIVE_RUN_BODY_PATH),
    ]);

    expect(conductor).toMatch(/commandUnresolved/);
    expect(conductor).toMatch(/commandUnresolved[\s\S]{0,1200}mechanical|mechanical[\s\S]{0,1200}commandUnresolved/);
    expect(runBody).toMatch(/dumpPipelineDiagnostics/);
    expect(runBody).toMatch(/terminal[\s\S]*madeCommit[\s\S]*touchedFixture[\s\S]*taskTrailer/);

    const outcomeAssertion = runBody.match(/expect\s*\(\s*\{[\s\S]*?\}\s*\)\.toEqual\s*\(\s*\{[\s\S]*?\}\s*\)/)?.[0] ?? '';
    expect(outcomeAssertion).not.toMatch(/numTurns|turnCount|dispatchCount|agent wording/i);
  });
});
