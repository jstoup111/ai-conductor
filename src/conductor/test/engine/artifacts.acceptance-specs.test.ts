// Task: 10
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
// Spy targets for the process-level exec surface. artifacts.ts does not
// import child_process at all today (that's the purity being pinned), so
// these mocks intercept the module directly rather than relying on
// vi.spyOn — child_process's exports are non-configurable and cannot be
// spied on in place.
const execSpy = vi.fn();
const execFileSpy = vi.fn();
const execSyncSpy = vi.fn();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: (...args: unknown[]) => execSpy(...args),
    execFile: (...args: unknown[]) => execFileSpy(...args),
    execSync: (...args: unknown[]) => execSyncSpy(...args),
  };
});

import { checkStepCompletion, ACCEPTANCE_SPECS_RED_EVIDENCE } from '../../src/engine/artifacts.js';

// Regression pin for #733's self-heal boundary: the acceptance_specs
// completion predicate must remain a pure, synchronous-per-call READ of the
// worktree-root evidence marker. Task 9 wired the self-heal *execution* into
// conductor.ts's step-handling seam, specifically so the predicate itself
// never shells out and never reaches into a nested (non-root) path. This
// test spies on the process-level exec surface and on the marker path the
// predicate touches, and fails if either boundary is ever crossed again.
describe('engine/artifacts — acceptance_specs predicate purity', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'artifacts-acceptance-specs-test-'));
    execSpy.mockClear();
    execFileSpy.mockClear();
    execSyncSpy.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createFile(relativePath: string, content = 'test') {
    const fullPath = join(dir, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  const validEvidence = {
    command: 'pytest spec/integration/test_x.py',
    targetSpecs: ['spec/integration/test_x.py'],
    executed: 3,
    passed: 0,
    failed: 3,
    skipped: 0,
    errors: 0,
  };

  it('performs no subprocess exec when the RED marker is missing (miss path)', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    expect(result.done).toBe(false);
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(execSyncSpy).not.toHaveBeenCalled();
  });

  it('performs no subprocess exec when the RED marker is present and valid (hit path)', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    await createFile(ACCEPTANCE_SPECS_RED_EVIDENCE, JSON.stringify(validEvidence));

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    expect(result.done).toBe(true);
    expect(execSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(execSyncSpy).not.toHaveBeenCalled();
  });

  it('reads only the worktree-root marker path, never a nested marker path', async () => {
    await createFile('test/acceptance/foo.spec.ts', 'spec content');
    // Plant a nested marker at a plausible-but-wrong location; if the
    // predicate ever drifted to reading a nested path instead of (or in
    // addition to) the root marker, this would let a nested-only marker
    // satisfy the gate. It must not.
    await createFile(
      join('src/conductor', ACCEPTANCE_SPECS_RED_EVIDENCE),
      JSON.stringify(validEvidence),
    );

    const result = await checkStepCompletion(dir, 'acceptance_specs');

    // No root marker exists, so the gate must still report not-done —
    // proving the predicate never fell back to the nested path.
    expect(result.done).toBe(false);
    expect(result.reason).toContain(ACCEPTANCE_SPECS_RED_EVIDENCE);
  });
});
