// Covers: task:14
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTargetCheckout } from '../../src/engine/engineer/intake/target-checkout.js';

const tempDirs: string[] = [];
const originalRegistry = process.env.AI_CONDUCTOR_REGISTRY;

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'intake-target-checkout-'));
  tempDirs.push(dir);
  return dir;
}

async function registry(records: unknown[]): Promise<void> {
  const path = join(await tempDir(), 'registry.json');
  await writeFile(path, JSON.stringify(records), 'utf8');
  process.env.AI_CONDUCTOR_REGISTRY = path;
}

async function checkout(origin: string): Promise<string> {
  const path = await tempDir();
  await execa('git', ['init', '--quiet', path]);
  await execa('git', ['-C', path, 'remote', 'add', 'origin', origin]);
  return path;
}

afterEach(async () => {
  if (originalRegistry === undefined) delete process.env.AI_CONDUCTOR_REGISTRY;
  else process.env.AI_CONDUCTOR_REGISTRY = originalRegistry;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveTargetCheckout', () => {
  it('matches an invoking SSH checkout regardless of repository casing', async () => {
    const cwd = await checkout('ssh://git@github.com/acme/widgets.git');
    await registry([]);

    await expect(resolveTargetCheckout({
      cwd,
      repository: 'AcMe/WidGets',
    })).resolves.toEqual({ kind: 'checkout', path: cwd });
  });

  it('prefers a matching invoking checkout, otherwise selects exactly one registry checkout', async () => {
    const cwd = await checkout('git@github.com:acme/widgets.git');
    const targetPath = await checkout('https://github.com/acme/widgets');
    const unrelated = await checkout('git@github.com:acme/other.git');
    await registry([
      { name: 'widgets', path: targetPath, remote: 'https://github.com/acme/widgets', status: 'registered' },
    ]);

    await expect(resolveTargetCheckout({
      cwd,
      repository: 'acme/widgets',
    })).resolves.toEqual({ kind: 'checkout', path: cwd });

    await expect(resolveTargetCheckout({
      cwd: unrelated,
      repository: 'acme/widgets',
    })).resolves.toEqual({ kind: 'checkout', path: targetPath });
  });

  it('skips when no origin or registry remote resolves to the target', async () => {
    const cwd = await checkout('git@github.com:acme/other.git');
    await registry([]);

    await expect(resolveTargetCheckout({
      cwd,
      repository: 'acme/widgets',
    })).resolves.toEqual({ kind: 'none', reason: 'no-match' });
  });

  it('skips ambiguous registry matches', async () => {
    const cwd = await checkout('git@github.com:acme/other.git');
    const first = await checkout('https://github.com/acme/widgets.git');
    const second = await checkout('git@github.com:acme/widgets.git');
    await registry([
      { name: 'widgets-one', path: first, remote: 'https://github.com/acme/widgets.git', status: 'registered' },
      { name: 'widgets-two', path: second, remote: 'git@github.com:acme/widgets.git', status: 'registered' },
    ]);

    await expect(resolveTargetCheckout({
      cwd,
      repository: 'acme/widgets',
    })).resolves.toEqual({ kind: 'none', reason: 'ambiguous' });
  });
});
