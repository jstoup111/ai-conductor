import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { discoverPlugins, registerBuiltins } from '../../src/engine/plugin-loader.js';
import { PluginNotFoundError } from '../../src/types/plugin.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  resolveProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { normalizeProviderSelection } from '../../src/engine/provider-selection.js';
import { validateConfig } from '../../src/engine/config.js';

describe('Integration: plugin defaults', () => {
  let dir: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-plugin-defaults-'));
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('Conductor with minimal/blank config uses ClaudeProvider by default', async () => {
    // Blank config: no llm_provider field specified
    const config = {};

    // Initialize plugin registry and discover plugins (no external plugins in temp dir)
    const registry = new PluginRegistry();
    const globalPluginsDir = join(dir, '.ai-conductor', 'plugins', 'global');
    const projectPluginsDir = join(dir, '.ai-conductor', 'plugins', 'project');

    // Discover and register external plugins, then built-ins
    await discoverPlugins(globalPluginsDir, projectPluginsDir, registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    // Should not throw PluginNotFoundError when retrieving 'claude' provider
    const provider = registry.get<LLMProvider>(
      'llm_provider',
      'claude' // Fallback from (config as any).llm_provider ?? 'claude'
    );

    expect(provider).toBeDefined();
    expect(provider).toHaveProperty('invoke');
    expect(provider).toHaveProperty('invokeInteractive');
  });

  it('registers Codex as an opt-in built-in provider without changing the default', async () => {
    const registry = new PluginRegistry();
    await discoverPlugins(
      join(dir, '.ai-conductor', 'plugins', 'global'),
      join(dir, '.ai-conductor', 'plugins', 'project'),
      registry,
    );
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'codex');

    expect(provider).toHaveProperty('invoke');
    expect(provider).toHaveProperty('invokeInteractive');
    expect(registry.list('llm_provider')).toEqual(expect.arrayContaining(['claude', 'codex']));
  });

  it.each(['claude', 'codex'] as const)(
    'keeps scalar %s as the complete one-provider selection',
    (providerKey) => {
      const result = validateConfig({ llm_provider: providerKey });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.llm_provider).toBe(providerKey);
      expect(normalizeProviderSelection(result.config.llm_provider)).toEqual([
        providerKey,
      ]);
      expect(result.warnings).toEqual([]);
    },
  );

  it('selects each provider and its exact built-in or compatibility policy from the same key', async () => {
    const registry = new PluginRegistry();
    registerBuiltins(registry, events, () => {});
    const pluginKey = 'nebula-plugin';
    const pluginProvider: LLMProvider = {
      async invoke() {
        return { success: true, output: 'nebula', exitCode: 0 };
      },
      async invokeInteractive() {},
    };
    registry.register('llm_provider', pluginKey, pluginProvider);
    registry.markInitialized();

    const expectedClaude = registry.get<LLMProvider>('llm_provider', 'claude');
    const expectedCodex = registry.get<LLMProvider>('llm_provider', 'codex');
    const warnings: Array<{ key: string; message: string }> = [];
    const select = (key: string) => ({
      provider: registry.get<LLMProvider>('llm_provider', key),
      policy: resolveProviderModelPolicy(key, (message) => {
        warnings.push({ key, message });
      }),
    });

    const claude = select('claude');
    const codex = select('codex');
    const plugin = select(pluginKey);
    const pluginWarnings = warnings.filter(({ key }) => key === pluginKey);

    expect({
      claudeProviderIsExactSelection: claude.provider === expectedClaude,
      claudePolicyIsExactBuiltIn: claude.policy === CLAUDE_MODEL_POLICY,
      claudeWarningCount: warnings.filter(({ key }) => key === 'claude').length,
      codexProviderIsExactSelection: codex.provider === expectedCodex,
      codexPolicyIsExactBuiltIn: codex.policy === CODEX_MODEL_POLICY,
      codexWarningCount: warnings.filter(({ key }) => key === 'codex').length,
      pluginProviderIdentityRetained: plugin.provider === pluginProvider,
      pluginPolicyIsExactCompatibilityPolicy:
        plugin.policy === CLAUDE_MODEL_POLICY,
      pluginWarningCount: pluginWarnings.length,
      pluginWarningNamesKey:
        pluginWarnings[0]?.message.includes(pluginKey) ?? false,
      pluginWarningExplainsHowToAddPolicy:
        /add (?:a )?provider model policy/i.test(
          pluginWarnings[0]?.message ?? '',
        ),
    }).toEqual({
      claudeProviderIsExactSelection: true,
      claudePolicyIsExactBuiltIn: true,
      claudeWarningCount: 0,
      codexProviderIsExactSelection: true,
      codexPolicyIsExactBuiltIn: true,
      codexWarningCount: 0,
      pluginProviderIdentityRetained: true,
      pluginPolicyIsExactCompatibilityPolicy: true,
      pluginWarningCount: 1,
      pluginWarningNamesKey: true,
      pluginWarningExplainsHowToAddPolicy: true,
    });
  });

});
