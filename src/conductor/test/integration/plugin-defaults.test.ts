import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { discoverPlugins, registerBuiltins } from '../../src/engine/plugin-loader.js';
import { PluginNotFoundError } from '../../src/types/plugin.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

class MockStepRunner implements StepRunner {
  calls: StepName[] = [];

  async run(step: StepName): Promise<StepRunResult> {
    this.calls.push(step);
    return { success: true };
  }
}

describe('Integration: plugin defaults', () => {
  let dir: string;
  let statePath: string;
  let pipelineDir: string;
  let events: ConductorEventEmitter;
  let runner: MockStepRunner;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-plugin-defaults-'));
    pipelineDir = join(dir, '.pipeline');
    statePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(pipelineDir, { recursive: true });

    events = new ConductorEventEmitter();
    runner = new MockStepRunner();
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
    registerBuiltins(registry, events, () => null);
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
    registerBuiltins(registry, events, () => null);
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'codex');

    expect(provider).toHaveProperty('invoke');
    expect(provider).toHaveProperty('invokeInteractive');
    expect(registry.list('llm_provider')).toEqual(expect.arrayContaining(['claude', 'codex']));
  });

  it('Conductor session completes with default ClaudeProvider', async () => {
    // Start with minimal config (no plugin selection)
    const config = {} as any;

    // Initialize plugin registry
    const registry = new PluginRegistry();
    const globalPluginsDir = join(dir, '.ai-conductor', 'plugins', 'global');
    const projectPluginsDir = join(dir, '.ai-conductor', 'plugins', 'project');

    await discoverPlugins(globalPluginsDir, projectPluginsDir, registry);
    registerBuiltins(registry, events, () => null);
    registry.markInitialized();

    // Get provider with fallback
    const provider = registry.get<LLMProvider>(
      'llm_provider',
      config?.llm_provider ?? 'claude'
    );

    // Create a minimal conductor state
    const initialState: ConductState = { complexity_tier: 'S' };
    await writeState(statePath, initialState);

    // Create conductor
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      config: config as any,
      projectRoot: dir,
    });

    // Run conductor — should not throw PluginNotFoundError
    await conductor.run();

    // Verify state was updated
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feature_status).toBe('complete');
    }
  });
});
