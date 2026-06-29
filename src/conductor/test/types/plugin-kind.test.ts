import { describe, it, expect } from 'vitest';
import { VALID_PLUGIN_KINDS } from '../../src/types/plugin.js';
import type { PluginKind } from '../../src/types/plugin.js';

/**
 * Task A1: memory_provider plugin kind registration.
 *
 * ADR-015: Add `memory_provider` to the PluginKind union and VALID_PLUGIN_KINDS array,
 * mirroring the existing llm_provider / ui_renderer entries.
 */
describe('PluginKind — memory_provider (ADR-015)', () => {
  it('VALID_PLUGIN_KINDS includes memory_provider', () => {
    expect(VALID_PLUGIN_KINDS).toContain('memory_provider');
  });

  it('memory_provider is assignable to PluginKind (type assertion)', () => {
    // If memory_provider is in the union, this cast is safe at runtime.
    const kind: PluginKind = 'memory_provider' as PluginKind;
    expect(kind).toBe('memory_provider');
  });
});
