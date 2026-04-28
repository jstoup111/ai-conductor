import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { PluginNotFoundError, PluginRegistryError } from '../../src/types/plugin.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { UISubscriber } from '../../src/ui/types.js';

// Mock implementations for testing
class MockLLMProvider implements LLMProvider {
  async invoke() {
    return { success: true, output: '', exitCode: 0 };
  }

  async invokeInteractive() {
    // no-op
  }
}

class MockUISubscriber implements UISubscriber {
  start() {
    // no-op
  }

  stop() {
    // no-op
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('register and get', () => {
    it('creates an empty registry', () => {
      expect(registry).toBeDefined();
    });

    it('stores a plugin instance via register and retrieves it via get', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);
      registry.markInitialized();

      const retrieved = registry.get('llm_provider', 'claude');
      expect(retrieved).toBe(provider);
    });

    it('get returns typed instance as LLMProvider', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);
      registry.markInitialized();

      const retrieved = registry.get<LLMProvider>('llm_provider', 'claude');
      expect(retrieved).toHaveProperty('invoke');
      expect(retrieved).toHaveProperty('invokeInteractive');
    });

    it('get returns typed instance as UISubscriber', () => {
      const subscriber = new MockUISubscriber();
      registry.register('ui_renderer', 'terminal', subscriber);
      registry.markInitialized();

      const retrieved = registry.get<UISubscriber>('ui_renderer', 'terminal');
      expect(retrieved).toHaveProperty('start');
      expect(retrieved).toHaveProperty('stop');
    });

    it('stores multiple plugins of the same kind with different names', () => {
      const provider1 = new MockLLMProvider();
      const provider2 = new MockLLMProvider();

      registry.register('llm_provider', 'claude', provider1);
      registry.register('llm_provider', 'gpt', provider2);
      registry.markInitialized();

      expect(registry.get('llm_provider', 'claude')).toBe(provider1);
      expect(registry.get('llm_provider', 'gpt')).toBe(provider2);
    });

    it('stores plugins of different kinds independently', () => {
      const provider = new MockLLMProvider();
      const subscriber = new MockUISubscriber();

      registry.register('llm_provider', 'claude', provider);
      registry.register('ui_renderer', 'terminal', subscriber);
      registry.markInitialized();

      expect(registry.get('llm_provider', 'claude')).toBe(provider);
      expect(registry.get('ui_renderer', 'terminal')).toBe(subscriber);
    });
  });

  describe('list', () => {
    it('returns empty array for unregistered kind', () => {
      const names = registry.list('llm_provider');
      expect(names).toEqual([]);
    });

    it('returns array with single plugin name', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);

      const names = registry.list('llm_provider');
      expect(names).toEqual(['claude']);
    });

    it('returns array of all plugin names for a kind in registration order', () => {
      const provider1 = new MockLLMProvider();
      const provider2 = new MockLLMProvider();

      registry.register('llm_provider', 'claude', provider1);
      registry.register('llm_provider', 'gpt', provider2);

      const names = registry.list('llm_provider');
      expect(names).toEqual(['claude', 'gpt']);
    });

    it('list for one kind does not include plugins from another kind', () => {
      const provider = new MockLLMProvider();
      const subscriber = new MockUISubscriber();

      registry.register('llm_provider', 'claude', provider);
      registry.register('ui_renderer', 'terminal', subscriber);

      expect(registry.list('llm_provider')).toEqual(['claude']);
      expect(registry.list('ui_renderer')).toEqual(['terminal']);
      expect(registry.list('step')).toEqual([]);
    });
  });

  describe('markInitialized', () => {
    it('markInitialized marks registry as ready', () => {
      expect(() => registry.markInitialized()).not.toThrow();
    });

    it('markInitialized can be called only once', () => {
      registry.markInitialized();
      expect(() => registry.markInitialized()).toThrow(PluginRegistryError);
    });
  });

  describe('error cases', () => {
    it('get for nonexistent plugin throws PluginNotFoundError with kind and name', () => {
      registry.markInitialized();
      try {
        registry.get('llm_provider', 'nonexistent');
        expect.fail('Should have thrown PluginNotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(PluginNotFoundError);
        const error = err as PluginNotFoundError;
        expect(error.kind).toBe('llm_provider');
        // Access constructor param via Object.getOwnPropertyNames since Error.name overwrites
        expect(String(err)).toContain('nonexistent');
      }
    });

    it('get for wrong kind throws PluginNotFoundError even if plugin exists under different kind', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);
      registry.markInitialized();

      expect(() => registry.get('ui_renderer', 'claude')).toThrow(PluginNotFoundError);
    });

    it('get before markInitialized throws PluginRegistryError', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);

      expect(() => registry.get('llm_provider', 'claude')).toThrow(PluginRegistryError);
    });

    it('get after markInitialized succeeds', () => {
      const provider = new MockLLMProvider();
      registry.register('llm_provider', 'claude', provider);
      registry.markInitialized();

      const retrieved = registry.get('llm_provider', 'claude');
      expect(retrieved).toBe(provider);
    });
  });
});
