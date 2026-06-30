/**
 * Plugin system types and error classes for the conductor harness.
 */

/**
 * Valid plugin kinds in the conductor plugin system.
 */
export type PluginKind = 'llm_provider' | 'ui_renderer' | 'step' | 'hook' | 'visualizer' | 'memory_provider';

/**
 * Valid plugin kinds as a list for validation and error messages.
 */
export const VALID_PLUGIN_KINDS: readonly PluginKind[] = [
  'llm_provider',
  'ui_renderer',
  'step',
  'hook',
  'visualizer',
  'memory_provider',
];

/**
 * MCP server configuration declared in a `memory_provider` manifest.
 * The harness selects, wires, and exposes this server — it performs NO retrieval.
 * (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration)
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Plugin manifest schema from plugin.yml.
 *
 * For `memory_provider` kind with an `mcp` declaration, `entrypoint` is
 * optional — the MCP server config replaces the JS module load path.
 * For all other plugin kinds, `entrypoint` is required (validated at runtime).
 */
export interface PluginManifest {
  kind: PluginKind;
  name: string;
  /**
   * Path to the JS entrypoint module. Required for all plugin kinds EXCEPT
   * `memory_provider` manifests that declare an `mcp` server instead.
   */
  entrypoint?: string;
  harness_version?: string;
  capabilities?: Record<string, unknown>;
  /**
   * Optional skill reference for LLM-facing guidance (memory_provider manifests; adr-2026-06-29-per-provider-retrieval-guidance-location).
   * When present, the harness surfaces this path so the agent can query it for context
   * on how to interact with the provider. The harness does NOT parse or index the file.
   */
  guidance?: string;
  /**
   * MCP server configuration for non-default `memory_provider` plugins.
   * When present, the plugin is loaded as an agent-queried MCP-backed provider
   * rather than a JS module. Mutually exclusive with `entrypoint` for memory providers.
   */
  mcp?: McpServerConfig;
}

/**
 * A visualizer plugin subscribes to the ConductorEventEmitter as a listener
 * (via .on(...)) and exports observations to an external system (e.g. OTel).
 * It renders nothing to the terminal. Multiple visualizers may be active at once.
 *
 * Lifecycle mirrors EventPersister: start() registers listeners, stop() unregisters
 * and flushes pending data.
 */
export interface VisualizerPlugin {
  /** Unique plugin name, used as the registry key. */
  readonly name: string;
  /**
   * Attach to the event emitter. Called once at run start.
   * Implementations must only call emitter.on() — never modify emission sites.
   */
  start(emitter: import('../ui/events.js').ConductorEventEmitter): void;
  /** Detach from the emitter and flush pending export data. Returns when flush completes. */
  stop(): Promise<void>;
}

/**
 * Error thrown when plugin manifest validation fails.
 */
export class PluginManifestError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

/**
 * Error thrown when plugin harness version requirement doesn't match.
 */
export class PluginVersionError extends Error {
  constructor(message: string, public readonly harnessVersion: string, public readonly requiredRange: string) {
    super(message);
    this.name = 'PluginVersionError';
  }
}

/**
 * Error thrown when plugin file or entrypoint cannot be loaded.
 */
export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

/**
 * Error thrown when requested plugin is not found in registry.
 */
export class PluginNotFoundError extends Error {
  constructor(message: string, public readonly kind: PluginKind, public readonly name: string) {
    super(message);
    this.name = 'PluginNotFoundError';
  }
}

/**
 * Error thrown for registry state violations.
 */
export class PluginRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginRegistryError';
  }
}
