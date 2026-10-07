import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  RETIRED_PLUGIN_KINDS,
  VALID_PLUGIN_KINDS,
  type PluginKind,
} from '../../src/types/plugin.js';

const RETRIEVAL_SITES: Record<PluginKind, string> = {
  llm_provider: '../../src/engine/provider-runtime.ts',
  ui_renderer: '../../src/index.ts',
  visualizer: '../../src/index.ts',
  memory_provider: '../../src/engine/config.ts',
};

function findUnsitedKinds(kinds: readonly string[]): string[] {
  return kinds.filter((kind) => !Object.hasOwn(RETRIEVAL_SITES, kind));
}

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

describe('PluginKind retrieval-site guard', () => {
  it('maps every valid kind to an extant registry retrieval site', () => {
    expect(findUnsitedKinds(VALID_PLUGIN_KINDS)).toEqual([]);

    for (const kind of VALID_PLUGIN_KINDS) {
      const sourcePath = fileURLToPath(new URL(RETRIEVAL_SITES[kind], import.meta.url));
      expect(existsSync(sourcePath)).toBe(true);

      const source = readFileSync(sourcePath, 'utf8');
      expect(source).toMatch(
        new RegExp(`registry\\.(?:get|tryGet)(?:<[^>]+>)?\\(\\s*['\"]${kind}['\"]`),
      );
    }
  });

  it('keeps retired kinds out of the valid list and retrieval-site map', () => {
    for (const kind of RETIRED_PLUGIN_KINDS) {
      expect(VALID_PLUGIN_KINDS).not.toContain(kind);
      expect(Object.hasOwn(RETRIEVAL_SITES, kind)).toBe(false);
    }
  });

  it('reports an injected retired kind as unsited', () => {
    expect(findUnsitedKinds([...VALID_PLUGIN_KINDS, 'step'])).toEqual(['step']);
  });
});
