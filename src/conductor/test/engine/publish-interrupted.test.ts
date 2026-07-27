import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readlink, lstat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { publish } from '../../scripts/publish-engine.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Task 9 (FR-13 neg): interrupted publish recovery.
//
// A publish killed in the narrow window between finalizing the staging dir
// (rename into `dist-versions/<id>/`) and flipping the `dist` symlink leaves
// an orphaned, never-flipped version directory behind. `current` (`dist`)
// must be untouched by the interruption, and the *next* publish must detect
// and clean up that orphaned directory before doing anything else, then
// still succeed in producing + flipping to a fresh version.
//
// Uses the `simulateCrashAfterFinalize` test seam (documented on `publish()`
// in scripts/publish-engine.mjs) to deterministically land in that exact
// window — a real SIGKILL can't be caught, so this models the same
// post-finalize/pre-flip state without relying on OS process-kill timing.
// ─────────────────────────────────────────────────────────────────────────────

let conductorRoot: string;

async function writeStub(path: string, content: string) {
  await writeFile(path, content, 'utf-8');
}

function stubBuildContent(marker: string) {
  return [
    'import { writeFile, mkdir } from "node:fs/promises";',
    'const args = process.argv.slice(2);',
    'const outDirIdx = args.indexOf("--out-dir");',
    'const outDir = args[outDirIdx + 1];',
    'await mkdir(outDir, { recursive: true });',
    `await writeFile(\`\${outDir}/index.js\`, "export const built = '${marker}';\\n");`,
    '',
  ].join('\n');
}

beforeEach(async () => {
  conductorRoot = await mkdtemp(join(tmpdir(), 'publish-interrupted-test-'));
});

afterEach(async () => {
  await rm(conductorRoot, { recursive: true, force: true });
});

describe('interrupted publish recovery', () => {
  it('leaves `current` untouched and the finalized dir orphaned when killed between finalize and flip', async () => {
    // First, an ordinary successful publish so a real `current` exists.
    const stub1 = join(conductorRoot, 'stub-1.mjs');
    await writeStub(stub1, stubBuildContent('first'));
    const first = await publish({ conductorRoot, tsupCommand: ['node', stub1] });

    const distPath = join(conductorRoot, 'dist');
    const targetBefore = resolve(dirname(distPath), await readlink(distPath));
    expect(targetBefore).toBe(resolve(first.dir));

    // Second publish: interrupted right after finalize, before flip.
    const stub2 = join(conductorRoot, 'stub-2.mjs');
    await writeStub(stub2, stubBuildContent('second'));

    let orphanedDir: string | undefined;
    await expect(
      publish({
        conductorRoot,
        tsupCommand: ['node', stub2],
        simulateCrashAfterFinalize: async () => {
          throw new Error('simulated kill between finalize and flip');
        },
      }),
    ).rejects.toThrow(/simulated kill/);

    // `current` (`dist`) must be untouched — still points at the first publish.
    const targetAfter = resolve(dirname(distPath), await readlink(distPath));
    expect(targetAfter).toBe(resolve(first.dir));

    // The second build's finalized dir exists under dist-versions/ but was
    // never flipped to — it's orphaned.
    const versionsDir = join(conductorRoot, 'dist-versions');
    const entries = await readdir(versionsDir);
    expect(entries.length).toBe(2); // first (current) + orphaned second

    for (const entry of entries) {
      const entryPath = join(versionsDir, entry);
      if (resolve(entryPath) === resolve(first.dir)) continue;
      orphanedDir = entryPath;
    }
    expect(orphanedDir).toBeDefined();
    if (!orphanedDir) throw new Error('orphanedDir must be defined');

    // The orphaned dir still carries the "finalized but not flipped" sentinel.
    await expect(lstat(join(orphanedDir, '.publish-incomplete'))).resolves.toBeDefined();
  });

  it('cleans up orphaned staging from a previous interrupted run on the next publish and still succeeds', async () => {
    const stub1 = join(conductorRoot, 'stub-1.mjs');
    await writeStub(stub1, stubBuildContent('first'));
    const first = await publish({ conductorRoot, tsupCommand: ['node', stub1] });

    const stub2 = join(conductorRoot, 'stub-2.mjs');
    await writeStub(stub2, stubBuildContent('second'));
    await expect(
      publish({
        conductorRoot,
        tsupCommand: ['node', stub2],
        simulateCrashAfterFinalize: async () => {
          throw new Error('simulated kill');
        },
      }),
    ).rejects.toThrow(/simulated kill/);

    const versionsDir = join(conductorRoot, 'dist-versions');
    expect((await readdir(versionsDir)).length).toBe(2);

    // Third publish: no crash injected this time. It must detect + remove
    // the orphaned dir from the interrupted second publish, then complete
    // normally.
    const stub3 = join(conductorRoot, 'stub-3.mjs');
    await writeStub(stub3, stubBuildContent('third'));
    const third = await publish({ conductorRoot, tsupCommand: ['node', stub3] });

    const entriesAfter = await readdir(versionsDir);
    // Only the original `first` (still current until flip) and the new
    // `third` (now current) remain — the orphaned second is gone.
    expect(entriesAfter.length).toBe(2);
    expect(entriesAfter).toContain(third.versionId);

    const distPath = join(conductorRoot, 'dist');
    const target = resolve(dirname(distPath), await readlink(distPath));
    expect(target).toBe(resolve(third.dir));

    // No leftover `.publish-incomplete` sentinels anywhere under the store.
    for (const entry of entriesAfter) {
      const sentinelPath = join(versionsDir, entry, '.publish-incomplete');
      await expect(lstat(sentinelPath)).rejects.toThrow();
    }

    // Sanity: `first`'s dir is untouched by the cleanup (it has no sentinel).
    expect(entriesAfter.map((e) => join(versionsDir, e))).toContain(first.dir);
  });
});
