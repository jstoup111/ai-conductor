import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { loadManifestFromFile } from './plugin-manifest.js';
import { PluginRegistry } from './plugin-registry.js';
import { PluginManifestError, PluginLoadError, PluginVersionError } from '../types/plugin.js';
import { ClaudeProvider } from '../execution/claude-provider.js';
import { TerminalSubscriber } from '../ui/subscriber.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { UIEventHandler } from '../ui/subscriber.js';

/**
 * Load and instantiate a plugin from its manifest and entrypoint.
 * Task 10: Validates the entrypoint file exists and the loaded module has
 * the required interface methods (e.g., invoke() for llm_provider).
 */
async function loadPluginModule(
  pluginDir: string,
  manifest: { kind: string; name: string; entrypoint: string }
): Promise<unknown> {
  const entrypointPath = join(pluginDir, manifest.entrypoint);

  try {
    const mod = await import(entrypointPath);
    const plugin = mod.default || mod;

    // Task 10: Validate interface shape based on kind
    if (manifest.kind === 'llm_provider') {
      if (typeof plugin.invoke !== 'function') {
        throw new PluginLoadError(
          `Plugin ${manifest.name} missing required method: invoke`
        );
      }
      if (typeof plugin.invokeInteractive !== 'function') {
        throw new PluginLoadError(
          `Plugin ${manifest.name} missing required method: invokeInteractive`
        );
      }
    }

    return plugin;
  } catch (err) {
    if (err instanceof PluginLoadError) {
      throw err;
    }
    throw new PluginLoadError(
      `Failed to load plugin ${manifest.name} from ${entrypointPath}: ${String(err)}`
    );
  }
}

/**
 * Discovers and registers plugins from filesystem directories.
 * Scans globalDir and projectDir for plugin subdirectories, loading plugin.yml
 * from each. Project-local plugins shadow global plugins with the same kind+name.
 * Missing directories are skipped without error.
 *
 * @param globalDir Path to global plugins directory (e.g., ~/.ai-conductor/plugins/)
 * @param projectDir Path to project-local plugins directory (e.g., .ai-conductor/plugins/)
 * @param registry PluginRegistry to register discovered plugins into
 */
export async function discoverPlugins(
  globalDir: string,
  projectDir: string,
  registry: PluginRegistry
): Promise<void> {
  // Load global plugins first
  if (existsSync(globalDir)) {
    const entries = readdirSync(globalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = join(globalDir, entry.name);
        const manifestPath = join(pluginPath, 'plugin.yml');
        try {
          const manifest = loadManifestFromFile(manifestPath);
          // Task 10: Load the actual plugin module
          const plugin = await loadPluginModule(pluginPath, manifest);
          registry.register(manifest.kind, manifest.name, plugin);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            // Skip invalid manifest in auto-discovery (Task 10 behavior)
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          } else if (err instanceof PluginVersionError || err instanceof PluginLoadError) {
            // Task 16: Version incompatibility and missing entrypoint errors should prevent conductor startup
            // Re-throw to stop the discovery process
            throw err;
          }
        }
      }
    }
  }

  // Load project-local plugins (these shadow global plugins with same kind+name)
  if (existsSync(projectDir)) {
    const entries = readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = join(projectDir, entry.name);
        const manifestPath = join(pluginPath, 'plugin.yml');
        try {
          const manifest = loadManifestFromFile(manifestPath);
          // Task 10: Load the actual plugin module
          const plugin = await loadPluginModule(pluginPath, manifest);

          // Check if we're shadowing a global plugin
          const globalPlugins = registry.list(manifest.kind);
          if (globalPlugins.includes(manifest.name)) {
            console.debug(
              `Plugin shadowing: kind=${manifest.kind}, name=${manifest.name}; ` +
              `project-local at ${projectDir} overrides global at ${globalDir}`
            );
          }

          // Register project-local plugin (overwrites global if same kind+name)
          registry.register(manifest.kind, manifest.name, plugin);
        } catch (err) {
          if (err instanceof PluginManifestError) {
            // Skip invalid manifest in auto-discovery
            console.warn(`Skipping plugin ${entry.name}: ${err.message}`);
          } else if (err instanceof PluginVersionError || err instanceof PluginLoadError) {
            // Task 16: Version incompatibility and missing entrypoint errors should prevent conductor startup
            // Re-throw to stop the discovery process
            throw err;
          }
        }
      }
    }
  }
}

/**
 * Registers built-in plugins (ClaudeProvider, TerminalSubscriber) into the registry.
 * Task 11: ClaudeProvider registers as llm_provider:claude
 * Task 12: TerminalSubscriber registers as ui_renderer:terminal
 * @returns TerminalSubscriber instance so caller can call start()/stop()
 */
export function registerBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  renderEvent: UIEventHandler
): TerminalSubscriber {
  // Task 11: Register ClaudeProvider
  registry.register('llm_provider', 'claude', new ClaudeProvider());

  // Task 12: Register TerminalSubscriber
  const subscriber = new TerminalSubscriber(events, renderEvent);
  registry.register('ui_renderer', 'terminal', subscriber);

  return subscriber;
}
