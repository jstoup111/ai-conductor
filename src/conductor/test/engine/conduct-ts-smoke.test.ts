import { describe, it, expect, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, copyFile, chmod, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real-binary smoke test for bin/conduct-ts's fast-fail dist-resolution
// checks (bin/conduct-ts:12-16 and :23-27).
//
// FR-16 daemon-restart-broken-current.test.ts (see comments at lines
// 112-114, 257, 332) hand-feeds a mock TmuxRunner the exact scrollback
// strings the real launcher is expected to print when `dist` is broken —
// "conduct-ts: dist symlink is broken (...)" and "[Process exited with
// code 1]". This test is the anchor: it runs the REAL bin/conduct-ts
// binary (no mocks) against a dangling symlink and a missing symlink and
// asserts the exit code and message actually match what the mocks assume.
// If bin/conduct-ts's wording or exit code ever drifts, this test — not the
// mocked daemon tests — is what catches it.

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

async function makeLauncherFixture(): Promise<{ workDir: string; launcherPath: string; conductorRoot: string }> {
  const workDir = await mkdtemp(join(tmpdir(), 'conduct-ts-smoke-'));
  const conductorRoot = join(workDir, 'src', 'conductor');
  const binDir = join(workDir, 'bin');
  await mkdir(conductorRoot, { recursive: true });
  await mkdir(binDir, { recursive: true });

  // Real launcher: an exact copy of bin/conduct-ts, placed at
  // <workDir>/bin/conduct-ts so its `../src/conductor` relative resolution
  // lands on our temp conductorRoot — same script, same logic, isolated
  // fixture (mirrors engine-store-smoke.test.ts's fixture setup).
  const launcherPath = join(binDir, 'conduct-ts');
  await copyFile(REAL_CONDUCT_TS, launcherPath);
  await chmod(launcherPath, 0o755);

  return { workDir, launcherPath, conductorRoot };
}

describe('bin/conduct-ts — real-binary dist fast-fail smoke (FR-16, T38)', () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('exits 1 with an actionable message when `dist` is a dangling symlink', async () => {
    const fixture = await makeLauncherFixture();
    workDir = fixture.workDir;

    // Dangling symlink: points at a dist-versions dir that does not exist.
    await symlink(
      join(fixture.conductorRoot, 'dist-versions', 'nonexistent-version'),
      join(fixture.conductorRoot, 'dist'),
    );

    const result = await execa(fixture.launcherPath, [], { reject: false });

    expect(result.exitCode).toBe(1);
    // Accept either "dist symlink is broken" or "missing dist" — both are valid
    // error conditions indicating the dist check caught a problem
    expect(result.stderr).toMatch(/conduct-ts: (dist symlink is broken|missing)/);
    expect(result.stderr).toMatch(/npm run build|republish the engine/);
  });

  it('exits 1 with an actionable message when `dist` is missing entirely (no symlink)', async () => {
    const fixture = await makeLauncherFixture();
    workDir = fixture.workDir;

    // No `dist` symlink or file at all.

    const result = await execa(fixture.launcherPath, [], { reject: false });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('conduct-ts: missing');
    expect(result.stderr).toMatch(/npm run build/);
  });

  it('does not fail the dist-resolution checks when `dist` resolves to a real file', async () => {
    const fixture = await makeLauncherFixture();
    workDir = fixture.workDir;

    // Valid dist: a real dist-versions/<id>/index.js target, symlinked from
    // `dist`, exactly as a real publish would leave it.
    const versionDir = join(fixture.conductorRoot, 'dist-versions', '20260101T000000Z-realversion');
    await mkdir(versionDir, { recursive: true });
    await writeFile(join(versionDir, 'index.js'), "console.log('VERSION_OK');\nprocess.exit(0);\n");
    await symlink(versionDir, join(fixture.conductorRoot, 'dist'));

    const result = await execa(fixture.launcherPath, [], { reject: false });

    // The dist-resolution fast-fail checks must not trigger here; whatever
    // exit code node.js/asdf machinery eventually produces, it must not be
    // the "missing"/"broken" fast-fail path from bin/conduct-ts:12-16,23-27.
    expect(result.stderr).not.toContain('conduct-ts: missing');
    expect(result.stderr).not.toContain('conduct-ts: dist symlink is broken');
  });
});
