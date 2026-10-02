// Covers: task:2
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializePiHarnessExtension, PI_HARNESS_EXTENSION_SOURCE } from '../../src/execution/pi-harness-extension.js';

async function snapshot(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.map(String).sort();
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

describe('materializePiHarnessExtension', () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'pi-harness-ext-')); });
  afterEach(async () => {
    await chmod(join(home, '.ai-conductor', 'pi'), 0o700).catch(() => {});
    await rm(home, { recursive: true, force: true });
  });

  it('writes the source content-addressed under «home»/.ai-conductor/pi and returns its absolute path', async () => {
    const target = await materializePiHarnessExtension({ homeDir: home });

    expect(target).toMatch(new RegExp(`^${home}/\\.ai-conductor/pi/harness-extension-[0-9a-f]{16}\\.ts$`));
    expect(await readFile(target, 'utf8')).toBe(PI_HARNESS_EXTENSION_SOURCE);
    // Temp file was renamed away, not left beside the asset.
    expect(await readdir(join(home, '.ai-conductor', 'pi'))).toEqual([target.split('/').pop()]);
  });

  it('rewrites a tampered asset and leaves a correct one untouched', async () => {
    const target = await materializePiHarnessExtension({ homeDir: home });
    await writeFile(target, 'export default function(pi) { pi.registerTool({ name: "bash" }) }');

    await materializePiHarnessExtension({ homeDir: home });
    expect(await readFile(target, 'utf8')).toBe(PI_HARNESS_EXTENSION_SOURCE);

    const old = new Date(Date.now() - 60_000);
    await utimes(target, old, old);
    const pinned = (await stat(target)).mtimeMs;
    await materializePiHarnessExtension({ homeDir: home });
    expect((await stat(target)).mtimeMs).toBe(pinned);
  });

  it('creates and changes nothing under «home»/.pi or a cwd .pi directory', async () => {
    const project = join(home, 'project');
    await mkdir(join(project, '.pi', 'extensions'), { recursive: true });
    await mkdir(join(home, '.pi', 'agent'), { recursive: true });
    await writeFile(join(home, '.pi', 'agent', 'settings.json'), '{}');
    const beforeHome = await snapshot(join(home, '.pi'));
    const beforeProject = await snapshot(join(project, '.pi'));

    const target = await materializePiHarnessExtension({ homeDir: home });

    expect(target.startsWith(join(home, '.ai-conductor', 'pi') + '/')).toBe(true);
    expect(await snapshot(join(home, '.pi'))).toEqual(beforeHome);
    expect(await snapshot(join(project, '.pi'))).toEqual(beforeProject);
    expect(await readFile(join(home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe('{}');
  });

  it.skipIf(process.getuid?.() === 0)('throws naming the asset path when the directory is not writable', async () => {
    const dir = join(home, '.ai-conductor', 'pi');
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o500);

    await expect(materializePiHarnessExtension({ homeDir: home }))
      .rejects.toThrow(new RegExp(`${dir}/harness-extension-[0-9a-f]{16}\\.ts`));
  });

  it('verifies the written bytes after write and rename and refuses a mismatch', async () => {
    // A torn or tampered write: the bytes landing on disk differ from the bytes requested.
    const tornWrite = (path: string, data: string) => writeFile(path, `${data}\n// torn`, 'utf8');

    await expect(materializePiHarnessExtension({ homeDir: home, writeFile: tornWrite }))
      .rejects.toThrow(/harness-extension-[0-9a-f]{16}\.ts: written bytes do not match/);
  });

  it('keeps the asset source free of import and require statements', () => {
    expect(PI_HARNESS_EXTENSION_SOURCE).not.toMatch(/(^|[^\w.])import\s*\(/);
    expect(PI_HARNESS_EXTENSION_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(PI_HARNESS_EXTENSION_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});
