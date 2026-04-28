import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { discoverPlugins, registerBuiltins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { PluginVersionError, PluginLoadError } from '../../src/types/plugin.js';

/**
 * Integration tests for RecorderProvider reference plugin.
 *
 * Tests T9–T13 per the Feature 1.3 plan:
 *  T9  — happy path: discovers, registers, invoke() returns canned response + JSONL log
 *  T10 — misspelled kind in manifest is rejected (PluginManifestError)
 *  T11 — missing plugin dir is skipped without error
 *  T12 — version-incompatible manifest throws PluginVersionError
 *  T13 — empty prompt still logs and returns canned response
 *
 * Critical: src/conductor/src/index.ts must have no RecorderProvider reference.
 */
describe('Integration: RecorderProvider flow', () => {
  let tempDir: string;
  let pluginDir: string;
  let recordingPath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'recorder-flow-'));
    pluginDir = join(tempDir, 'plugins');
    recordingPath = join(tempDir, 'recordings', 'record.jsonl');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Helper: write a compiled JS RecorderProvider plugin into pluginDir
  // ---------------------------------------------------------------------------
  async function writeRecorderPlugin(
    opts: { recordingPath?: string; kind?: string; name?: string; harnessVersion?: string } = {}
  ): Promise<void> {
    const kind = opts.kind ?? 'llm_provider';
    const name = opts.name ?? 'recorder';
    const hv = opts.harnessVersion ?? '>=0.99.0';
    const recPath = opts.recordingPath ?? recordingPath;

    const providerDir = join(pluginDir, 'recorder-provider');
    await mkdir(providerDir, { recursive: true });

    const manifest = `kind: ${kind}\nname: ${name}\nentrypoint: index.js\nharness_version: "${hv}"\n`;
    await writeFile(join(providerDir, 'plugin.yml'), manifest);

    // Write a plain-JS implementation that the loader can import without transpilation.
    // Uses dynamic import-compatible CommonJS-style object export.
    const indexJs = `
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

class RecorderProviderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RecorderProviderError';
    this.cause = cause;
  }
}

class RecorderProvider {
  constructor(options) {
    this.recordingPath = options.recordingPath;
    this.dirEnsured = false;
  }

  async invoke(options) {
    await this._appendRecord('invoke', options);
    return { success: true, output: '[RecorderProvider] canned response', exitCode: 0 };
  }

  async invokeInteractive(options) {
    await this._appendRecord('invokeInteractive', options);
  }

  async _ensureDir() {
    if (this.dirEnsured) return;
    await mkdir(dirname(this.recordingPath), { recursive: true });
    this.dirEnsured = true;
  }

  async _appendRecord(kind, options) {
    try {
      await this._ensureDir();
      const record = JSON.stringify({ ts: new Date().toISOString(), kind, options });
      await appendFile(this.recordingPath, record + '\\n', 'utf-8');
    } catch (err) {
      throw new RecorderProviderError(
        'RecorderProvider failed to write to ' + this.recordingPath + ': ' + String(err),
        err
      );
    }
  }
}

export default new RecorderProvider({ recordingPath: ${JSON.stringify(recPath)} });
export { RecorderProvider, RecorderProviderError };
`;
    await writeFile(join(providerDir, 'index.js'), indexJs);
  }

  // ---------------------------------------------------------------------------
  // T9: Happy path
  // ---------------------------------------------------------------------------

  it('T9: discovers RecorderProvider, invoke() returns canned response and writes JSONL', async () => {
    await writeRecorderPlugin();

    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'recorder');
    expect(provider).toBeDefined();

    const result = await provider.invoke({
      prompt: 'integration test prompt',
      sessionId: 'session-001',
      resume: false,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('[RecorderProvider] canned response');
    expect(result.exitCode).toBe(0);

    // Verify JSONL file was written
    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.kind).toBe('invoke');
    expect(record.options.prompt).toBe('integration test prompt');
    expect(typeof record.ts).toBe('string');
  });

  it('T9b: invokeInteractive() writes JSONL with kind=invokeInteractive and resolves', async () => {
    await writeRecorderPlugin();

    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'recorder');
    await provider.invokeInteractive({
      prompt: 'interactive test',
      sessionId: 'session-002',
      resume: false,
    });

    const content = await readFile(recordingPath, 'utf-8');
    const record = JSON.parse(content.trim());
    expect(record.kind).toBe('invokeInteractive');
    expect(record.options.prompt).toBe('interactive test');
  });

  // ---------------------------------------------------------------------------
  // T10: Misspelled kind in manifest is rejected
  // ---------------------------------------------------------------------------

  it('T10: misspelled kind "llm_providor" causes manifest to be skipped (PluginManifestError)', async () => {
    await writeRecorderPlugin({ kind: 'llm_providor' }); // typo

    const registry = new PluginRegistry();
    // PluginManifestError is swallowed (console.warn) by discoverPlugins
    await expect(discoverPlugins(pluginDir, '', registry)).resolves.not.toThrow();

    // Plugin should NOT be registered
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const plugins = registry.list('llm_provider');
    expect(plugins).not.toContain('recorder');
  });

  // ---------------------------------------------------------------------------
  // T11: Missing plugin dir is skipped without error
  // ---------------------------------------------------------------------------

  it('T11: missing global and project plugin dirs are skipped silently', async () => {
    const registry = new PluginRegistry();

    // Both dirs do not exist — should not throw
    await expect(
      discoverPlugins(
        join(tempDir, 'nonexistent-global'),
        join(tempDir, 'nonexistent-project'),
        registry
      )
    ).resolves.not.toThrow();

    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    // Only builtins should be registered
    const providers = registry.list('llm_provider');
    expect(providers).toContain('claude');
  });

  // ---------------------------------------------------------------------------
  // T12: Version-incompatible manifest throws PluginVersionError
  // ---------------------------------------------------------------------------

  it('T12: harness_version "^99.0.0" causes PluginVersionError before any step runs', async () => {
    await writeRecorderPlugin({ harnessVersion: '^99.0.0' });

    const registry = new PluginRegistry();

    await expect(discoverPlugins(pluginDir, '', registry)).rejects.toThrow(PluginVersionError);
  });

  // ---------------------------------------------------------------------------
  // T13: Empty prompt logs and returns canned response
  // ---------------------------------------------------------------------------

  it('T13: empty prompt still appends JSONL and returns canned response', async () => {
    await writeRecorderPlugin();

    const registry = new PluginRegistry();
    await discoverPlugins(pluginDir, '', registry);
    registerBuiltins(registry, events, () => {});
    registry.markInitialized();

    const provider = registry.get<LLMProvider>('llm_provider', 'recorder');

    const result = await provider.invoke({
      prompt: '',
      sessionId: 'session-empty',
      resume: false,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('[RecorderProvider] canned response');

    const content = await readFile(recordingPath, 'utf-8');
    const record = JSON.parse(content.trim());
    expect(record.options.prompt).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Critical acceptance criterion: index.ts has no RecorderProvider reference
  // ---------------------------------------------------------------------------

  it('src/conductor/src/index.ts has no RecorderProvider reference', async () => {
    const indexPath = join(__dirname, '../../src/index.ts');
    const content = await readFile(indexPath, 'utf-8');
    expect(content).not.toMatch(/RecorderProvider/);
  });
});
