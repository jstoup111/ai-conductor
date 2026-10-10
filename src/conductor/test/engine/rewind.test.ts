// Covers: task:1, task:2, task:3
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import type { ConductState, HarnessConfig } from '../../src/types/index.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import { clearHaltAtomically, detectRewindCommand, dispatchRewindCommand, inPlaceHaltRecoveryHint, rewindState } from '../../src/engine/rewind.js';

class RecordingStateStore implements ConductStateStore<ConductState> {
  readonly batches: NamedAtomicStateMutationBatch<ConductState>[] = [];

  async apply(_mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must submit its demotions as one atomic batch');
  }

  async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.batches.push(batch);
    return { kind: 'applied' };
  }

  async replace(_replacement: PrivilegedStateReplacement<ConductState>): Promise<StateMutationResult> {
    throw new Error('rewind must not replace conduct state');
  }
}

class RefusingStateStore extends RecordingStateStore {
  override async applyBatch(_batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    return { kind: 'conflict', message: 'Expected test_suite to match before operator rewind to build' };
  }
}

class ApplyingStateStore extends RecordingStateStore {
  readonly corrections: PrivilegedStateCorrection<ConductState>[] = [];

  constructor(readonly state: ConductState) {
    super();
  }

  override async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.batches.push(batch);
    const mutable = this.state as Record<string, unknown>;
    for (const mutation of batch.mutations) {
      if (mutable[mutation.field] !== mutation.expected) {
        return { kind: 'conflict', message: `${String(mutation.field)} changed` };
      }
    }
    for (const mutation of batch.mutations) {
      mutable[mutation.field] = mutation.next;
    }
    return { kind: 'applied' };
  }

  async applyCorrection(correction: PrivilegedStateCorrection<ConductState>): Promise<StateMutationResult> {
    this.corrections.push(correction);
    const mutable = this.state as Record<string, unknown>;
    for (const deletion of correction.deletions) {
      if (mutable[deletion.field] !== deletion.expected) {
        return { kind: 'conflict', message: `${String(deletion.field)} changed` };
      }
    }
    for (const mutation of correction.mutations) {
      if (mutable[mutation.field] !== mutation.expected) {
        return { kind: 'conflict', message: `${String(mutation.field)} changed` };
      }
    }
    for (const deletion of correction.deletions) delete mutable[deletion.field];
    for (const mutation of correction.mutations) mutable[mutation.field] = mutation.next;
    return { kind: 'applied' };
  }
}

describe('rewindState', () => {
  const completeState: ConductState = {
    worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
    architecture_diagram: 'done', architecture_review: 'done', stories: 'done',
    conflict_check: 'done', plan: 'done', coherence_check: 'done', acceptance_specs: 'done',
    build: 'done', test_suite: 'done', build_review: 'done',
    manual_test: 'done', prd_audit: 'done', architecture_review_as_built: 'done',
    rebase: 'done', finish: 'done', last_step: 'finish',
  };

  it('keeps the rewind command boundary reachable only from the CLI entry module', () => {
    const sourceRoot = resolve(import.meta.dirname, '../../src');
    const rewindModule = resolve(sourceRoot, 'engine/rewind.ts');
    const configPath = resolve(import.meta.dirname, '../../tsconfig.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, resolve(import.meta.dirname, '../..'));
    const program = ts.createProgram(config.fileNames, config.options);
    const checker = program.getTypeChecker();

    const importers = program.getSourceFiles().flatMap((sourceFile) => sourceFile.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
      const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
      const declaration = symbol?.declarations?.find(ts.isSourceFile);
      return declaration?.fileName === rewindModule ? [sourceFile.fileName] : [];
    }));

    expect(importers).toEqual([resolve(sourceRoot, 'index.ts')]);
  });

  it('refuses an unknown target by name and lists the resolved registry without mutating', async () => {
    const store = new RecordingStateStore();
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };

    await expect(rewindState({ state: completeState, config, target: 'not-a-step', store, readCurrentState: async () => completeState }))
      .rejects.toThrow(/not-a-step.*Valid steps:.*lint/s);
    expect(store.batches).toEqual([]);
  });

  it('refuses a target at or after the current position without mutating', async () => {
    const store = new RecordingStateStore();

    await expect(rewindState({ state: completeState, config: {}, target: 'finish', store, readCurrentState: async () => completeState }))
      .rejects.toThrow(/earlier than current step "finish"/);
    expect(store.batches).toEqual([]);
  });

  it('accepts a config-declared custom target and demotes it plus non-skipped downstream steps to stale', async () => {
    const store = new RecordingStateStore();
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };
    const state = { ...completeState, lint: 'done', last_step: 'finish' } as ConductState;

    const result = await rewindState({ state, config, target: 'lint', store, readCurrentState: async () => state });

    expect(result).toEqual({ target: 'lint', demoted: ['lint', 'test_suite', 'build_review', 'manual_test', 'prd_audit', 'architecture_review_as_built', 'rebase', 'finish'] });
    expect(store.batches).toEqual([{
      name: 'operator rewind state',
      mutations: [
        { field: 'lint', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'test_suite', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'build_review', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'manual_test', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'prd_audit', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'architecture_review_as_built', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'rebase', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'finish', expected: 'done', intent: 'operator rewind to lint', next: 'stale' },
        { field: 'last_step', expected: 'finish', intent: 'operator rewind to lint', next: 'build' },
      ],
    }]);
  });

  it('reports the field, expected value, and current value when the port refuses a demotion', async () => {
    const store = new RefusingStateStore();
    const current: ConductState = { ...completeState, test_suite: 'failed' };

    await expect(rewindState({ state: completeState, config: {}, target: 'build', store, readCurrentState: async () => current }))
      .rejects.toThrow('test_suite: expected done, current failed');
  });

  it('names halt clear for an in-place halted step', () => {
    expect(inPlaceHaltRecoveryHint({ last_step: 'build', build: 'refused' }, 'build', 'plan-gap-feature')).toBe(
      'rewind: "build" is the halted step itself (status refused); after resolving the cause, resume it in place with: ai-conductor halt clear --feature plan-gap-feature --rationale "<what you fixed>"',
    );
  });

  it('returns no in-place hint for a done status or non-current target', () => {
    expect(inPlaceHaltRecoveryHint({ last_step: 'build', build: 'done' }, 'build', 'plan-gap-feature')).toBeUndefined();
    expect(inPlaceHaltRecoveryHint({ last_step: 'build', build: 'refused' }, 'test_suite', 'plan-gap-feature')).toBeUndefined();
  });

  describe('dispatchRewindCommand', () => {
  it('uses resolved config so a declared custom target is accepted at the command boundary', async () => {
    const config: HarnessConfig = {
      steps: { lint: { after: 'build', skill: 'lint', enforcement: 'gating' } },
    };
    const state = { ...completeState, lint: 'done', last_step: 'finish' } as ConductState;
    const store = new ApplyingStateStore(state);
    const emit = vi.fn(async () => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'lint' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => {},
      emit,
    })).resolves.toBe(0);

    expect((state as Record<string, unknown>).lint).toBe('stale');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ target: 'lint' }));
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Rewound to lint.');
    error.mockRestore();
    log.mockRestore();
  });

  it('rewinds from build_review to the earlier build step', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-earlier-step-'));
    const state: ConductState = { ...completeState, last_step: 'build_review' };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(state));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        emit: async () => {},
      })).resolves.toBe(0);

      expect(JSON.parse(await readFile(join(root, '.pipeline/conduct-state.json'), 'utf-8'))).toMatchObject({
        build: 'stale',
        build_review: 'stale',
        last_step: 'acceptance_specs',
      });
      await expect(readFile(join(root, '.pipeline/HALT'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root, '.pipeline/HALT.class'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses the current build step without changing halted state bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-current-step-'));
    const statePath = join(root, '.pipeline/conduct-state.json');
    const haltPath = join(root, '.pipeline/HALT');
    const haltClassPath = join(root, '.pipeline/HALT.class');
    const state: ConductState = { ...completeState, last_step: 'build' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      await writeFile(haltPath, 'operator action required\n');
      await writeFile(haltClassPath, 'needs-human\n');
      const before = await Promise.all([statePath, haltPath, haltClassPath].map((path) => readFile(path, 'utf-8')));

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(1);

      expect(error).toHaveBeenCalledWith('rewind: Rewind target "build" must be earlier than current step "build"');
      await expect(Promise.all([statePath, haltPath, haltClassPath].map((path) => readFile(path, 'utf-8')))).resolves.toEqual(before);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  async function expectInPlaceHaltClearHint(status: 'refused' | 'failed'): Promise<void> {
    const parent = await mkdtemp(join(tmpdir(), 'rewind-plan-gap-parent-'));
    const worktree = join(parent, 'plan-gap-feature');
    const statePath = join(worktree, '.pipeline/conduct-state.json');
    const haltPath = join(worktree, '.pipeline/HALT');
    const haltClassPath = join(worktree, '.pipeline/HALT.class');
    const state: ConductState = { ...completeState, last_step: 'build', build: status };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      await writeFile(haltPath, 'Plan gap: task 11, Done when check 2 cannot be satisfied under the approved plan.\n');
      await writeFile(haltClassPath, 'plan-gap\n');
      const before = await Promise.all([statePath, haltPath, haltClassPath].map((path) => readFile(path, 'utf-8')));

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, worktree)).resolves.toBe(1);

      expect(error.mock.calls).toEqual([
        ['rewind: Rewind target "build" must be earlier than current step "build"'],
        [expect.stringContaining('ai-conductor halt clear --feature plan-gap-feature --rationale')],
      ]);
      await expect(Promise.all([statePath, haltPath, haltClassPath].map((path) => readFile(path, 'utf-8')))).resolves.toEqual(before);
    } finally {
      error.mockRestore();
      await rm(parent, { recursive: true, force: true });
    }
  }

  it('names halt clear when the current halted build step is refused', async () => {
    await expectInPlaceHaltClearHint('refused');
  });

  it('names halt clear when the current halted build step is failed', async () => {
    await expectInPlaceHaltClearHint('failed');
  });

  async function expectNoInPlaceHaltClearHint({
    state,
    target,
    markers,
    refusal,
  }: {
    state: ConductState;
    target: string;
    markers: boolean;
    refusal?: string;
  }): Promise<void> {
    const parent = await mkdtemp(join(tmpdir(), 'rewind-plan-gap-parent-'));
    const worktree = join(parent, 'plan-gap-feature');
    const statePath = join(worktree, '.pipeline/conduct-state.json');
    const haltPath = join(worktree, '.pipeline/HALT');
    const haltClassPath = join(worktree, '.pipeline/HALT.class');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      if (markers) {
        await writeFile(haltPath, 'operator action required\n');
        await writeFile(haltClassPath, 'needs-human\n');
      }
      const paths = markers ? [statePath, haltPath, haltClassPath] : [statePath];
      const before = await Promise.all(paths.map((path) => readFile(path, 'utf-8')));

      await expect(dispatchRewindCommand({ kind: 'rewind', target }, worktree)).resolves.toBe(1);

      if (refusal) expect(error).toHaveBeenCalledWith(refusal);
      expect(error.mock.calls.some(([message]) => typeof message === 'string' && message.includes('halt clear'))).toBe(false);
      await expect(Promise.all(paths.map((path) => readFile(path, 'utf-8')))).resolves.toEqual(before);
    } finally {
      error.mockRestore();
      await rm(parent, { recursive: true, force: true });
    }
  }

  it('does not name halt clear when build is done at current target build', async () => {
    await expectNoInPlaceHaltClearHint({
      state: { ...completeState, last_step: 'build', build: 'done' },
      target: 'build',
      markers: true,
      refusal: 'rewind: Rewind target "build" must be earlier than current step "build"',
    });
  });

  it('does not name halt clear when refused build targets test_suite', async () => {
    await expectNoInPlaceHaltClearHint({
      state: { ...completeState, last_step: 'build', build: 'refused' },
      target: 'test_suite',
      markers: true,
      refusal: 'rewind: Rewind target "test_suite" must be earlier than current step "build"',
    });
  });

  it('does not name halt clear when refused build lacks HALT and HALT.class', async () => {
    await expectNoInPlaceHaltClearHint({
      state: { ...completeState, last_step: 'build', build: 'refused' },
      target: 'build',
      markers: false,
    });
  });

  it('restores state through the mutation port when derived-record cleanup fails, leaving retry valid', async () => {
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const store = new ApplyingStateStore(state);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => { throw new Error('cannot clear HALT'); },
    })).resolves.toBe(1);

    expect(state).toEqual(original);
    expect(store.batches.map((batch) => batch.name)).toEqual([
      'operator rewind state',
      'rollback failed operator rewind state',
    ]);
    expect(store.corrections).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('rewind: cannot clear HALT');
    error.mockRestore();
  });

  it('restores absent step fields when derived-record cleanup fails', async () => {
    const state = { ...completeState } as Record<string, unknown> as ConductState;
    delete (state as Record<string, unknown>).test_suite;
    delete (state as Record<string, unknown>).build_review;
    const original = { ...state };
    const store = new ApplyingStateStore(state);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => { throw new Error('cannot clear HALT'); },
    })).resolves.toBe(1);

    expect(state).toEqual(original);
    error.mockRestore();
  });

  it('reports absent fields that cannot be restored without a corrective store operation', async () => {
    const state = { ...completeState } as Record<string, unknown> as ConductState;
    delete (state as Record<string, unknown>).test_suite;
    delete (state as Record<string, unknown>).build_review;
    const store = new ApplyingStateStore(state);
    const withoutCorrection: ConductStateStore<ConductState> = {
      apply: store.apply.bind(store),
      applyBatch: store.applyBatch.bind(store),
      replace: store.replace.bind(store),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, '/fixture', {
      loadConfig: async () => ({ ok: true, config: {}, warnings: [] }),
      readState: async () => ({ ok: true, value: state }),
      store: withoutCorrection,
      preflightDerivedRecords: async () => {},
      clearDerivedRecords: async () => { throw new Error('cannot clear HALT'); },
    })).resolves.toBe(1);

    expect(error.mock.calls).toEqual([
      ['rewind: cannot clear HALT'],
      [expect.stringMatching(/^rewind: rollback failed: .*test_suite.*build_review/s)],
    ]);
    error.mockRestore();
  });

  it('restores both HALT markers and state when only the second staged-marker deletion fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-marker-rollback-'));
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(state));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
      let removeCount = 0;

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        clearDerivedRecords: async (cwd) => clearHaltAtomically(cwd, {
          rename,
          remove: async (path, options) => {
            removeCount += 1;
            if (removeCount === 2) throw new Error('second staged marker cannot be removed');
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        }),
      })).resolves.toBe(1);

      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('operator action required\n');
      expect(await readFile(join(root, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human\n');
      expect(JSON.parse(await readFile(join(root, '.pipeline/conduct-state.json'), 'utf-8'))).toEqual(original);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  const rewindDemotedSteps = [
    'build', 'test_suite', 'build_review', 'manual_test',
    'prd_audit', 'architecture_review_as_built', 'rebase', 'finish',
  ];

  async function writeRewindFixture(root: string, absentVerdict?: string): Promise<Map<string, string>> {
    await mkdir(join(root, '.pipeline/gates'), { recursive: true });
    await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(completeState));
    await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
    await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
    const verdicts = new Map<string, string>();
    for (const step of rewindDemotedSteps) {
      if (step === absentVerdict) continue;
      const contents = `{ "step": "${step}" }\n`;
      verdicts.set(step, contents);
      await writeFile(join(root, '.pipeline/gates', `${step}.json`), contents);
    }
    return verdicts;
  }

  it('restores every staged verdict with its original bytes when halt clearing fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-verdict-rollback-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const verdicts = await writeRewindFixture(root, 'test_suite');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        markerFilesystem: {
          rename,
          remove: async () => { throw new Error('halt removal failed'); },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        },
      })).resolves.toBe(1);

      await expect(Promise.all([...verdicts].map(async ([step, contents]) =>
        readFile(join(root, '.pipeline/gates', `${step}.json`), 'utf-8').then((actual) => [actual, contents]),
      ))).resolves.toEqual([...verdicts].map(([, contents]) => [contents, contents]));
      expect((await readdir(join(root, '.pipeline/gates'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('operator action required\n');
      expect(await readFile(join(root, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human\n');
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('rewind: halt removal failed');
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes demoted verdicts after a successful rewind without leaving staged entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-verdict-success-'));
    try {
      await writeRewindFixture(root);

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);

      expect(await readdir(join(root, '.pipeline/gates'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores verdict bytes when staged verdict deletion partially fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-verdict-delete-rollback-'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const verdicts = await writeRewindFixture(root);
      let verdictRemovals = 0;

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        markerFilesystem: {
          rename,
          remove: async (path, options) => {
            if (typeof path === 'string' && path.startsWith(join(root, '.pipeline/gates')) && path.includes('.rewind-clearing')) {
              verdictRemovals += 1;
              if (verdictRemovals === 2) throw new Error('staged verdict removal failed');
            }
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: (cwd, body) => writeFile(join(cwd, '.pipeline/HALT'), body, 'utf-8'),
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        },
      })).resolves.toBe(1);

      await expect(Promise.all([...verdicts].map(async ([step, contents]) =>
        readFile(join(root, '.pipeline/gates', `${step}.json`), 'utf-8').then((actual) => [actual, contents]),
      ))).resolves.toEqual([...verdicts].map(([, contents]) => [contents, contents]));
      expect((await readdir(join(root, '.pipeline/gates'))).some((entry) => entry.includes('.rewind-clearing'))).toBe(false);
      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('operator action required\n');
      expect(await readFile(join(root, '.pipeline/HALT.class'), 'utf-8')).toBe('needs-human\n');
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows a demoted step without a verdict file during a successful rewind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-missing-verdict-'));
    try {
      await writeRewindFixture(root, 'test_suite');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed with a HALT marker when restoring a deleted marker also fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-marker-protective-failure-'));
    const state: ConductState = { ...completeState };
    const original = { ...state };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(state));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');
      let removeCount = 0;

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root, {
        clearDerivedRecords: async (cwd) => clearHaltAtomically(cwd, {
          rename,
          remove: async (path, options) => {
            removeCount += 1;
            if (removeCount === 2) throw new Error('second staged marker cannot be removed');
            await rm(path, options);
          },
          readFile: (path) => readFile(path, 'utf-8'),
          restoreHalt: async () => { throw new Error('HALT restoration write failed'); },
          writeClass: (path, contents) => writeFile(path, contents, 'utf-8'),
        }),
      })).resolves.toBe(1);

      expect(await readFile(join(root, '.pipeline/HALT'), 'utf-8')).toBe('needs-human\n');
      expect(JSON.parse(await readFile(join(root, '.pipeline/conduct-state.json'), 'utf-8'))).toEqual(original);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('HALT restoration write failed'));
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes operator rewind audit evidence through the existing audit sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-audit-'));
    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(join(root, '.pipeline/conduct-state.json'), JSON.stringify(completeState));
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'build' }, root)).resolves.toBe(0);

      const records = (await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(records).toContainEqual(expect.objectContaining({
        origin: 'operator', event: 'operator_rewind', reason: 'rewound to build',
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a retired operator target by name without changing state bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rewind-retired-target-'));
    const statePath = join(root, '.pipeline/conduct-state.json');
    const original = `${JSON.stringify(completeState, null, 2)}\n`;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await mkdir(join(root, '.pipeline'), { recursive: true });
      await writeFile(statePath, original);
      await writeFile(join(root, '.pipeline/HALT'), 'operator action required\n');
      await writeFile(join(root, '.pipeline/HALT.class'), 'needs-human\n');

      await expect(dispatchRewindCommand({ kind: 'rewind', target: 'wiring_check' }, root))
        .resolves.toBe(1);

      expect(error).toHaveBeenCalledWith(expect.stringMatching(/wiring_check.*Valid steps:/s));
      expect(await readFile(statePath, 'utf-8')).toBe(original);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
  });
});

describe('detectRewindCommand', () => {
  it('parses the allowlisted --to and optional --child flag pairs', () => {
    expect(detectRewindCommand(['node', 'conduct', 'rewind', '--to', 'build']))
      .toEqual({ kind: 'rewind', target: 'build' });
    expect(detectRewindCommand(['node', 'conduct', 'rewind', '--to', 'build', '--child', '2']))
      .toEqual({ kind: 'rewind', target: 'build', child: '2' });
  });

  it.each([
    ['repeated --child', ['node', 'conduct', 'rewind', '--to', 'build', '--child', '2', '--child', '3']],
    ['missing --child value', ['node', 'conduct', 'rewind', '--to', 'build', '--child']],
    ['extra positional token', ['node', 'conduct', 'rewind', '--to', 'build', 'extra']],
    ['missing --to value', ['node', 'conduct', 'rewind', '--to']],
    ['flag in place of --to value', ['node', 'conduct', 'rewind', '--to', '--child', '2']],
    ['missing required --to', ['node', 'conduct', 'rewind', '--child', '2']],
  ])('falls through for %s', (_name, argv) => {
    expect(detectRewindCommand(argv)).toBeNull();
  });
});
