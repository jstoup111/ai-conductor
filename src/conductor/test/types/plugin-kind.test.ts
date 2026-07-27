import { describe, it, expect } from 'vitest';
import { VALID_PLUGIN_KINDS } from '../../src/types/plugin.js';

/**
 * Task A1: memory_provider plugin kind registration.
 *
 * adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration: Add `memory_provider` to the PluginKind union and VALID_PLUGIN_KINDS array,
 * mirroring the existing llm_provider / ui_renderer entries.
 */
describe('PluginKind — memory_provider (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration)', () => {
  it('VALID_PLUGIN_KINDS includes memory_provider', () => {
    expect(VALID_PLUGIN_KINDS).toContain('memory_provider');
  });
});
