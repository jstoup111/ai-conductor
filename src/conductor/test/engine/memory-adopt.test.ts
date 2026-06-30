/**
 * Per-task unit tests for src/engine/memory-adopt.ts (B6–B13).
 *
 * Each describe block maps 1:1 to a pipeline task. Tests are ordered so that
 * the narrowest (status-only) tests come first and broader scenarios build
 * on the established primitives. The acceptance spec
 * test/acceptance/memory-provider-adoption.test.ts covers the full round-trip;
 * these unit tests pin the individual function contracts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { load as loadYaml } from 'js-yaml';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { memoryStatus, memoryAdd } from '../../src/engine/memory-adopt.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRegistry(...providers: Array<{ name: string; requiredEnv?: string[]; mcp?: { name: string; command: string; args?: string[] } }>): PluginRegistry {
  const reg = new PluginRegistry();
  reg.register('memory_provider' as any, 'local', { name: 'local', kind: 'memory_provider' });
  for (const p of providers) {
    reg.register('memory_provider' as any, p.name, { kind: 'memory_provider', ...p });
  }
  return reg;
}

function makeMcpStub() {
  const registered = new Set<string>();
  const calls: string[][] = [];
  const runner = async (args: string[]): Promise<{ stdout: string; code: number }> => {
    calls.push(args);
    const [verb, name] = args;
    if (verb === 'get') {
      return registered.has(name) ? { stdout: `${name}: cmd`, code: 0 } : { stdout: '', code: 1 };
    }
    if (verb === 'add') { registered.add(name); return { stdout: 'added', code: 0 }; }
    if (verb === 'remove') { registered.delete(name); return { stdout: 'removed', code: 0 }; }
    return { stdout: '', code: 0 };
  };
  return {
    runner,
    calls,
    registered,
    addCount: (name: string) => calls.filter(c => c[0] === 'add' && c[1] === name).length,
  };
}

const CONFIG_DIR = '.ai-conductor';
const CONFIG_FILE = 'config.yml';
const SEEDED = 'llm_provider: claude\ndefaults:\n  model: opus\n';

async function seedConfig(root: string, body = SEEDED): Promise<void> {
  await mkdir(join(root, CONFIG_DIR), { recursive: true });
  await writeFile(join(root, CONFIG_DIR, CONFIG_FILE), body, 'utf8');
}

async function readRaw(root: string): Promise<string> {
  return readFile(join(root, CONFIG_DIR, CONFIG_FILE), 'utf8');
}

async function readParsed(root: string): Promise<Record<string, unknown>> {
  return (loadYaml(await readRaw(root)) as Record<string, unknown>) ?? {};
}

let workDir: string;
let projectRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mem-adopt-unit-'));
  projectRoot = join(workDir, 'project');
  await mkdir(projectRoot, { recursive: true });
  // Guard against real credential leakage in tests.
  savedEnv.HOME = process.env.HOME;
  process.env.HOME = workDir;
});

afterEach(async () => {
  process.env.HOME = savedEnv.HOME;
  delete process.env.MEM_TEST_TOKEN;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// B6: memoryStatus — reports active provider + source
// ═════════════════════════════════════════════════════════════════════════════
describe('B6: memoryStatus', () => {
  it('returns local/default when no config file exists', async () => {
    const reg = makeRegistry();
    const result = await memoryStatus({ projectRoot, registry: reg });
    expect(result.provider).toBe('local');
    expect(result.source).toBe('default');
  });

  it('returns local/default when config has no memory_provider key', async () => {
    await seedConfig(projectRoot);
    const reg = makeRegistry();
    const result = await memoryStatus({ projectRoot, registry: reg });
    expect(result.provider).toBe('local');
    expect(result.source).toBe('default');
  });

  it('returns config/config when memory_provider is set in config', async () => {
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    const reg = makeRegistry({ name: 'double' });
    const result = await memoryStatus({ projectRoot, registry: reg });
    expect(result.provider).toBe('double');
    expect(result.source).toBe('config');
  });

  it('preserves the provider name exactly as stored in config', async () => {
    await seedConfig(projectRoot, 'memory_provider: my-custom-provider\n');
    const reg = makeRegistry();
    const result = await memoryStatus({ projectRoot, registry: reg });
    expect(result.provider).toBe('my-custom-provider');
    expect(result.source).toBe('config');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B7: memoryAdd happy path — writes config + wires MCP; unrelated keys intact
// ═════════════════════════════════════════════════════════════════════════════
describe('B7: memoryAdd happy path', () => {
  it('writes memory_provider to config and wires MCP once', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: ['--p', 'double'] },
    });

    const result = await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });

    expect(result.ok).toBe(true);
    const cfg = await readParsed(projectRoot);
    expect(cfg.memory_provider).toBe('double');
    expect(cfg.llm_provider).toBe('claude');          // unrelated key preserved
    expect((cfg.defaults as Record<string, unknown>).model).toBe('opus');
    expect(mcp.addCount('memory-double')).toBe(1);
    expect(mcp.registered.has('memory-double')).toBe(true);
  });

  it('returns ok:true and changed:true on first add', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });
    const result = await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('returns ok:false with notice when provider is not in registry', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry();
    const result = await memoryAdd({ projectRoot, provider: 'unknown', registry: reg, mcp: mcp.runner });
    expect(result.ok).toBe(false);
    expect(result.notice).toBeTruthy();
  });
});
