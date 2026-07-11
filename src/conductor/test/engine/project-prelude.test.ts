import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  defaultHasMigration,
  readBootstrapMarker,
  writeBootstrapMarker,
  readAssessMarker,
  writeAssessMarker,
  detectCodebase,
  hasTechnicalAssessment,
  runProjectPrelude,
  invokeSkill,
  daysSince,
} from '../../src/engine/project-prelude.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';

function createMockProvider(): LLMProvider {
  return {
    invoke: vi.fn().mockResolvedValue({ success: true, output: '', exitCode: 0 }),
    invokeInteractive: vi.fn(),
  } as unknown as LLMProvider;
}

describe('defaultHasMigration', () => {
  it('returns true on minor bump', () => {
    expect(defaultHasMigration('1.0.0', '1.1.0')).toBe(true);
  });
  it('returns true on major bump', () => {
    expect(defaultHasMigration('1.9.3', '2.0.0')).toBe(true);
  });
  it('returns false on patch bump', () => {
    expect(defaultHasMigration('1.0.0', '1.0.5')).toBe(false);
  });
  it('returns false on same version', () => {
    expect(defaultHasMigration('1.2.3', '1.2.3')).toBe(false);
  });
  it('tolerates a leading v', () => {
    expect(defaultHasMigration('v1.0.0', 'v1.1.0')).toBe(true);
  });
});

describe('bootstrap marker round-trip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-bootstrap-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when marker missing', async () => {
    expect(await readBootstrapMarker(dir)).toBeNull();
  });

  it('writes and reads marker', async () => {
    await writeBootstrapMarker(dir, '1.2.3');
    const marker = await readBootstrapMarker(dir);
    expect(marker?.harness_version).toBe('1.2.3');
    expect(marker?.bootstrapped_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('assess marker round-trip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-assess-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads marker with commit sha', async () => {
    await writeAssessMarker(dir, 'abc123');
    const marker = await readAssessMarker(dir);
    expect(marker?.last_commit_sha).toBe('abc123');
    expect(marker?.assessed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('omits sha when null', async () => {
    await writeAssessMarker(dir, null);
    const marker = await readAssessMarker(dir);
    expect(marker?.last_commit_sha).toBeUndefined();
    expect(marker?.assessed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('detectCodebase', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-codebase-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns false for an empty project', async () => {
    expect(await detectCodebase(dir)).toBe(false);
  });

  it('returns true when a ruby file exists', async () => {
    await writeFile(join(dir, 'app.rb'), 'puts 1\n');
    expect(await detectCodebase(dir)).toBe(true);
  });

  it('returns true when a typescript file exists in a subdirectory', async () => {
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'index.ts'), 'export {}\n');
    expect(await detectCodebase(dir)).toBe(true);
  });

  it('ignores harness-owned directories (.ai-conductor, .docs)', async () => {
    await mkdir(join(dir, '.ai-conductor'), { recursive: true });
    await writeFile(join(dir, '.ai-conductor', 'config.yml'), 'harness_version: ">=1.0.0"\n');
    await mkdir(join(dir, '.docs'), { recursive: true });
    await writeFile(join(dir, '.docs', 'whatever.py'), 'print(1)\n');
    expect(await detectCodebase(dir)).toBe(false);
  });
});

describe('hasTechnicalAssessment', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-assess-doc-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns false when .docs/decisions missing', async () => {
    expect(await hasTechnicalAssessment(dir)).toBe(false);
  });

  it('returns true when a technical-assessment-*.md is present', async () => {
    await mkdir(join(dir, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(dir, '.docs', 'decisions', 'technical-assessment-2026-04-18.md'), '# ok\n');
    expect(await hasTechnicalAssessment(dir)).toBe(true);
  });

  it('returns false when decisions directory has other docs only', async () => {
    await mkdir(join(dir, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(dir, '.docs', 'decisions', 'adr-001-use-postgres.md'), '# adr\n');
    expect(await hasTechnicalAssessment(dir)).toBe(false);
  });
});

describe('daysSince', () => {
  it('returns 0 for right-now timestamps', () => {
    expect(daysSince(new Date().toISOString())).toBe(0);
  });
  it('returns null for invalid input', () => {
    expect(daysSince('not a date')).toBeNull();
  });
  it('returns a large positive number for an old timestamp', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(tenDaysAgo)).toBe(10);
  });
});

describe('invokeSkill return type', () => {
  it('propagates rateLimited: true from provider', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: '',
        exitCode: 0,
        rateLimited: true,
      }),
      invokeInteractive: vi.fn(),
    } as unknown as LLMProvider;

    const result = await invokeSkill(provider, 'session-1', '/test', 'Test prompt');
    expect(result.success).toBe(true);
    expect(result.rateLimited).toBe(true);
  });

  it('propagates success without rateLimited flag when not rate-limited', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        output: '',
        exitCode: 0,
        rateLimited: false,
      }),
      invokeInteractive: vi.fn(),
    } as unknown as LLMProvider;

    const result = await invokeSkill(provider, 'session-1', '/test', 'Test prompt');
    expect(result.success).toBe(true);
    expect(result.rateLimited).toBe(false);
  });

  it('propagates genuine failures (success: false, not rate-limited)', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: false,
        output: 'Error message',
        exitCode: 1,
        rateLimited: false,
      }),
      invokeInteractive: vi.fn(),
    } as unknown as LLMProvider;

    const result = await invokeSkill(provider, 'session-1', '/test', 'Test prompt');
    expect(result.success).toBe(false);
    expect(result.rateLimited).toBe(false);
  });

  it('distinguishes rate-limit from other failures', async () => {
    const provider: LLMProvider = {
      invoke: vi.fn().mockResolvedValue({
        success: false,
        output: '',
        exitCode: 429,
        rateLimited: true,
      }),
      invokeInteractive: vi.fn(),
    } as unknown as LLMProvider;

    const result = await invokeSkill(provider, 'session-1', '/test', 'Test prompt');
    expect(result.success).toBe(false);
    expect(result.rateLimited).toBe(true);
  });
});

describe('runProjectPrelude (happy paths)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prelude-run-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs bootstrap on a fresh project (never_run)', async () => {
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
    });
    expect(result.bootstrapExecuted).toBe(true);
    expect(result.bootstrapReason).toBe('never_run');
    // Marker written on success
    const marker = await readBootstrapMarker(dir);
    expect(marker?.harness_version).toBe('1.0.0');
  });

  it('skips bootstrap when marker present and no migration', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
    });
    expect(result.bootstrapExecuted).toBe(false);
  });

  it('runs bootstrap when harness version bumps past a minor boundary', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.1.0',
    });
    expect(result.bootstrapExecuted).toBe(true);
    expect(result.bootstrapReason).toBe('migration');
  });

  it('skips assess on a project without a codebase', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
    });
    expect(result.assessExecuted).toBe(false);
    expect(result.assessSkipped).toBe('no_codebase');
  });

  it('runs assess when codebase exists and no assessment marker', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    await writeFile(join(dir, 'app.rb'), 'puts 1\n');
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
    });
    expect(result.assessExecuted).toBe(true);
    expect(result.assessReason).toBe('never_run');
  });

  it('skips assess silently when recent marker exists (auto mode: no prompt)', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    await writeFile(join(dir, 'app.rb'), 'puts 1\n');
    await writeAssessMarker(dir, null);
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
    });
    expect(result.assessExecuted).toBe(false);
    expect(result.assessSkipped).toBe('recent');
  });

  it('forceAssess bypasses staleness checks', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    await writeFile(join(dir, 'app.rb'), 'puts 1\n');
    await writeAssessMarker(dir, null);
    const provider = createMockProvider();
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.0',
      forceAssess: true,
    });
    expect(result.assessExecuted).toBe(true);
    expect(result.assessReason).toBe('forced');
  });

  it('custom hasMigration predicate overrides the default', async () => {
    await writeBootstrapMarker(dir, '1.0.0');
    const provider = createMockProvider();
    // Force migration even on a patch bump
    const result = await runProjectPrelude(dir, provider, 'session-1', {}, {
      harnessVersion: '1.0.1',
      hasMigration: () => true,
    });
    expect(result.bootstrapExecuted).toBe(true);
    expect(result.bootstrapReason).toBe('migration');
  });
});
