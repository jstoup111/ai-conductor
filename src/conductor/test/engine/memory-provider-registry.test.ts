/**
 * B2: A registered non-default memory provider is discoverable via the registry.
 *
 * FR-1: registry.get('memory_provider', name) returns it;
 *       list('memory_provider') includes both 'local' and the non-default provider.
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';
import { makeTestDoubleProvider } from '../fixtures/test-double-provider.js';

describe('B2: non-default memory_provider registration and discovery', () => {
  it('registry.get() returns the registered double after markInitialized()', () => {
    const registry = new PluginRegistry();
    const double = makeTestDoubleProvider({ name: 'serena' });

    registry.register('memory_provider', 'local', LocalMemoryProvider);
    registry.register('memory_provider', double.name, double);
    registry.markInitialized();

    const found = registry.get('memory_provider', 'serena');
    expect(found).toBe(double);
  });

  it('list("memory_provider") includes both local and the double', () => {
    const registry = new PluginRegistry();
    const double = makeTestDoubleProvider({ name: 'serena' });

    registry.register('memory_provider', 'local', LocalMemoryProvider);
    registry.register('memory_provider', double.name, double);

    const names = registry.list('memory_provider');
    expect(names).toContain('local');
    expect(names).toContain('serena');
  });

  it('tryGet() returns the double without requiring initialization', () => {
    const registry = new PluginRegistry();
    const double = makeTestDoubleProvider({ name: 'my-provider' });

    registry.register('memory_provider', 'local', LocalMemoryProvider);
    registry.register('memory_provider', double.name, double);

    const found = registry.tryGet('memory_provider', 'my-provider');
    expect(found).toBe(double);
  });

  it('tryGet() returns undefined for an unknown provider name', () => {
    const registry = new PluginRegistry();
    registry.register('memory_provider', 'local', LocalMemoryProvider);

    const found = registry.tryGet('memory_provider', 'not-registered');
    expect(found).toBeUndefined();
  });

  it('multiple non-default providers can coexist', () => {
    const registry = new PluginRegistry();
    const serena = makeTestDoubleProvider({ name: 'serena' });
    const custom = makeTestDoubleProvider({ name: 'custom' });

    registry.register('memory_provider', 'local', LocalMemoryProvider);
    registry.register('memory_provider', serena.name, serena);
    registry.register('memory_provider', custom.name, custom);

    const names = registry.list('memory_provider');
    expect(names).toContain('local');
    expect(names).toContain('serena');
    expect(names).toContain('custom');
    expect(names).toHaveLength(3);
  });
});
