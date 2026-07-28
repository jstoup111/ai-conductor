import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { distNeedsBuild, ensureEngineDist } from './engine-dist-guard.js';

// Unit-level: the build itself is injected, so nothing here spawns a real
// build. The seam under test is the decision — "does dist resolve, and if not,
// was it built exactly once and verified" — not the publish script.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'engine-dist-guard-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Materialize a resolvable `dist` -> `dist-versions/<id>` symlink. */
async function publishFakeEngine(at: string): Promise<void> {
  const versionDir = join(at, 'dist-versions', '20260728T004354Z-d35b417e93af');
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, 'index.js'), '// engine\n', 'utf-8');
  await symlink(join('dist-versions', '20260728T004354Z-d35b417e93af'), join(at, 'dist'));
}

describe('distNeedsBuild', () => {
  it('reports a build is needed when dist is absent — the fresh-worktree case', async () => {
    expect(await distNeedsBuild(root)).toBe(true);
  });

  it('reports no build is needed once dist resolves to a real index.js', async () => {
    await publishFakeEngine(root);

    expect(await distNeedsBuild(root)).toBe(false);
  });

  it('reports a build is needed when the dist symlink dangles', async () => {
    await symlink(join('dist-versions', 'garbage-collected'), join(root, 'dist'));

    expect(await distNeedsBuild(root)).toBe(true);
  });

  it('reports a build is needed when dist exists but carries no index.js', async () => {
    await mkdir(join(root, 'dist'), { recursive: true });

    expect(await distNeedsBuild(root)).toBe(true);
  });
});

describe('ensureEngineDist', () => {
  it('builds once and reports it when dist is missing', async () => {
    const builds: string[] = [];

    const built = await ensureEngineDist(root, async (cwd) => {
      builds.push(cwd);
      await publishFakeEngine(cwd);
    });

    expect(built).toBe(true);
    expect(builds).toEqual([root]);
  });

  it('is a no-op on a warm checkout so the steady-state suite pays nothing', async () => {
    await publishFakeEngine(root);
    const builds: string[] = [];

    const built = await ensureEngineDist(root, async (cwd) => {
      builds.push(cwd);
    });

    expect(built).toBe(false);
    expect(builds).toEqual([]);
  });

  it('throws naming the unresolved path when the build leaves dist unusable', async () => {
    // A build that "succeeds" without producing a resolvable dist must fail the
    // run here, not 13 files later with "conduct-ts: missing dist".
    await expect(ensureEngineDist(root, async () => {})).rejects.toThrow(
      /engine-dist-guard: built the engine but .*dist\/index\.js.* still does not resolve/s
    );
  });

  it('propagates a build failure rather than letting the suite start without dist', async () => {
    await expect(
      ensureEngineDist(root, async () => {
        throw new Error('publish-engine.mjs exited 1');
      })
    ).rejects.toThrow(/publish-engine\.mjs exited 1/);
  });
});
