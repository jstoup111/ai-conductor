import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/engine/config.js';
import { resolveLayer2Applicability } from '../src/engine/wiring-probe.js';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('wiring.entry_points config parsing', () => {
  it('parses a wiring.entry_points list of repo-relative paths', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-config-'));
    try {
      await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
      const configYaml = `wiring:\n  entry_points:\n    - src/conductor/src/index.ts\n    - bin/conduct\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.wiring?.entry_points).toEqual([
        'src/conductor/src/index.ts',
        'bin/conduct',
      ]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('resolveLayer2Applicability', () => {
  async function makeTsProject(): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-ts-project-'));
    await writeFile(join(tmpDir, 'tsconfig.json'), '{}');
    await writeFile(join(tmpDir, 'package.json'), '{}');
    return tmpDir;
  }

  it('is not applicable for a project with no tsconfig.json/package.json', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'wiring-non-ts-'));
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('not-applicable');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('is skipped for a TS project missing wiring.entry_points config', async () => {
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('skipped');
      if (result.reason !== 'skipped') return;
      expect(result.message).toBe('Layer 2 skipped: wiring.entry_points not configured');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not affect Layer 1 pass/fail when Layer 2 is skipped', async () => {
    // Layer 2 skip is purely a degradation classification; it carries no
    // gate verdict of its own, so a skipped result must never assert
    // pass/fail — Layer 1's verdict is computed independently elsewhere.
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability({}, tmpDir);
      expect(result.applicable).toBe(false);
      expect('satisfied' in result).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('is applicable with resolved roots when entry_points are configured and exist', async () => {
    const tmpDir = await makeTsProject();
    try {
      await mkdir(join(tmpDir, 'src'), { recursive: true });
      await writeFile(join(tmpDir, 'src', 'index.ts'), 'export {};');
      const result = await resolveLayer2Applicability(
        { wiring: { entry_points: ['src/index.ts'] } },
        tmpDir,
      );
      expect(result.applicable).toBe(true);
      if (!result.applicable) return;
      expect(result.roots).toEqual(['src/index.ts']);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports satisfied:false naming the bad root when a configured entry point does not exist on disk', async () => {
    const tmpDir = await makeTsProject();
    try {
      const result = await resolveLayer2Applicability(
        { wiring: { entry_points: ['src/bad/path.ts'] } },
        tmpDir,
      );
      expect(result.applicable).toBe(false);
      if (result.applicable) return;
      expect(result.reason).toBe('bad-root');
      if (result.reason !== 'bad-root') return;
      expect(result.satisfied).toBe(false);
      expect(result.message).toBe(
        'wiring.entry_points root "src/bad/path.ts" does not exist',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
