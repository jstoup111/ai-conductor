import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { HarnessConfig } from '../../src/types/config.js';
import { runWithHooks, type HookRunner } from '../../src/engine/hooks.js';

describe('runWithHooks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'hooks-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function createScript(name: string, executable: boolean = true): Promise<string> {
    const path = join(tmpDir, name);
    await writeFile(path, '#!/bin/bash\necho "ok"', { mode: executable ? 0o755 : 0o644 });
    return path;
  }

  it('executes before-hook, then skill, then after-hook', async () => {
    const beforePath = await createScript('before.sh');
    const afterPath = await createScript('after.sh');
    const executionOrder: string[] = [];

    const hookRunner: HookRunner = {
      runHook: vi.fn().mockImplementation(async (scriptPath: string) => {
        executionOrder.push(`hook:${scriptPath}`);
        return { success: true, output: 'ok' };
      }),
    };

    const skillRunner = vi.fn().mockImplementation(async () => {
      executionOrder.push('skill');
      return { success: true, output: 'skill done' };
    });

    const config: HarnessConfig = {
      steps: {
        build: { hooks: { before: beforePath, after: afterPath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(true);
    expect(result.output).toBe('skill done');
    expect(executionOrder).toEqual([`hook:${beforePath}`, 'skill', `hook:${afterPath}`]);
  });

  it('runs skill without hooks when none configured', async () => {
    const hookRunner: HookRunner = { runHook: vi.fn() };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill done' });
    const config: HarnessConfig = {};

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(true);
    expect(result.output).toBe('skill done');
    expect(hookRunner.runHook).not.toHaveBeenCalled();
    expect(skillRunner).toHaveBeenCalledOnce();
  });

  it('runs skill when step has no hooks entry', async () => {
    const otherPath = await createScript('other.sh');
    const hookRunner: HookRunner = { runHook: vi.fn() };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill done' });
    const config: HarnessConfig = {
      steps: {
        other: { hooks: { before: otherPath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(true);
    expect(hookRunner.runHook).not.toHaveBeenCalled();
  });

  it('skips skill when before-hook fails', async () => {
    const beforePath = await createScript('before.sh');
    const hookRunner: HookRunner = {
      runHook: vi.fn().mockResolvedValue({ success: false, output: 'before failed' }),
    };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill done' });
    const config: HarnessConfig = {
      steps: {
        build: { hooks: { before: beforePath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(false);
    expect(result.hookFailed).toBe('before');
    expect(result.output).toContain('before failed');
    expect(skillRunner).not.toHaveBeenCalled();
  });

  it('returns failure when after-hook fails', async () => {
    const afterPath = await createScript('after.sh');
    const hookRunner: HookRunner = {
      runHook: vi.fn().mockResolvedValue({ success: false, output: 'after failed' }),
    };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill ok' });
    const config: HarnessConfig = {
      steps: {
        build: { hooks: { after: afterPath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(false);
    expect(result.hookFailed).toBe('after');
    expect(result.output).toContain('after failed');
  });

  it('reports missing hook script', async () => {
    const missingPath = join(tmpDir, 'nonexistent.sh');
    const hookRunner: HookRunner = { runHook: vi.fn() };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill done' });
    const config: HarnessConfig = {
      steps: {
        build: { hooks: { before: missingPath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(false);
    expect(result.hookFailed).toBe('before');
    expect(result.output).toContain('not found');
    expect(skillRunner).not.toHaveBeenCalled();
    expect(hookRunner.runHook).not.toHaveBeenCalled();
  });

  it('falls back to bash for non-executable scripts', async () => {
    const scriptPath = await createScript('hook.sh', false);

    const hookRunner: HookRunner = {
      runHook: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
    };
    const skillRunner = vi.fn().mockResolvedValue({ success: true, output: 'skill done' });

    const config: HarnessConfig = {
      steps: {
        build: { hooks: { before: scriptPath } },
      },
    };

    const result = await runWithHooks('build', config, tmpDir, skillRunner, hookRunner);

    expect(result.success).toBe(true);
    const call = (hookRunner.runHook as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toContain('bash');
    expect(call).toContain(scriptPath);
  });
});
