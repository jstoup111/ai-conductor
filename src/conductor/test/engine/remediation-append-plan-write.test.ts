// Regression: `appendRemediationTasks` wrote the updated plan with
// `await require('node:fs/promises').rename(...)`. The shipped engine is a pure
// ESM bundle, where esbuild rewrites that call to `__require("fs/promises")` —
// a shim that throws "Dynamic require of ... is not supported" whenever a
// CommonJS `require` is absent. The surrounding try/catch swallowed the
// TypeError and returned `{ success: false }`, so EVERY remediation append
// silently failed: no `rem-*` task ever reached the plan and a remediation
// routed to `build` became a no-op.
//
// Vitest's module runner supplies a `require` binding, so an in-process call
// cannot see this defect. The test therefore drives the real function through a
// real Node ESM loader in a child process — the same environment the shipped
// bundle runs in — against a real temporary plan file. No fs mocking: the
// rename path itself is the subject.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSX_LOADER = join(CONDUCTOR_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const CONDUCTOR_SOURCE = join(CONDUCTOR_ROOT, 'src', 'engine', 'conductor.ts');

describe('appendRemediationTasks under a real ESM loader (no CommonJS require)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'remediation-append-esm-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends rem-* task headers to the real plan file and reports success', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n\n## Tasks\n\n### Task 1: First task\n');

    const driver = join(dir, 'driver.mjs');
    await writeFile(
      driver,
      [
        `import { appendRemediationTasks } from ${JSON.stringify(pathToFileURL(CONDUCTOR_SOURCE).href)};`,
        `const result = await appendRemediationTasks(${JSON.stringify(dir)}, ${JSON.stringify(planPath)}, [`,
        `  { id: 'rem-test-1', title: 'Restore the failing suite' },`,
        `  { id: 'rem-test-2', title: 'Cover the regression' },`,
        `]);`,
        `process.stdout.write('RESULT:' + JSON.stringify(result));`,
        '',
      ].join('\n'),
      'utf-8',
    );

    const run = await execa('node', ['--import', TSX_LOADER, driver], {
      cwd: dir,
      reject: false,
    });

    const reported = run.stdout.split('RESULT:')[1];
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(reported)).toMatchObject({
      success: true,
      appendedIds: ['rem-test-1', 'rem-test-2'],
    });

    const content = await readFile(planPath, 'utf-8');
    expect(content).toContain('### Task rem-test-1: Restore the failing suite');
    expect(content).toContain('### Task rem-test-2: Cover the regression');
    // The pre-existing plan body survives the atomic replace.
    expect(content).toContain('### Task 1: First task');
  }, 60_000);
});
