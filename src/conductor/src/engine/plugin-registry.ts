import { PluginKind, PluginNotFoundError, PluginRegistryError } from '../types/plugin.js';

/**
 * Typed plugin registry for managing plugin instances by kind and name.
 * Plugins must be registered before the registry is marked as initialized.
 * After initialization, the registry is read-only.
 */
export class PluginRegistry {
  private plugins: Map<PluginKind, Map<string, unknown>> = new Map();
  private initialized = false;

  /**
   * Registers a plugin instance with a specific kind and name.
   * Can be called multiple times with the same kind+name to override (overwrite).
   *
   * @param kind The plugin kind (e.g., 'llm_provider', 'ui_renderer')
   * @param name The plugin name (e.g., 'claude', 'terminal')
   * @param instance The plugin instance
   */
  register<K extends PluginKind>(kind: K, name: string, instance: unknown): void {
    if (!this.plugins.has(kind)) {
      this.plugins.set(kind, new Map());
    }
    const kindMap = this.plugins.get(kind)!;
    kindMap.set(name, instance);
  }

  /**
   * Retrieves a registered plugin by kind and name.
   *
   * @param kind The plugin kind
   * @param name The plugin name
   * @returns The registered plugin instance, typed as T
   * @throws PluginRegistryError if registry has not been initialized
   * @throws PluginNotFoundError if the plugin is not registered
   */
  get<T = unknown>(kind: PluginKind, name: string): T {
    if (!this.initialized) {
      throw new PluginRegistryError('Cannot get plugin before registry is initialized via markInitialized()');
    }

    const kindMap = this.plugins.get(kind);
    if (!kindMap || !kindMap.has(name)) {
      const available = this.list(kind);
      throw new PluginNotFoundError(
        `Plugin not found: ${kind}:${name}. Available: ${available.join(', ') || '(none)'}`,
        kind,
        name
      );
    }

    return kindMap.get(name) as T;
  }

  /**
   * Retrieves a registered plugin by kind and name WITHOUT requiring the registry
   * to be initialized. Returns `undefined` when the plugin is not found.
   *
   * This is the lookup used by total resolver functions (e.g. `resolveMemoryProvider`)
   * that must return a safe default even when the registry is still being built.
   * For normal consumption after initialization, use `get()` instead.
   *
   * @param kind The plugin kind
   * @param name The plugin name
   * @returns The registered plugin instance, or `undefined` if not found
   */
  tryGet<T = unknown>(kind: PluginKind, name: string): T | undefined {
    const kindMap = this.plugins.get(kind);
    if (!kindMap || !kindMap.has(name)) return undefined;
    return kindMap.get(name) as T;
  }

  /**
   * Lists all registered plugin names for a given kind.
   *
   * @param kind The plugin kind
   * @returns Array of registered plugin names for the kind, in registration order
   */
  list(kind: PluginKind): string[] {
    const kindMap = this.plugins.get(kind);
    if (!kindMap) {
      return [];
    }
    return Array.from(kindMap.keys());
  }

  /**
   * Marks the registry as initialized and read-only.
   * After this is called, new plugins cannot be registered.
   *
   * @throws PluginRegistryError if already initialized
   */
  markInitialized(): void {
    if (this.initialized) {
      throw new PluginRegistryError('Registry is already initialized');
    }
    this.initialized = true;
  }
}
