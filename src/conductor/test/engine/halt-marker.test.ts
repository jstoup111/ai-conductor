import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});

import { writeFile } from 'node:fs/promises';
import { writeHaltMarker, HALT_MARKER, HALT_CLASS_MARKER } from '../../src/engine/halt-marker';

describe('writeHaltMarker', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes HALT.class with the given halt class when a third argument is provided', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await writeHaltMarker(root, 'reason', 'needs-human');
    const contents = await readFile(join(root, HALT_CLASS_MARKER), 'utf-8');
    expect(contents).toContain('needs-human');
  });

  it('does not write a HALT.class sidecar when the third argument is omitted', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    await writeHaltMarker(root, 'reason');
    await expect(readFile(join(root, HALT_CLASS_MARKER), 'utf-8')).rejects.toThrow();
  });

  it('still writes HALT and does not throw when the sidecar write fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'halt-marker-'));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const mockedWriteFile = vi.mocked(writeFile);
    mockedWriteFile.mockImplementation(async (path: any, ...rest: any[]) => {
      if (typeof path === 'string' && path.endsWith(HALT_CLASS_MARKER)) {
        throw new Error('EACCES: sidecar unwritable');
      }
      return (actual.writeFile as any)(path, ...rest);
    });

    await expect(writeHaltMarker(root, 'reason', 'needs-human')).resolves.toBeUndefined();

    const contents = await readFile(join(root, HALT_MARKER), 'utf-8');
    expect(contents).toBe('reason');
  });
});
