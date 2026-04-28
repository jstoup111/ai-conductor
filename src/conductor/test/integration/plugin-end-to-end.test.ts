import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import { discoverPlugins, registerBuiltins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';

/**
 * Mock step runner that collects invoke outputs for assertion
 */
class EchoCaptureStepRunner implements StepRunner {
  calls: StepName[] = [];
  invokeOutputs: string[] = [];
  provider?: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  async run(step: StepName): Promise<StepRunResult> {
    this.calls.push(step);
    if (this.provider) {
      const result = await this.provider.invoke({
        prompt: `Test prompt for ${step}`,
        sessionId: 'test-session',
        resume: false,
      });
      this.invokeOutputs.push(result.output);
      return { success: result.success };
    }
    return { success: true };
  }
}

describe('Integration: EchoProvider E2E plugin loading', () => {
  let tempDir: string;
  let pluginDir: string;
  let statePath: string;
  let events: ConductorEventEmitter;
  let runner: EchoCaptureStepRunner;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await mkdtemp(join(tmpdir(), 'echo-provider-e2e-'));
    pluginDir = join(tempDir, 'plugins');
    await mkdir(pluginDir, { recursive: true });
    statePath = join(tempDir, 'conduct-state.json');
    events = new ConductorEventEmitter();

    // Create EchoProvider plugin
    const echoProviderDir = join(pluginDir, 'echo-provider');
    await mkdir(echoProviderDir, { recursive: true });

    // Write plugin.yml
    const manifestContent = `kind: llm_provider
name: echo
entrypoint: index.js
harness_version: ">=0.99.0"
`;
    await writeFile(join(echoProviderDir, 'plugin.yml'), manifestContent);

    // Write index.js - simple echo provider
    const indexContent = `
export default {
  async invoke(options) {
    const output = "ECHO: " + options.prompt;
    return {
      success: true,
      output: output,
      exitCode: 0,
    };
  },
  async invokeInteractive(options) {
    console.log("ECHO (interactive): " + options.prompt);
  }
};
`;
    await writeFile(join(echoProviderDir, 'index.js'), indexContent);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers and loads EchoProvider from temp plugin dir', async () => {
    // Discover plugins from our temp directory
    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    // Verify EchoProvider was registered
    const provider = registry.get<LLMProvider>('llm_provider', 'echo');
    expect(provider).toBeDefined();
  });

  it('EchoProvider invoke() returns output prefixed with ECHO:', async () => {
    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'echo');
    expect(provider).toBeDefined();

    // Test invoke
    const result = await provider.invoke({
      prompt: 'test message',
      sessionId: 'test-session',
      resume: false,
    });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/^ECHO: /);
    expect(result.output).toBe('ECHO: test message');
  });

  it('conductor session with EchoProvider uses the loaded plugin', async () => {
    await writeState(statePath, { complexity_tier: 'S' } as ConductState);

    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'echo');
    runner = new EchoCaptureStepRunner(provider);

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
    });

    await conductor.run();

    // Verify conductor ran successfully
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.feature_status).toBe('complete');

    // Verify all invoke() outputs started with "ECHO: "
    for (const output of runner.invokeOutputs) {
      expect(output).toMatch(/^ECHO: /);
    }
  });

  it('src/index.ts has no hardcoded EchoProvider reference', async () => {
    const indexFilePath = join(
      __dirname,
      '../../src/index.ts'
    );
    const content = await readFile(indexFilePath, 'utf-8');

    // Verify no hardcoded EchoProvider instantiation
    expect(content).not.toMatch(/EchoProvider/);
    expect(content).not.toMatch(/new EchoProvider/);
  });

  // Task 16: Negative paths — version-mismatch and missing-entrypoint
  it('throws PluginVersionError before any step runs when plugin harness_version is incompatible', async () => {
    // Create a version-incompatible plugin with harness_version: "^99.0.0"
    const incompatibleProviderDir = join(pluginDir, 'incompatible-provider');
    await mkdir(incompatibleProviderDir, { recursive: true });

    // Write plugin.yml with incompatible version
    const manifestContent = `kind: llm_provider
name: incompatible
entrypoint: index.js
harness_version: "^99.0.0"
`;
    await writeFile(join(incompatibleProviderDir, 'plugin.yml'), manifestContent);

    // Write index.js (it won't be loaded due to version mismatch)
    const indexContent = `
export default {
  async invoke(options) {
    return { success: true, output: "SHOULD NOT LOAD", exitCode: 0 };
  },
  async invokeInteractive(options) {}
};
`;
    await writeFile(join(incompatibleProviderDir, 'index.js'), indexContent);

    // Attempt to discover and load plugins
    const registry = new PluginRegistry();
    const { PluginVersionError } = await import('../../src/types/plugin.js');

    // Version mismatch should cause discovery to fail immediately
    // This prevents incompatible plugins from being registered
    let threwVersionError = false;
    try {
      await discoverPlugins(pluginDir, '', registry);
    } catch (err) {
      expect(err).toBeInstanceOf(PluginVersionError);
      expect(err instanceof Error && err.message).toMatch(/incompatible|harness/i);
      threwVersionError = true;
    }
    expect(threwVersionError).toBe(true);
  });

  it('throws PluginLoadError with file path when plugin entrypoint file is missing', async () => {
    // Create a plugin with missing entrypoint file
    const missingEntrypointDir = join(pluginDir, 'missing-entrypoint-provider');
    await mkdir(missingEntrypointDir, { recursive: true });

    // Write plugin.yml pointing to non-existent file
    const manifestContent = `kind: llm_provider
name: missing
entrypoint: does-not-exist.js
harness_version: ">=0.99.0"
`;
    await writeFile(join(missingEntrypointDir, 'plugin.yml'), manifestContent);

    // Do NOT write the entrypoint file - it should be missing

    // Attempt to discover and load plugins
    const registry = new PluginRegistry();
    const { PluginLoadError } = await import('../../src/types/plugin.js');

    // Missing entrypoint should cause discovery to fail
    let threwLoadError = false;
    try {
      await discoverPlugins(pluginDir, '', registry);
    } catch (err) {
      expect(err).toBeInstanceOf(PluginLoadError);
      expect(err instanceof Error && err.message).toMatch(/does-not-exist\.js|missing/);
      threwLoadError = true;
    }
    expect(threwLoadError).toBe(true);
  });

});
