import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInventory } from '../../scripts/check-interpreter-source.mts';

describe('interpreter-source inventory', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  async function root(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'interpreter-inventory-'));
    roots.push(directory);
    await mkdir(join(directory, 'bin'), { recursive: true });
    await mkdir(join(directory, 'hooks'), { recursive: true });
    await writeFile(join(directory, 'bin', 'safe'), '#!/bin/sh\nnode -e \'console.log(process.argv[1])\' -- "$VALUE"\n');
    return directory;
  }

  it('scans unsafe shipped files but excludes documentation and test specimens', async () => {
    const directory = await root();
    await writeFile(join(directory, 'bin', 'unsafe'), 'python3 -c "print($SECRET)"\n');
    await mkdir(join(directory, 'docs'), { recursive: true });
    await writeFile(join(directory, 'docs', 'unsafe.md'), 'python3 -c "print($SECRET)"\n');
    await expect(checkInventory(directory, { generated: { SAFE: '#!/bin/sh\ntrue\n' } })).resolves.toEqual([
      expect.objectContaining({ sourceName: 'bin/unsafe', line: 1 }),
    ]);
  });

  it.each([
    ['unclassified export', { generated: { SAFE: '#!/bin/sh\ntrue\n', build: () => 'safe' } }, /unclassified/],
    ['empty generated inventory', { generated: {} }, /inventory is empty/],
  ])('fails closed for %s', async (_name, modules, message) => {
    await expect(checkInventory(await root(), modules)).rejects.toThrow(message);
  });

  it('fails closed when the generated-hook module loader fails', async () => {
    await expect(checkInventory(await root(), {}, async () => { throw new Error('controlled loader failure'); }))
      .rejects.toThrow('controlled loader failure');
  });

  it('fails closed for an empty file inventory and required file reads', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'interpreter-empty-'));
    roots.push(empty);
    await mkdir(join(empty, 'bin'));
    await mkdir(join(empty, 'hooks'));
    await expect(checkInventory(empty, { generated: { SAFE: 'true\n' } })).rejects.toThrow(/inventory is empty/);
    const directory = await root();
    await rm(join(directory, 'bin', 'safe'));
    await writeFile(join(directory, 'bin', 'broken'), '');
    await expect(checkInventory(directory, { generated: { SAFE: 'true\n' } })).resolves.toEqual([]);
  });
});
