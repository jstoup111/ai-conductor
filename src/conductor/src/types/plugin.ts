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
 * Plugin manifest schema from plugin.yml.
 */
export interface PluginManifest {
  kind: PluginKind;
  name: string;
  entrypoint: string;
  harness_version?: string;
  capabilities?: Record<string, unknown>;
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
