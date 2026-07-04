import { describe, it, expect, afterEach } from 'vitest';
import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, copyFile, chmod, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish } from '../../scripts/publish-engine.mjs';

// Real-binary #215 smoke test (Task 8, FR-13 Done-When).
//
// Proves the exact bug #215 fix end-to-end with a real launcher, a real
// publish, and a real long-lived Node process — no mocks:
//
//   1. Start a long-lived Node process from version A via the REAL launcher
//      (a copy of bin/conduct-ts, driven the same way an operator's shell
//      would: `exec node "$DIST_REAL" ...`, where DIST_REAL is `dist`
//      resolved to its real `dist-versions/<A>/` target at LAUNCH time).
//   2. While that process is still running, run a REAL publish (the actual
//      `publish()` orchestration in scripts/publish-engine.mjs — staging,
//      finalize, atomic `dist` symlink flip) to create version B.
//   3. The still-running A process then performs its FIRST dynamic
//      `import()` of a sibling module. Because the launcher pinned it to
//      A's real (non-symlink) directory at launch, that import must resolve
//      from A and succeed — no ENOENT — even though `dist` now points at B.
//   4. A FRESH invocation of the real launcher (started after the flip)
//      must resolve version B.
//
// Prior to the versioned-engine-store fix, a long-lived process that
// resolved modules through the *symlink* (rather than a path pinned to the
// real target at launch) would ENOENT on step 3 the moment publish flipped
// `dist` out from under it mid-flight. This test is the regression guard.

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

async function waitForFile(path: string, timeoutMs = 10_000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForFile: ${path} did not appear within ${timeoutMs}ms`);
}

describe('engine-store — real-binary #215 smoke (Task 8, FR-13)', () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it(
    'long-lived process launched from A survives a real publish to B: first dynamic import resolves from A (no ENOENT), fresh launcher resolves B',
    async () => {
      workDir = await mkdtemp(join(tmpdir(), 'engine-store-smoke-'));
      const conductorRoot = join(workDir, 'src', 'conductor');
      const binDir = join(workDir, 'bin');
      await mkdir(conductorRoot, { recursive: true });
      await mkdir(binDir, { recursive: true });

      // Real launcher: an exact copy of bin/conduct-ts, placed at
      // <workDir>/bin/conduct-ts so its `../src/conductor` relative
      // resolution lands on our temp conductorRoot — same script, same
      // logic, isolated fixture.
      const launcherPath = join(binDir, 'conduct-ts');
      await copyFile(REAL_CONDUCT_TS, launcherPath);
      await chmod(launcherPath, 0o755);

      const pidFile = join(workDir, 'pid-a.txt');
      const triggerFile = join(workDir, 'trigger.txt');
      const resultFile = join(workDir, 'result.json');

      // Stub "build" for version A: a long-lived entrypoint that (1) records
      // its own pid, (2) waits for a trigger file (so the dynamic import
      // happens strictly AFTER the real publish below has flipped `dist` to
      // B), then (3) performs its first dynamic import of a sibling module
      // that lives only inside A's own version directory. Paths are passed
      // in via env vars (set on the launcher's spawn below) rather than
      // baked into the generated source, to avoid string-escaping hell.
      const stubA = join(workDir, 'stub-a.mjs');
      await writeFile(
        stubA,
        [
          'import { writeFile, mkdir } from "node:fs/promises";',
          'const args = process.argv.slice(2);',
          'const outDirIdx = args.indexOf("--out-dir");',
          'const outDir = args[outDirIdx + 1];',
          'await mkdir(outDir, { recursive: true });',
          'await writeFile(`${outDir}/lazy.js`, "export const marker = \'A\';\\n");',
          'const indexSrc = [',
          '  "import { writeFile } from \'node:fs/promises\';",',
          '  "import { existsSync } from \'node:fs\';",',
          '  "const pidFile = process.env.SMOKE_PID_FILE;",',
          '  "const triggerFile = process.env.SMOKE_TRIGGER_FILE;",',
          '  "const resultFile = process.env.SMOKE_RESULT_FILE;",',
          '  "await writeFile(pidFile, String(process.pid));",',
          '  "while (!existsSync(triggerFile)) { await new Promise((r) => setTimeout(r, 25)); }",',
          '  "try {",',
          '  "  const mod = await import(\'./lazy.js\');",',
          '  "  await writeFile(resultFile, JSON.stringify({ ok: true, marker: mod.marker }));",',
          '  "} catch (err) {",',
          '  "  await writeFile(resultFile, JSON.stringify({ ok: false, code: err && err.code, message: String((err && err.message) || err) }));",',
          '  "}",',
          '].join("\\n");',
          'await writeFile(`${outDir}/index.js`, indexSrc);',
          '',
        ].join('\n'),
        'utf-8',
      );

      // Stub "build" for version B: a short-lived entrypoint that just
      // prints a version marker and exits — proves a FRESH launcher
      // invocation resolves the new version.
      const stubB = join(workDir, 'stub-b.mjs');
      await writeFile(
        stubB,
        [
          'import { writeFile, mkdir } from "node:fs/promises";',
          'const args = process.argv.slice(2);',
          'const outDirIdx = args.indexOf("--out-dir");',
          'const outDir = args[outDirIdx + 1];',
          'await mkdir(outDir, { recursive: true });',
          'await writeFile(`${outDir}/index.js`, "console.log(\'VERSION_B\');\\nprocess.exit(0);\\n");',
          '',
        ].join('\n'),
        'utf-8',
      );

      // 1. Real publish of version A (staging -> finalize -> atomic flip),
      // using the exact `publish()` orchestration under test.
      const { versionId: versionA } = await publish({
        conductorRoot,
        tsupCommand: ['node', stubA],
      });
      expect(versionA).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/);

      // 2. Start the long-lived process FROM VERSION A via the REAL
      // launcher. conduct-ts resolves `dist` to its real target (A) via
      // `readlink -f` at launch time and execs that resolved path directly.
      const aProcess = execa(launcherPath, [], {
        reject: false,
        env: {
          ...process.env,
          SMOKE_PID_FILE: pidFile,
          SMOKE_TRIGGER_FILE: triggerFile,
          SMOKE_RESULT_FILE: resultFile,
        },
      });

      try {
        // Long-lived process is up and has recorded its pid.
        await waitForFile(pidFile);
        const recordedPid = (await readFile(pidFile, 'utf-8')).trim();
        expect(recordedPid).toMatch(/^\d+$/);

        // 3. REAL publish creates version B WHILE A is still running,
        // atomically flipping `dist` out from under A.
        const { versionId: versionB, dir: dirB } = await publish({
          conductorRoot,
          tsupCommand: ['node', stubB],
        });
        expect(versionB).not.toBe(versionA);

        // 4. A's FIRST dynamic import happens only now (after the flip) —
        // trigger it and verify it resolved from A, not ENOENT.
        await writeFile(triggerFile, '1');
        await waitForFile(resultFile);
        const result = JSON.parse(await readFile(resultFile, 'utf-8'));
        expect(result.ok).toBe(true);
        expect(result.marker).toBe('A');
        expect(result.code).not.toBe('ENOENT');

        // A's own process exits cleanly after the import completes.
        const aResult = await aProcess;
        expect(aResult.exitCode).toBe(0);

        // 5. A FRESH launcher invocation (started after the flip) resolves
        // version B.
        const freshInvocation = await execa(launcherPath, [], { reject: false });
        expect(freshInvocation.exitCode).toBe(0);
        expect(freshInvocation.stdout).toContain('VERSION_B');

        // Sanity: B really is what `dist` now points at.
        expect(dirB).toBe(join(conductorRoot, 'dist-versions', versionB));
      } finally {
        if (aProcess.exitCode === null) {
          aProcess.kill('SIGKILL');
        }
      }
    },
    30_000,
  );
});
