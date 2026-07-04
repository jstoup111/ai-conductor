import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, readFile, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';

// ─────────────────────────────────────────────────────────────────────────────
// Tests for scripts/publish-engine.mjs (Task 2, Phase 1 — FR-13 happy:
// "publish flow is staging -> finalize").
//
// Covers: publish builds into a staging dir, the finalized dir appears
// under `dist-versions/<id>/`, and staging is removed. The real `tsup`
// binary is never invoked — a stub build command is injected via the
// `--tsup-cmd` CLI flag (JSON array), which is the documented test seam.
// ─────────────────────────────────────────────────────────────────────────────

const SCRIPT = join(process.cwd(), 'scripts', 'publish-engine.mjs');

let conductorRoot: string;
let stubPath: string;

beforeEach(async () => {
  conductorRoot = await mkdtemp(join(tmpdir(), 'publish-engine-test-'));
  stubPath = join(conductorRoot, 'stub-tsup.mjs');
  // A stub "build": reads --out-dir from argv, writes one file into it,
  // and exits 0. Standing in for a real tsup invocation.
  await writeFile(
    stubPath,
    [
      'import { writeFile, mkdir } from "node:fs/promises";',
      'const args = process.argv.slice(2);',
      'const outDirIdx = args.indexOf("--out-dir");',
      'const outDir = args[outDirIdx + 1];',
      'await mkdir(outDir, { recursive: true });',
      'await writeFile(`${outDir}/index.js`, "export const built = true;\\n");',
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterEach(async () => {
  await rm(conductorRoot, { recursive: true, force: true });
});

function runPublish(extraArgs: string[] = []) {
  return execa(
    'node',
    [
      SCRIPT,
      '--conductor-root',
      conductorRoot,
      '--tsup-cmd',
      JSON.stringify(['node', stubPath]),
      ...extraArgs,
    ],
    { reject: false },
  );
}

describe('publish-engine.mjs', () => {
  it('builds into a staging dir, finalizes it under dist-versions/<id>/, and removes staging', async () => {
    const result = await runPublish();

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.versionId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/);
    expect(output.dir).toBe(join(conductorRoot, 'dist-versions', output.versionId));

    // Finalized dir exists and contains the built file.
    const finalizedFiles = await readdir(output.dir);
    expect(finalizedFiles).toContain('index.js');
    const contents = await readFile(join(output.dir, 'index.js'), 'utf-8');
    expect(contents).toContain('built = true');

    // No staging dir left behind under conductorRoot.
    const rootEntries = await readdir(conductorRoot);
    const stagingLeftovers = rootEntries.filter((name) => name.startsWith('.engine-staging-'));
    expect(stagingLeftovers).toEqual([]);
  });

  it('removes the staging dir and exits non-zero when the build command fails', async () => {
    const failingStub = join(conductorRoot, 'failing-stub.mjs');
    await writeFile(failingStub, 'process.exit(1);\n', 'utf-8');

    const result = await execa(
      'node',
      [
        SCRIPT,
        '--conductor-root',
        conductorRoot,
        '--tsup-cmd',
        JSON.stringify(['node', failingStub]),
      ],
      { reject: false },
    );

    expect(result.exitCode).not.toBe(0);

    const rootEntries = await readdir(conductorRoot);
    const stagingLeftovers = rootEntries.filter((name) => name.startsWith('.engine-staging-'));
    expect(stagingLeftovers).toEqual([]);
    const distVersionsExists = rootEntries.includes('dist-versions');
    expect(distVersionsExists).toBe(false);
  });

  it('honors AI_CONDUCTOR_ENGINE_STORE to finalize under an overridden store root', async () => {
    const customStore = await mkdtemp(join(tmpdir(), 'publish-engine-store-'));
    try {
      const result = await execa(
        'node',
        [SCRIPT, '--conductor-root', conductorRoot, '--tsup-cmd', JSON.stringify(['node', stubPath])],
        {
          reject: false,
          env: { ...process.env, AI_CONDUCTOR_ENGINE_STORE: customStore },
        },
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.dir).toBe(join(customStore, output.versionId));
      const finalizedFiles = await readdir(output.dir);
      expect(finalizedFiles).toContain('index.js');
    } finally {
      await rm(customStore, { recursive: true, force: true });
    }
  });
});
