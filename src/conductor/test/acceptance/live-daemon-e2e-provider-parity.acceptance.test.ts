/**
 * Acceptance coverage for
 * `.docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md`.
 *
 * The real Claude and Codex processes remain confined to opt-in smoke files.
 * These specs exercise the repository-level contract with production registry
 * and smoke-runner code, deterministic fakes at the provider boundary, and the
 * committed workflow/fixture artifacts.
 *
 * PRE-IMPLEMENTATION RED: the provider-specific capabilities, descriptor
 * manifest, shared run body, Codex leg, and load-bearing workflow matrix do not
 * exist yet.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { registerBuiltins } from '../../src/engine/plugin-loader.js';
import { runSmokeCli } from '../../src/engine/smoke-runner.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const CONDUCTOR_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const MANIFEST_PATH = join(CONDUCTOR_ROOT, 'test/fixtures/live-e2e-providers.ts');
const SHARED_BODY_PATH = join(CONDUCTOR_ROOT, 'test/fixtures/live-e2e-run-body.ts');
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/live-daemon-e2e.yml');

const LIVE_FILES = {
  claude: 'test/engine/daemon-e2e-live-claude.smoke.test.ts',
  codex: 'test/engine/daemon-e2e-live-codex.smoke.test.ts',
} as const;

async function requiredSource(path: string): Promise<string> {
  return readFile(path, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required provider-parity artifact is not implemented: ${path}: ${detail}`);
  });
}

async function liveProviderIds(): Promise<string[]> {
  try {
    const module = await import(/* @vite-ignore */ MANIFEST_PATH) as {
      LIVE_E2E_PROVIDERS?: unknown;
    };
    const manifest = module.LIVE_E2E_PROVIDERS;
    if (Array.isArray(manifest)) {
      return manifest.map((descriptor: unknown) => {
        if (typeof descriptor !== 'object' || descriptor === null) return '';
        const fields = descriptor as Record<string, unknown>;
        return String(fields.providerKey ?? fields.id ?? '');
      }).filter(Boolean);
    }
    if (typeof manifest === 'object' && manifest !== null) {
      return Object.keys(manifest);
    }
    throw new Error('LIVE_E2E_PROVIDERS is not an array or keyed manifest');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`required provider-parity manifest is not implemented: ${detail}`);
  }
}

function discoveredLeg(provider: keyof typeof LIVE_FILES): { file: string; source: string } {
  return {
    file: LIVE_FILES[provider],
    source: `const smokeCapability = 'credentialed:${provider}';`,
  };
}

describe('live daemon E2E provider parity (#1264)', () => {
  it('maps every registered provider to one descriptor-only live leg over the shared fixture body', async () => {
    const registry = new PluginRegistry();
    registerBuiltins(registry, new ConductorEventEmitter(), () => {});
    const registeredProviders = registry.list('llm_provider').sort();
    const [manifestProviders, sharedBody, fixturePlan, fixtureStories] = await Promise.all([
      liveProviderIds(),
      requiredSource(SHARED_BODY_PATH),
      requiredSource(join(CONDUCTOR_ROOT, 'test/fixtures/daemon-e2e/plan.md')),
      requiredSource(join(CONDUCTOR_ROOT, 'test/fixtures/daemon-e2e/stories.md')),
    ]);

    expect(registeredProviders).toEqual(['claude', 'codex']);
    expect(manifestProviders.sort()).toEqual(registeredProviders);
    for (const provider of registeredProviders) {
      const leg = await requiredSource(
        join(CONDUCTOR_ROOT, `test/engine/daemon-e2e-live-${provider}.smoke.test.ts`),
      );
      expect(leg).toContain(`credentialed:${provider}`);
      expect(leg).toMatch(/from\s+['"][^'"]*live-e2e-run-body(?:\.js)?['"]/);
      expect(leg).not.toMatch(/runDaemon|dumpPipelineDiagnostics|assertTokenCap/);
    }

    expect(sharedBody).toMatch(/runDaemon\s*\(/);
    expect(sharedBody).toContain("new URL('./daemon-e2e/plan.md', import.meta.url)");
    expect(sharedBody).toContain("new URL('./daemon-e2e/stories.md', import.meta.url)");
    expect(sharedBody).toMatch(/terminal[\s\S]*madeCommit[\s\S]*touchedFixture[\s\S]*taskTrailer/);
    expect(fixturePlan).toContain('touched.txt');
    expect(fixtureStories).toContain('touched.txt');
  });

  it('runs one credentialed provider and names the other provider-specific skip without coupling verdicts', async () => {
    const emit = vi.fn();
    const runVitest = vi.fn(async (file: string) => {
      if (file === LIVE_FILES.codex) throw new Error('Codex outcome failure');
      return { executedAssertions: true, output: '' };
    });

    await runSmokeCli('unused', {
      discover: async () => [discoveredLeg('claude'), discoveredLeg('codex')],
      runVitest,
      mode: 'advisory',
      hasCommand: () => true,
      environment: { CLAUDE_CODE_OAUTH_TOKEN: 'present' },
      emit,
    });

    expect(runVitest).toHaveBeenCalledTimes(1);
    expect(runVitest).toHaveBeenCalledWith(LIVE_FILES.claude);
    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${LIVE_FILES.claude} [credentialed:claude] ran`,
    );
    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${LIVE_FILES.codex} [credentialed:codex] skipped (unmet: CODEX_API_KEY)`,
    );
  });

  it('enforces credential-present legs, tolerates named absent legs, and rejects an empty gate', async () => {
    const emit = vi.fn();
    const runVitest = vi.fn(async () => ({ executedAssertions: true, output: '' }));
    const discover = async () => [discoveredLeg('claude'), discoveredLeg('codex')];

    await runSmokeCli('unused', {
      discover,
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: { CODEX_API_KEY: 'present' },
      emit,
    });

    expect(runVitest).toHaveBeenCalledTimes(1);
    expect(runVitest).toHaveBeenCalledWith(LIVE_FILES.codex);
    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${LIVE_FILES.claude} [credentialed:claude] skipped (unmet: CLAUDE_CODE_OAUTH_TOKEN)`,
    );
    expect(emit).toHaveBeenCalledWith(
      `smoke ledger: ${LIVE_FILES.codex} [credentialed:codex] ran`,
    );

    await expect(runSmokeCli('unused', {
      discover,
      runVitest,
      mode: 'gate',
      hasCommand: () => true,
      environment: {},
      emit,
    })).rejects.toThrow(/no credentialed test files/i);
  });

  it('shares cost, authentication, teardown, and diagnostics guarantees across provider legs', async () => {
    const runBody = await import(/* @vite-ignore */ SHARED_BODY_PATH) as {
      DEFAULT_LIVE_E2E_TOKEN_CAP: number;
      resolveLiveE2ETokenCap: (environment: NodeJS.ProcessEnv) => number;
      assertTokenCap: (totalTokens: number, unmetered: number, cap: number) => void;
      enforceLiveE2ETokenCap: <T>(
        run: () => Promise<T>,
        metrics: () => { totalTokens: number; unmetered: number },
        cap: number,
      ) => Promise<T>;
      assertDescriptorAuthenticationSource: (
        descriptor: unknown,
        provider: unknown,
      ) => Promise<void>;
      withProvisionedLiveProviderHome: <T>(
        sourceRoot: string,
        descriptor: unknown,
        provider: unknown,
        provision: (...args: unknown[]) => Promise<unknown>,
        run: (home: unknown) => Promise<T>,
      ) => Promise<T>;
      withLiveE2EFailureDiagnostics: <T>(
        worktreeDir: string | undefined,
        credentialValues: readonly string[],
        run: () => Promise<T>,
      ) => Promise<T>;
    };

    // Cost: one shared cap policy governs every leg, honors the env override,
    // and rejects an over-cap spend even when the leg itself already failed.
    expect(runBody.resolveLiveE2ETokenCap({ DAEMON_E2E_LIVE_TOKEN_CAP: '123' })).toBe(123);
    expect(runBody.resolveLiveE2ETokenCap({})).toBe(runBody.DEFAULT_LIVE_E2E_TOKEN_CAP);
    expect(() => runBody.assertTokenCap(11, 3, 10)).toThrow(/cap 10 exceeded.*observed 11.*unmetered results: 3/i);
    expect(() => runBody.assertTokenCap(10, 0, 10)).not.toThrow();
    await expect(runBody.enforceLiveE2ETokenCap(
      async () => 'leg completed',
      () => ({ totalTokens: 50, unmetered: 0 }),
      10,
    )).rejects.toThrow(/cap 10 exceeded/i);

    // Authentication: a leg whose provider resolves a different authentication
    // source than its descriptor expects is rejected before any spend.
    await expect(runBody.assertDescriptorAuthenticationSource(
      {
        expectedAuthenticationSource: 'oauth',
        resolveAuthenticationSource: async () => 'api-key',
      },
      {},
    )).rejects.toThrow(/expected oauth, resolved api-key/i);

    // Teardown: the provisioned throwaway home is torn down whether the leg
    // returns or throws.
    const teardown = vi.fn(async () => {});
    const provision = vi.fn(async () => ({ teardown }));
    await expect(runBody.withProvisionedLiveProviderHome(
      '/fixture-root', {}, {}, provision, async () => 'ran',
    )).resolves.toBe('ran');
    expect(teardown).toHaveBeenCalledTimes(1);
    await expect(runBody.withProvisionedLiveProviderHome(
      '/fixture-root', {}, {}, provision, async () => { throw new Error('leg failed'); },
    )).rejects.toThrow('leg failed');
    expect(teardown).toHaveBeenCalledTimes(2);

    // Diagnostics: a failing leg reports pipeline diagnostics and rethrows
    // with credential values redacted from the surfaced failure.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(runBody.withLiveE2EFailureDiagnostics(
        undefined,
        ['fixture-credential'],
        async () => { throw new Error('auth fixture-credential rejected'); },
      )).rejects.toThrow(/auth \[redacted\] rejected/);
      expect(consoleError.mock.calls.flat().join('\n')).toMatch(/pipeline diagnostics unavailable/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('makes the workflow matrix select and report each provider leg without exposing credentials', async () => {
    const source = await requiredSource(WORKFLOW_PATH);
    const workflow = loadYaml(source) as {
      jobs?: Record<string, { strategy?: { matrix?: { include?: Array<{ provider?: string }> } } }>;
    };
    const providers = Object.values(workflow.jobs ?? {})
      .flatMap((entry) => entry.strategy?.matrix?.include ?? [])
      .map(({ provider }) => provider ?? '');

    expect(providers.sort()).toEqual(['claude', 'codex']);
    expect(source).toContain(LIVE_FILES.claude);
    expect(source).toContain(LIVE_FILES.codex);
    expect(source).toMatch(/matrix\.provider[\s\S]*CLAUDE_CODE_OAUTH_TOKEN/);
    expect(source).toMatch(/matrix\.provider[\s\S]*CODEX_API_KEY/);
    expect(source).toMatch(/GITHUB_STEP_SUMMARY[\s\S]*matrix\.provider/);
    expect(source).not.toMatch(/echo[^\n]*(?:CLAUDE_CODE_OAUTH_TOKEN|CODEX_API_KEY)\s*=/);
  });
});
