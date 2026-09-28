// Covers: S7.7, S7.8 (Task 22) — rewind removes the as-built verdict/report pair
// together, and a failed rewind restores both with their original bytes.
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConductState } from '../../src/types/index.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { AS_BUILT_REPORT_PATH, AS_BUILT_VERDICT_PATH } from '../../src/engine/as-built-verdict-store.js';

const completeState: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
  architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
  conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
  build: 'done', test_suite: 'done', build_review: 'done',
  manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
  rebase: 'done', finish: 'done', last_step: 'finish',
};

const VERDICT = '{ "attemptId": "attempt-1" }\n';
const REPORT = '# As-built architecture review\n\nVerdict: APPROVED\n';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rewind-as-built-pair-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline/gates'), { recursive: true });
  await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(completeState));
  await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
  await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
  await writeFile(join(root, AS_BUILT_VERDICT_PATH), VERDICT);
  await writeFile(join(root, AS_BUILT_REPORT_PATH), REPORT);
  return root;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(() => true, () => false);
}

describe('rewind of the as-built step', () => {
  it('removes both the typed verdict and the rendered report', async () => {
    const root = await fixture();

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);

    expect(await exists(join(root, AS_BUILT_VERDICT_PATH))).toBe(false);
    expect(await exists(join(root, AS_BUILT_REPORT_PATH))).toBe(false);
    expect((await readdir(join(root, '.pipeline'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
  });

  it('restores both files with their original contents when the rewind fails after staging them', async () => {
    const root = await fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
      markerFilesystem: {
        rename,
        remove: async () => { throw new Error('halt removal failed'); },
        readFile: (path) => readFile(path, 'utf-8'),
        restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
        writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
      },
    })).resolves.toBe(1);

    expect(await readFile(join(root, AS_BUILT_VERDICT_PATH), 'utf-8')).toBe(VERDICT);
    expect(await readFile(join(root, AS_BUILT_REPORT_PATH), 'utf-8')).toBe(REPORT);
    expect((await readdir(join(root, '.pipeline'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
  });
});
