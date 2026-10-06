// Covers: task:22
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RewindCommandDependencies } from '../../src/engine/rewind.js';
import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import type { ConductState } from '../../src/types/index.js';

const completeState: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
  architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
  conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
  build: 'done', test_suite: 'done', build_review: 'done', manual_test: 'done',
  prd_audit: 'done', architecture_review_as_built: 'done', rebase: 'done', finish: 'done',
  last_step: 'finish',
};

async function pipelineFileBytes(root: string): Promise<Map<string, string>> {
  const pipeline = join(root, '.pipeline');
  const files = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.set(relative(pipeline, path), await readFile(path, 'utf-8'));
    }
  }
  await visit(pipeline);
  return files;
}

describe('rewind --child admission', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rewind-child-'));
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await Promise.all([
      writeFile(join(root, '.pipeline', 'conduct-state.json'), `${JSON.stringify(completeState, null, 2)}\n`, 'utf-8'),
      writeFile(join(root, '.pipeline', 'HALT'), 'operator action required\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'events.jsonl'), '{"type":"existing"}\n', 'utf-8'),
      ...[1, 2, 3].map(async (child) => {
        const childRoot = join(root, '.pipeline', 'children', String(child));
        await mkdir(join(childRoot, 'gates'), { recursive: true });
        await writeFile(join(childRoot, 'conduct-state.json'), '{"build_review":"done"}\n', 'utf-8');
        await writeFile(join(childRoot, 'gates', 'build_review.json'), '{"satisfied":true}\n', 'utf-8');
      }),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function expectAdmissionRefusal(
    command: { kind: 'rewind'; target: string; child: string },
    message: string,
  ): Promise<void> {
    const before = await pipelineFileBytes(root);
    const readState = vi.fn(async () => { throw new Error('state read must not run'); });
    const loadConfig = vi.fn(async () => { throw new Error('config read must not run'); });
    const preflightDerivedRecords = vi.fn(async () => { throw new Error('preflight must not run'); });
    const clearDerivedRecords = vi.fn(async () => { throw new Error('clear must not run'); });
    const emit = vi.fn(async () => { throw new Error('event emission must not run'); });
    let storeConstructed = false;
    const dependencies: RewindCommandDependencies = {
      readState,
      loadConfig,
      preflightDerivedRecords,
      clearDerivedRecords,
      emit,
    };
    Object.defineProperty(dependencies, 'store', {
      enumerable: true,
      get() {
        storeConstructed = true;
        throw new Error('state store must not be constructed');
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand(command, root, dependencies)).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith(message);
      expect(readState).not.toHaveBeenCalled();
      expect(loadConfig).not.toHaveBeenCalled();
      expect(preflightDerivedRecords).not.toHaveBeenCalled();
      expect(clearDerivedRecords).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
      expect(storeConstructed).toBe(false);
      await expect(pipelineFileBytes(root)).resolves.toEqual(before);
    } finally {
      error.mockRestore();
    }
  }

  it.each(['0', '10', 'two'])('refuses invalid child id %s before reads, stores, or event emission', async (child) => {
    await expectAdmissionRefusal(
      { kind: 'rewind', target: 'build', child },
      `rewind: invalid child id "${child}" (expected 1-9)`,
    );
  });

  it('refuses a valid child id without a child state before normal command setup', async () => {
    await expectAdmissionRefusal(
      { kind: 'rewind', target: 'build', child: '4' },
      'rewind: child 4 has no child state (.pipeline/children/4/ does not exist)',
    );
  });

  it('refuses a whole-feature target for an existing child before normal command setup', async () => {
    await expectAdmissionRefusal(
      { kind: 'rewind', target: 'prd_audit', child: '2' },
      'rewind: only acceptance_specs, build, test_suite and build_review can be rewound per child',
    );
  });

  it('keeps the flat rewind state bytes, stdout, and emitted event shape unchanged without --child', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const emit = vi.fn(async () => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, { emit })).resolves.toBe(0);

      const expectedState = {
        ...completeState,
        build: 'stale', test_suite: 'stale', build_review: 'stale', manual_test: 'stale',
        prd_audit: 'stale', architecture_review_as_built: 'stale', rebase: 'stale', finish: 'stale',
        last_step: 'acceptance_specs',
      };
      await expect(readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf-8'))
        .resolves.toBe(`${JSON.stringify(expectedState, null, 2)}\n`);
      expect(emit).toHaveBeenCalledWith({
        target: 'build',
        demoted: ['build', 'test_suite', 'build_review', 'manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase', 'finish'],
      });
      expect(log).toHaveBeenCalledWith('Rewound to build.');
    } finally {
      log.mockRestore();
    }
  });
});
