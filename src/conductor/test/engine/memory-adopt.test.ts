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
import { memoryStatus, memoryAdd, memoryRemove } from '../../src/engine/memory-adopt.js';

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

// ═════════════════════════════════════════════════════════════════════════════
// B8: memoryAdd idempotent — second add is a pure no-op
// ═════════════════════════════════════════════════════════════════════════════
describe('B8: memoryAdd idempotent', () => {
  it('second add leaves config byte-for-byte unchanged and wires MCP only once', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });

    await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });
    const rawAfterFirst = await readRaw(projectRoot);

    await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });
    const rawAfterSecond = await readRaw(projectRoot);

    expect(mcp.addCount('memory-double')).toBe(1);         // MCP wired once only
    expect(rawAfterSecond).toBe(rawAfterFirst);             // config byte-for-byte unchanged
  });

  it('second add returns ok:true and changed:false', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });
    await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });
    const second = await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B9: memoryAdd missing credentials → notice, atomic (no half-config, no secret)
// ═════════════════════════════════════════════════════════════════════════════
describe('B9: memoryAdd missing credentials → notice + atomic', () => {
  it('add without required credentials leaves config unchanged and wires no MCP', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'secure',
      requiredEnv: ['MEM_TEST_TOKEN'],
      mcp: { name: 'memory-secure', command: 'sec-server', args: [] },
    });
    delete process.env.MEM_TEST_TOKEN;

    const before = await readRaw(projectRoot);
    const result = await memoryAdd({
      projectRoot,
      provider: 'secure',
      registry: reg,
      mcp: mcp.runner,
      env: {},   // explicitly no credentials
    });

    expect(result.ok).toBe(false);
    expect(String(result.notice ?? '')).toMatch(/credential/i);
    // Atomic: config is byte-for-byte unchanged
    const after = await readRaw(projectRoot);
    expect(after).toBe(before);
    const cfg = await readParsed(projectRoot);
    expect(cfg.memory_provider ?? undefined).toBeUndefined();
    // No MCP call attempted
    expect(mcp.addCount('memory-secure')).toBe(0);
  });

  it('successful add with credentials never writes the secret value to config', async () => {
    await seedConfig(projectRoot);
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'secure',
      requiredEnv: ['MEM_TEST_TOKEN'],
      mcp: { name: 'memory-secure', command: 'sec-server', args: [] },
    });
    const SECRET = 'tok-super-secret-9a3f';

    const result = await memoryAdd({
      projectRoot,
      provider: 'secure',
      registry: reg,
      mcp: mcp.runner,
      env: { MEM_TEST_TOKEN: SECRET },
    });

    expect(result.ok).toBe(true);
    const raw = await readRaw(projectRoot);
    expect(raw).not.toContain(SECRET);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B10: interrupted add re-runs cleanly
// ═════════════════════════════════════════════════════════════════════════════
describe('B10: interrupted add re-runs cleanly', () => {
  it('config already names the provider but MCP unwired → re-run wires MCP once', async () => {
    // Simulate interruption: config written, MCP NOT yet registered.
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    const mcp = makeMcpStub();
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });
    expect(mcp.registered.has('memory-double')).toBe(false);

    const result = await memoryAdd({ projectRoot, provider: 'double', registry: reg, mcp: mcp.runner });

    expect(result.ok).toBe(true);
    // MCP wired exactly once; config still names the provider (unchanged).
    expect(mcp.addCount('memory-double')).toBe(1);
    expect(mcp.registered.has('memory-double')).toBe(true);
    const cfg = await readParsed(projectRoot);
    expect(cfg.memory_provider).toBe('double');
    expect(cfg.llm_provider).toBe('claude');  // unrelated key untouched
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B11: memoryRemove — clears memory_provider; other config untouched
// ═════════════════════════════════════════════════════════════════════════════
describe('B11: memoryRemove clears provider', () => {
  it('removes memory_provider from config; unrelated keys untouched', async () => {
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    const mcp = makeMcpStub();
    mcp.registered.add('memory-double'); // pre-wire so the stub state is consistent
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });

    const result = await memoryRemove({ projectRoot, registry: reg, mcp: mcp.runner });

    expect(result.ok).toBe(true);
    const cfg = await readParsed(projectRoot);
    expect(cfg.memory_provider ?? undefined).toBeUndefined();
    expect(cfg.llm_provider).toBe('claude');   // other key intact
  });

  it('returns ok:true and memoryStatus returns local/default afterwards', async () => {
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    const mcp = makeMcpStub();
    mcp.registered.add('memory-double');
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });

    await memoryRemove({ projectRoot, registry: reg, mcp: mcp.runner });

    const status = await memoryStatus({ projectRoot, registry: reg });
    expect(status.provider).toBe('local');
    expect(status.source).toBe('default');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B12: memoryRemove idempotent — re-remove is a clean no-op
// ═════════════════════════════════════════════════════════════════════════════
describe('B12: memoryRemove idempotent', () => {
  it('remove when already local is a no-op: ok:true, config byte-for-byte unchanged', async () => {
    await seedConfig(projectRoot);  // no memory_provider → already local
    const mcp = makeMcpStub();
    const reg = makeRegistry();

    const before = await readRaw(projectRoot);
    const result = await memoryRemove({ projectRoot, registry: reg, mcp: mcp.runner });
    expect(result.ok).toBe(true);
    const after = await readRaw(projectRoot);
    expect(after).toBe(before);
  });

  it('second remove after first is also a no-op', async () => {
    await seedConfig(projectRoot, 'memory_provider: double\nllm_provider: claude\n');
    const mcp = makeMcpStub();
    mcp.registered.add('memory-double');
    const reg = makeRegistry({
      name: 'double',
      mcp: { name: 'memory-double', command: 'mem-server', args: [] },
    });

    await memoryRemove({ projectRoot, registry: reg, mcp: mcp.runner });
    const rawAfterFirst = await readRaw(projectRoot);

    const result2 = await memoryRemove({ projectRoot, registry: reg, mcp: mcp.runner });
    expect(result2.ok).toBe(true);
    const rawAfterSecond = await readRaw(projectRoot);
    expect(rawAfterSecond).toBe(rawAfterFirst);
  });
});
