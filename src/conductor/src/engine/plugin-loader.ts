import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { loadManifestFromFile } from './plugin-manifest.js';
import { PluginRegistry } from './plugin-registry.js';
import { PluginManifestError, PluginLoadError, PluginVersionError } from '../types/plugin.js';
import type { PluginManifest, McpServerConfig } from '../types/plugin.js';
import { ClaudeProvider } from '../execution/claude-provider.js';
import { TerminalSubscriber } from '../ui/subscriber.js';
import { TerminalRenderer, type TerminalRendererOptions } from '../ui/terminal-renderer.js';
import { LocalMemoryProvider } from './local-memory-provider.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { UIEventHandler } from '../ui/subscriber.js';

/**
 * An agent-queried, MCP-backed memory provider instance (B1).
 *
 * The harness only SELECTS, WIRES, and EXPOSES the MCP server declared in the
 * manifest. It performs NO retrieval — the agent queries the MCP server directly
 * (FR-3 invariant: adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration).
 */
export interface McpBackedMemoryProvider {
  readonly kind: 'memory_provider';
  readonly name: string;
  /** The MCP server configuration the harness will wire via `claude mcp add`. */
  readonly mcp: McpServerConfig;
  /** Optional guidance skill path declared in the manifest. */
  readonly guidance?: string;
  /** Availability probe — MCP-backed providers default to available until a probe says otherwise. */
  isAvailable(): boolean;
}

/**
 * Creates an MCP-backed memory provider from a `memory_provider` manifest.
 * Used for non-default providers that declare an MCP server instead of a JS entrypoint.
 *
 * @param manifest  A validated `memory_provider` manifest with an `mcp` declaration.
 * @returns An MCP-backed provider instance.
 */
export function createMcpBackedMemoryProvider(manifest: PluginManifest): McpBackedMemoryProvider {
  const mcp = manifest.mcp as McpServerConfig;
  return {
    kind: 'memory_provider' as const,
    name: manifest.name,
    mcp,
    guidance: manifest.guidance,
    isAvailable(): boolean {
      // MCP-backed providers are optimistically available at startup.
      // Availability probing (e.g. health-check) is future work.
      return true;
    },
  };
}

/**
 * Load and instantiate a plugin from its manifest and entrypoint.
 * Task 10: Validates the entrypoint file exists and the loaded module has
 * the required interface methods (e.g., invoke() for llm_provider).
 */
async function loadPluginModule(
  pluginDir: string,
  manifest: { kind: string; name: string; entrypoint?: string }
): Promise<unknown> {
  if (!manifest.entrypoint) {
    throw new PluginLoadError(
      `Plugin ${manifest.name} has no entrypoint. Did you mean to declare an mcp server?`
    );
  }
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
          // B1: non-default memory_provider with mcp declaration → MCP-backed provider
          let plugin: unknown;
          if (manifest.kind === 'memory_provider' && manifest.mcp) {
            plugin = createMcpBackedMemoryProvider(manifest);
          } else {
            // Task 10: Load the actual plugin module
            plugin = await loadPluginModule(pluginPath, manifest);
          }
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
          // B1: non-default memory_provider with mcp declaration → MCP-backed provider
          let plugin: unknown;
          if (manifest.kind === 'memory_provider' && manifest.mcp) {
            plugin = createMcpBackedMemoryProvider(manifest);
          } else {
            // Task 10: Load the actual plugin module
            plugin = await loadPluginModule(pluginPath, manifest);
          }

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
 * Registers built-in plugins (ClaudeProvider, TerminalSubscriber, TerminalRenderer) into the registry.
 * Task 11: ClaudeProvider registers as llm_provider:claude
 * Task 12: TerminalSubscriber registers as ui_renderer:terminal (lifecycle wrapper)
 * Feature 1.2 T11: TerminalRenderer also registers as ui_renderer:terminal_renderer (UIRenderer interface)
 * @returns TerminalSubscriber instance so caller can call start()/stop()
 */
export function registerBuiltins(
  registry: PluginRegistry,
  events: ConductorEventEmitter,
  renderEvent: UIEventHandler,
  rendererOpts?: TerminalRendererOptions
): TerminalSubscriber {
  // Task 11: Register ClaudeProvider
  registry.register('llm_provider', 'claude', new ClaudeProvider());

  // Task 12: Register TerminalSubscriber (lifecycle wrapper — wires event emitter to render callback)
  const subscriber = new TerminalSubscriber(events, renderEvent);
  registry.register('ui_renderer', 'terminal', subscriber);

  // Feature 1.2 T11: Also register TerminalRenderer (UIRenderer interface) if options provided
  if (rendererOpts) {
    const terminalRenderer = new TerminalRenderer(rendererOpts);
    registry.register('ui_renderer', 'terminal_renderer', terminalRenderer);
  }

  // adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration / Task A3: Register built-in local memory provider (C1 — real provider, not null)
  registry.register('memory_provider', 'local', LocalMemoryProvider);

  return subscriber;
}
