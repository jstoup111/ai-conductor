/**
 * B1: A non-default `memory_provider` manifest declaring an MCP server
 * loads as an MCP-backed provider (NOT the local file store).
 *
 * FR-4 (non-default provider is agent-queried).
 * adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadManifestFromFile } from '../../src/engine/plugin-manifest.js';
import { createMcpBackedMemoryProvider } from '../../src/engine/plugin-loader.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';

describe('B1: non-default memory_provider manifest with MCP → MCP-backed provider', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mem-mcp-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads an MCP-backed provider (not the local file store)', () => {
    const pluginDir = join(tmpDir, 'serena');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.yml'),
      `kind: memory_provider
name: serena
mcp:
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/serena"
`
    );

    const manifest = loadManifestFromFile(join(pluginDir, 'plugin.yml'));
    const provider = createMcpBackedMemoryProvider(manifest);

    // It is a memory_provider
    expect(provider.kind).toBe('memory_provider');
    expect(provider.name).toBe('serena');
    // It is NOT the built-in local file store
    expect(provider).not.toBe(LocalMemoryProvider);
    // It carries the MCP server config the harness will wire
    expect(provider.mcp).toMatchObject({ command: 'npx' });
  });

  it('loads an MCP-backed provider with optional guidance field', () => {
    const pluginDir = join(tmpDir, 'serena-guided');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.yml'),
      `kind: memory_provider
name: serena-guided
mcp:
  command: serena-mcp
guidance: skills/serena-memory/SKILL.md
`
    );

    const manifest = loadManifestFromFile(join(pluginDir, 'plugin.yml'));
    const provider = createMcpBackedMemoryProvider(manifest);

    expect(provider.kind).toBe('memory_provider');
    expect(provider.name).toBe('serena-guided');
    expect(provider.guidance).toBe('skills/serena-memory/SKILL.md');
  });

  it('MCP-backed provider has isAvailable() defaulting to true', () => {
    const pluginDir = join(tmpDir, 'avail-test');
    mkdirSync(pluginDir);
    writeFileSync(
      join(pluginDir, 'plugin.yml'),
      `kind: memory_provider
name: avail-test
mcp:
  command: avail-mcp
`
    );

    const manifest = loadManifestFromFile(join(pluginDir, 'plugin.yml'));
    const provider = createMcpBackedMemoryProvider(manifest);

    // MCP-backed providers start as "available" until a probe says otherwise
    expect(typeof provider.isAvailable).toBe('function');
    expect(provider.isAvailable()).toBe(true);
  });
});
