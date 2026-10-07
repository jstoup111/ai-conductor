// Covers: task:22, task:23, task:24
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RewindCommandDependencies } from '../../src/engine/rewind.js';
import { dispatchRewindCommand, rewindChildState } from '../../src/engine/rewind.js';
import { parseChildId, pipelinePathFor } from '../../src/engine/child-context.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import type { ConductState } from '../../src/types/index.js';

const completeState: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
  architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
  conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
  build: 'done', test_suite: 'done', build_review: 'done', manual_test: 'done',
  prd_audit: 'done', architecture_review_as_built: 'done', rebase: 'done', finish: 'done',
  last_step: 'finish',
};

class RecordingStateStore implements ConductStateStore<ConductState> {
  readonly batches: NamedAtomicStateMutationBatch<ConductState>[] = [];

  async apply(_mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must submit child demotions through one batch per state path');
  }

  async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.batches.push(batch);
    return { kind: 'applied' };
  }

  async replace(_replacement: PrivilegedStateReplacement<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must not replace conduct state');
  }
}

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

describe('rewind --child demotions', () => {
  let root: string;
  let paths: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rewind-child-demotions-'));
    const flatState: ConductState = {
      ...completeState,
      coverage_binding: 'done',
      last_step: 'prd_audit',
    };
    paths = [
      ...[1, 2, 3].map((child) => pipelinePathFor(root, 'conduct-state.json', parseChildId(child)!)),
      pipelinePathFor(root, 'conduct-state.json'),
    ];
    await Promise.all([
      mkdir(join(root, '.pipeline'), { recursive: true }),
      ...[1, 2, 3].map(async (child) => {
        const path = pipelinePathFor(root, 'conduct-state.json', parseChildId(child)!);
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, `${JSON.stringify({
          acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
        }, null, 2)}\n`, 'utf-8');
      }),
    ]);
    await writeFile(pipelinePathFor(root, 'conduct-state.json'), `${JSON.stringify(flatState, null, 2)}\n`, 'utf-8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('submits the target child, later children, and flat demotions through ordered state-store batches', async () => {
    const stores = new Map<string, RecordingStateStore>();
    const storeFor = (path: string): RecordingStateStore => {
      let store = stores.get(path);
      if (!store) {
        store = new RecordingStateStore();
        stores.set(path, store);
      }
      return store;
    };
    const before = await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf-8')] as const));

    const result = await rewindChildState({
      root,
      config: {},
      target: 'build',
      child: parseChildId(2)!,
      storeFor,
      readCurrentState: async (path) => JSON.parse(await readFile(path, 'utf-8')) as ConductState,
    });

    const intent = 'operator rewind to build (child 2)';
    expect([...stores.entries()].map(([path, store]) => [path, store.batches])).toEqual([
      [paths[1], [{
        name: 'operator rewind state',
        mutations: [
          { field: 'build', expected: 'done', intent, next: 'stale' },
          { field: 'test_suite', expected: 'done', intent, next: 'stale' },
          { field: 'build_review', expected: 'done', intent, next: 'stale' },
          { field: 'last_step', expected: 'build_review', intent, next: 'acceptance_specs' },
        ],
      }]],
      [paths[2], [{
        name: 'operator rewind state',
        mutations: [
          { field: 'acceptance_specs', expected: 'done', intent, next: 'stale' },
          { field: 'build', expected: 'done', intent, next: 'stale' },
          { field: 'test_suite', expected: 'done', intent, next: 'stale' },
          { field: 'build_review', expected: 'done', intent, next: 'stale' },
          { field: 'last_step', expected: 'build_review', intent, next: 'coverage_binding' },
        ],
      }]],
      [paths[3], [{
        name: 'operator rewind state',
        mutations: [
          { field: 'manual_test', expected: 'done', intent, next: 'stale' },
          { field: 'prd_audit', expected: 'done', intent, next: 'stale' },
          { field: 'architecture_review_as_built', expected: 'done', intent, next: 'stale' },
          { field: 'rebase', expected: 'done', intent, next: 'stale' },
          { field: 'finish', expected: 'done', intent, next: 'stale' },
          { field: 'last_step', expected: 'prd_audit', intent, next: 'build_review' },
        ],
      }]],
    ]);
    expect(result.demotions).toEqual([
      { child: parseChildId(2), step: 'build' },
      { child: parseChildId(2), step: 'test_suite' },
      { child: parseChildId(2), step: 'build_review' },
      { child: parseChildId(3), step: 'acceptance_specs' },
      { child: parseChildId(3), step: 'build' },
      { child: parseChildId(3), step: 'test_suite' },
      { child: parseChildId(3), step: 'build_review' },
      { step: 'manual_test' }, { step: 'prd_audit' }, { step: 'architecture_review_as_built' }, { step: 'rebase' }, { step: 'finish' },
    ]);
    await expect(Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf-8')] as const))).resolves.toEqual(before);
  });

  it('refuses a target at or after the target child current step without changing the pipeline tree', async () => {
    const childPath = paths[1]!;
    const childState = JSON.parse(await readFile(childPath, 'utf-8')) as ConductState;
    await writeFile(childPath, `${JSON.stringify({ ...childState, last_step: 'build' }, null, 2)}\n`, 'utf-8');
    const before = await pipelineFileBytes(root);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storeFor = vi.fn(() => new RecordingStateStore());
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'test_suite', child: '2' }, root, {
        storeFor,
        preflightDerivedRecords: async () => {},
        clearDerivedRecords: async () => {},
        emit: async () => {},
      })).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith('rewind: target "test_suite" must be earlier than child 2\'s current step "build"');
      expect(storeFor).not.toHaveBeenCalled();
      await expect(pipelineFileBytes(root)).resolves.toEqual(before);
    } finally {
      error.mockRestore();
    }
  });
});

describe('rewind --child derived records, event, and rollback', () => {
  let root: string;

  async function writeFixture(): Promise<{ child2: string; child3: string; flat: string }> {
    const flat = pipelinePathFor(root, 'conduct-state.json');
    const child2 = pipelinePathFor(root, 'conduct-state.json', parseChildId(2)!);
    const child3 = pipelinePathFor(root, 'conduct-state.json', parseChildId(3)!);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await Promise.all([
      mkdir(join(root, '.pipeline', 'gates'), { recursive: true }),
      ...[1, 2, 3].map(async (child) => {
        const childRoot = join(root, '.pipeline', 'children', String(child));
        await mkdir(join(childRoot, 'gates'), { recursive: true });
        await writeFile(join(childRoot, 'conduct-state.json'), `${JSON.stringify({
          acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
        }, null, 2)}\n`, 'utf-8');
        await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
          writeFile(join(childRoot, 'gates', `${step}.json`), `${JSON.stringify({ child, step })}\n`, 'utf-8')));
      }),
      writeFile(flat, `${JSON.stringify({ ...completeState, coverage_binding: 'done', last_step: 'prd_audit' }, null, 2)}\n`, 'utf-8'),
      writeFile(join(root, '.pipeline', 'HALT'), 'operator action required\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human\n', 'utf-8'),
      ...['manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase', 'finish'].map((step) =>
        writeFile(join(root, '.pipeline', 'gates', `${step}.json`), `${JSON.stringify({ step })}\n`, 'utf-8')),
      writeFile(join(root, '.pipeline', 'gates', 'coverage_binding.json'), '{"step":"coverage_binding"}\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'architecture-review-as-built.json'), '{"verdict":"pass"}\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'architecture-review-as-built.md'), '# report\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'prd-audit.json'), '{"verdict":"pass"}\n', 'utf-8'),
      writeFile(join(root, '.pipeline', 'prd-audit.md'), '# report\n', 'utf-8'),
    ]);
    return { child2, child3, flat };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rewind-child-derived-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('clears each demoted child and flat verdict, HALT pair, and emits one child-tagged event', async () => {
    await writeFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '2' }, root)).resolves.toBe(0);

      await expect(readFile(join(root, '.pipeline', 'children/1/gates/build.json'), 'utf-8')).resolves.toContain('"child":1');
      await expect(readFile(join(root, '.pipeline', 'children/2/gates/build.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/2/gates/test_suite.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/2/gates/build_review.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/3/gates/acceptance_specs.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/3/gates/build.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/3/gates/test_suite.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'children/3/gates/build_review.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'gates/manual_test.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'gates/prd_audit.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'gates/coverage_binding.json'), 'utf-8')).resolves.toBe('{"step":"coverage_binding"}\n');
      await expect(readFile(join(root, '.pipeline', 'architecture-review-as-built.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'architecture-review-as-built.md'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'prd-audit.json'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'prd-audit.md'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });

      const events = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf-8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'operator_rewind', target: 'build', child: 2,
        demoted: [
          'children/2/build', 'children/2/test_suite', 'children/2/build_review',
          'children/3/acceptance_specs', 'children/3/build', 'children/3/test_suite', 'children/3/build_review',
          'manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase', 'finish',
        ],
      }));
      expect(log).toHaveBeenCalledWith('Rewound child 2 to build.');
    } finally {
      log.mockRestore();
    }
  });

  it('rolls back an already-applied child batch when a later child port refuses before clearing records', async () => {
    const { child2, child3, flat } = await writeFixture();
    const before = await Promise.all([child2, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const));
    const child3Store: ConductStateStore<ConductState> = {
      async apply() { throw new Error('unexpected single mutation'); },
      async applyBatch() {
        const state = JSON.parse(await readFile(child3, 'utf-8')) as ConductState;
        await writeFile(child3, `${JSON.stringify({ ...state, build: 'failed' }, null, 2)}\n`, 'utf-8');
        return { kind: 'conflict', message: 'simulated child 3 refusal' };
      },
      async replace() { throw new Error('unexpected replacement'); },
    };
    const stores = new Map<string, ConductStateStore<ConductState>>();
    const storeFor = (path: string): ConductStateStore<ConductState> => {
      if (path === child3) return child3Store;
      let store = stores.get(path);
      if (!store) {
        store = createFilesystemConductStateStore(path);
        stores.set(path, store);
      }
      return store;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '2' }, root, { storeFor })).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith('rewind: Operator rewind refused build: expected done, current failed');
      await expect(Promise.all([child2, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const))).resolves.toEqual(before);
      await expect(readFile(join(root, '.pipeline', 'children/2/gates/build.json'), 'utf-8')).resolves.toContain('"child":2');
      await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf-8')).resolves.toBe('operator action required\n');
      await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe('needs-human\n');
    } finally {
      error.mockRestore();
    }
  });

  it('refuses an empty later-child state before applying any child or flat demotion', async () => {
    const { child3 } = await writeFixture();
    await rm(child3);
    const before = await pipelineFileBytes(root);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '2' }, root)).resolves.toBe(1);
      expect(error).toHaveBeenCalledWith(`rewind: Cannot rewind state without a prior last step for ${child3}`);
      await expect(pipelineFileBytes(root)).resolves.toEqual(before);
    } finally {
      error.mockRestore();
    }
  });

  it('rolls back every applied state file and restores staged records when clearing fails', async () => {
    const { child2, child3, flat } = await writeFixture();
    const before = await Promise.all([child2, child3, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '2' }, root, {
        markerFilesystem: {
          rename,
          remove: async (path, options) => {
            if (typeof path === 'string' && path.includes('/gates/') && path.endsWith('.rewind-clearing')) {
              throw new Error('staged verdict removal failed');
            }
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline', 'HALT'), body, 'utf-8'),
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        },
      })).resolves.toBe(1);

      await expect(Promise.all([child2, child3, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const))).resolves.toEqual(before);
      await expect(readFile(join(root, '.pipeline', 'children/2/gates/build.json'), 'utf-8')).resolves.toContain('"child":2');
      await expect(readFile(join(root, '.pipeline', 'children/3/gates/build.json'), 'utf-8')).resolves.toContain('"child":3');
      await expect(readFile(join(root, '.pipeline', 'gates/manual_test.json'), 'utf-8')).resolves.toContain('manual_test');
      await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf-8')).resolves.toBe('operator action required\n');
      await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf-8')).resolves.toBe('needs-human\n');
      expect(error).toHaveBeenCalledWith('rewind: staged verdict removal failed');
    } finally {
      error.mockRestore();
    }
  });

  it('continues rollback after one state store fails so the other applied stores are restored', async () => {
    const { child2, child3, flat } = await writeFixture();
    const before = await Promise.all([child2, child3, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const));
    const stores = new Map<string, ConductStateStore<ConductState>>();
    const storeFor = (path: string): ConductStateStore<ConductState> => {
      let store = stores.get(path);
      if (!store) {
        const filesystemStore = createFilesystemConductStateStore(path);
        store = path === child3
          ? {
              ...filesystemStore,
              async applyBatch(batch) {
                if (batch.name === 'rollback failed operator rewind state') {
                  return { kind: 'persistence', message: 'forced child rollback failure' };
                }
                return filesystemStore.applyBatch(batch);
              },
            }
          : filesystemStore;
        stores.set(path, store);
      }
      return store;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build', child: '2' }, root, {
        storeFor,
        clearDerivedRecords: async () => { throw new Error('derived-record cleanup failed'); },
      })).resolves.toBe(1);

      await expect(Promise.all([child2, flat].map(async (path) => [path, await readFile(path, 'utf-8')] as const)))
        .resolves.toEqual([before[0], before[2]]);
      await expect(readFile(child3, 'utf-8')).resolves.not.toBe(before[1]![1]);
      expect(error).toHaveBeenCalledWith('rewind: rollback failed: Failed to restore 1 child rewind state store');
    } finally {
      error.mockRestore();
    }
  });
});
