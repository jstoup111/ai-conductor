// Covers: task:1
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMergedConfig, validateConfig } from '../../src/engine/config.js';
import { resolveFeatureApplicabilityConfig } from '../../src/engine/resolved-config.js';

const originalHome = process.env.HOME;

describe('feature_applicability config', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'feature-applicability-config-'));
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('defaults disabled when the project config omits the block', () => {
    const result = validateConfig({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolveFeatureApplicabilityConfig(result.config)).toEqual({ enabled: false });
  });

  it('resolves an enabled project block', () => {
    const result = validateConfig({ feature_applicability: { enabled: true } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolveFeatureApplicabilityConfig(result.config)).toEqual({ enabled: true });
  });

  it('rejects a non-boolean enabled value', () => {
    const result = validateConfig({ feature_applicability: { enabled: 'yes' } });

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/feature_applicability\.enabled.*boolean/) },
    });
  });

  it('rejects unknown keys in the block', () => {
    const result = validateConfig({ feature_applicability: { enabeld: true } });

    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/enabeld/) },
    });
  });

  it('ignores a user-level setting when the project does not opt in', async () => {
    const home = await mkdtemp(join(tmpdir(), 'feature-applicability-user-'));
    try {
      process.env.HOME = home;
      await mkdir(join(home, '.ai-conductor'), { recursive: true });
      await writeFile(
        join(home, '.ai-conductor', 'config.yml'),
        'feature_applicability:\n  enabled: true\n',
      );
      await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), '{}\n');

      const result = await loadMergedConfig(projectRoot);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(resolveFeatureApplicabilityConfig(result.config)).toEqual({ enabled: false });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
