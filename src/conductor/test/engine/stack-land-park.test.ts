// Covers: task:11
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createOwnedPark, releaseOwnedPark, writeOperatorPark } from '../../src/engine/park-marker.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('stack land owned park release', () => {
  it('releases only the park capability created by the landing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-land-park-'));
    roots.push(root);
    const owned = await createOwnedPark(root, 'demo');
    if (!owned.created) throw new Error('expected an owned park');
    const marker = join(root, '.daemon', 'parked', 'demo');
    await expect(readFile(marker, 'utf8')).resolves.toContain('owned-park-token:');
    await releaseOwnedPark(root, 'demo', owned.token);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const replacement = await createOwnedPark(root, 'demo');
    if (!replacement.created) throw new Error('expected replacement park');
    await unlink(marker);
    await writeOperatorPark(root, 'demo');
    await releaseOwnedPark(root, 'demo', replacement.token);
    await expect(readFile(marker, 'utf8')).resolves.not.toContain('owned-park-token:');
  });
});
