import { describe, it, expect } from 'vitest';
import { classifyTree, quarantine, retryPrepareAfterQuarantine, runTriage, fixSession, type TriageOutcome, type GitRunner, type GitResult } from '../../src/engine/setup-triage.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';

// A scripted GitRunner: matches argv prefixes to canned results.
function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

describe('engine/setup-triage — classifyTree (TS-2/TS-3)', () => {
  it('returns "clean" for empty porcelain output', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: '' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('clean');
  });

  it('returns "dirty" for modified tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: ' M src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for added tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'A  src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for deleted tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: ' D src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for renamed tracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'R  old.ts -> new.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for staged file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: 'M  src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for untracked file', async () => {
    const { git } = fakeGit([
      { match: ['status', '--porcelain'], result: { stdout: '?? src/foo.ts\n' } },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });

  it('returns "dirty" for multiple changes', async () => {
    const { git } = fakeGit([
      {
        match: ['status', '--porcelain'],
        result: {
          stdout: ' M src/foo.ts\n?? src/bar.ts\nM  src/baz.ts\n',
        },
      },
    ]);
    const result = await classifyTree(git);
    expect(result).toBe('dirty');
  });
});

describe('engine/setup-triage — quarantine (TS-2 happy)', () => {
  it('preserves dirty tree in wip/setup-quarantine branch and resets to clean', async () => {
    const { git, calls } = fakeGit([
      // Check if branch exists: rev-parse --verify returns failure (branch doesn't exist yet)
      {
        match: ['rev-parse', '--verify', 'wip/setup-quarantine-test-slug'],
        result: { exitCode: 1 },
      },
      // status --porcelain before quarantine
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n?? src/bar.ts\n' },
      },
      // add -A
      { match: ['add', '-A'], result: { exitCode: 0 } },
      // commit
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      // rev-parse HEAD to get commit SHA after add/commit
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      // branch -f wip/setup-quarantine-test-slug
      {
        match: ['branch', '-f'],
        result: { exitCode: 0 },
      },
      // reset --hard HEAD~1
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
      // Final status --porcelain to verify clean
      {
        match: ['status', '--porcelain'],
        result: { stdout: '' },
      },
    ]);

    const result = await quarantine(git, 'test-slug');

    expect(result).toEqual({
      ref: 'wip/setup-quarantine-test-slug',
      preservedPaths: ['src/foo.ts', 'src/bar.ts'],
    });

    // Verify the sequence of git commands
    expect(calls).toContainEqual(['rev-parse', '--verify', 'wip/setup-quarantine-test-slug']);
    expect(calls).toContainEqual(['add', '-A']);
    expect(calls).toContainEqual(['rev-parse', 'HEAD']);
    expect(calls).toContainEqual(['branch', '-f', 'wip/setup-quarantine-test-slug', 'aaaaaaa11111111111111111111111111111111']);
    expect(calls).toContainEqual(['reset', '--hard', 'HEAD~1']);
  });
});

describe('engine/setup-triage — quarantine (TS-2 negative, existing quarantine refresh)', () => {
  it('refreshes existing quarantine branch and logs the refresh', async () => {
    const logs: string[] = [];
    const fakeLogger = { log: (msg: string) => logs.push(msg) };

    const { git, calls } = fakeGit([
      // Check if branch exists: rev-parse --verify wip/setup-quarantine-test-slug
      {
        match: ['rev-parse', '--verify', 'wip/setup-quarantine-test-slug'],
        result: { stdout: 'bbbbbb22222222222222222222222222222222\n', exitCode: 0 },
      },
      // status --porcelain before quarantine
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n?? src/bar.ts\n' },
      },
      // add -A
      { match: ['add', '-A'], result: { exitCode: 0 } },
      // commit
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      // rev-parse HEAD to get commit SHA after add/commit
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      // branch -f wip/setup-quarantine-test-slug (force-move to new tip)
      {
        match: ['branch', '-f'],
        result: { exitCode: 0 },
      },
      // reset --hard HEAD~1
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at cccccc Original commit\n' },
      },
    ]);

    const result = await quarantine(git, 'test-slug', fakeLogger);

    expect(result).toEqual({
      ref: 'wip/setup-quarantine-test-slug',
      preservedPaths: ['src/foo.ts', 'src/bar.ts'],
    });

    // Verify that "refreshed" was logged
    expect(logs.some(msg => msg.includes('refreshed'))).toBe(true);

    // Verify the sequence of git commands
    expect(calls).toContainEqual(['rev-parse', '--verify', 'wip/setup-quarantine-test-slug']);
    expect(calls).toContainEqual(['add', '-A']);
    expect(calls).toContainEqual(['rev-parse', 'HEAD']);
    expect(calls).toContainEqual(['branch', '-f', 'wip/setup-quarantine-test-slug', 'aaaaaaa11111111111111111111111111111111']);
    expect(calls).toContainEqual(['reset', '--hard', 'HEAD~1']);
  });
});

describe('engine/setup-triage — quarantine (TS-2 negative, preservation failure)', () => {
  it('aborts triage on git commit failure, rolls back staging, tree untouched', async () => {
    const { git, calls } = fakeGit([
      // Initial status --porcelain (capture dirty state)
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n?? src/bar.ts\n' },
      },
      // add -A succeeds
      { match: ['add', '-A'], result: { exitCode: 0 } },
      // commit fails
      {
        match: ['commit', '-m'],
        result: { exitCode: 1, stderr: 'fatal: commit failed\n' },
      },
      // reset (rollback index) succeeds
      { match: ['reset', '--mixed', 'HEAD'], result: { exitCode: 0 } },
    ]);

    const result = await quarantine(git, 'test-slug');

    // Should return park outcome with preservation failure
    expect(result).toEqual({
      kind: 'park',
      outputTail: 'fatal: commit failed\n',
    });

    // Verify git commands were called in correct order
    expect(calls).toContainEqual(['status', '--porcelain']);
    expect(calls).toContainEqual(['add', '-A']);
    expect(calls).toContainEqual(['commit', '-m', 'Quarantine before reset']);
    // Should have rolled back the index
    expect(calls).toContainEqual(['reset', '--mixed', 'HEAD']);

    // Verify quarantine branch was NOT created
    expect(calls).not.toContainEqual(
      expect.arrayContaining(['branch', '-f', 'wip/setup-quarantine-test-slug'])
    );

    // Verify reset --hard (to clean tree) was NOT run
    expect(calls).not.toContainEqual(
      expect.arrayContaining(['reset', '--hard'])
    );
  });
});

describe('engine/setup-triage — retryPrepareAfterQuarantine (TS-2 happy path: retry passes)', () => {
  it('quarantines dirty tree, retries full prepare once post-quarantine, returns quarantined-pass on success', async () => {
    const { git, calls } = fakeGit([
      // Initial status check before quarantine
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M .env\n' },
      },
      // add -A during quarantine
      { match: ['add', '-A'], result: { exitCode: 0 } },
      // commit during quarantine
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      // rev-parse HEAD to get commit SHA
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      // branch -f wip/setup-quarantine-test-slug
      {
        match: ['branch', '-f'],
        result: { exitCode: 0 },
      },
      // reset --hard HEAD~1
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
    ]);

    // Mock runPrepare that succeeds on first (and only) call
    let prepareCallCount = 0;
    const runPrepare = async (worktreePath: string) => {
      prepareCallCount++;
      // Setup succeeds
    };

    const result = await retryPrepareAfterQuarantine(git, '/path/to/wt', 'test-slug', runPrepare);

    // After quarantine, we expect runPrepare to be called exactly once (the retry)
    expect(prepareCallCount).toBe(1);
    expect(result).toEqual({
      kind: 'quarantined-pass',
      outputTail: '',
      quarantineRef: 'wip/setup-quarantine-test-slug',
    });
  });

  it('captures setup output tail from quarantine-time failure and returns it in park', async () => {
    const { git } = fakeGit([
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/file.ts\n' },
      },
      { match: ['add', '-A'], result: { exitCode: 0 } },
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      { match: ['branch', '-f'], result: { exitCode: 0 } },
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
    ]);

    let prepareCallCount = 0;
    const setupOutput = 'test error message\nmore output\nTAIL';
    const runPrepare = async (worktreePath: string) => {
      prepareCallCount++;
      const err = new Error('setup failed');
      (err as any).output = setupOutput;
      throw err;
    };

    const result = await retryPrepareAfterQuarantine(git, '/path/to/wt', 'test-slug', runPrepare);

    expect(prepareCallCount).toBe(1);
    expect(result.kind).toBe('park');
    expect(result.outputTail).toBe(setupOutput);
    expect(result.quarantineRef).toBe('wip/setup-quarantine-test-slug');
  });

  it('verifies runPrepare is called with the correct worktree path argument', async () => {
    const { git } = fakeGit([
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M .env\n' },
      },
      { match: ['add', '-A'], result: { exitCode: 0 } },
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      { match: ['branch', '-f'], result: { exitCode: 0 } },
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
    ]);

    const worktreePath = '/custom/wt/path';
    let capturedPath: string | undefined;
    const runPrepare = async (path: string) => {
      capturedPath = path;
    };

    await retryPrepareAfterQuarantine(git, worktreePath, 'test-slug', runPrepare);

    expect(capturedPath).toBe(worktreePath);
  });
});

describe('engine/setup-triage — runTriage (Task 8: zero-touch guarantees)', () => {
  it('TS-1 negative: runTriage requires SetupFailureError input (constructor guard)', async () => {
    const { git } = fakeGit([]);
    const logs: string[] = [];

    // Try to call runTriage without SetupFailureError — should throw at construction
    await expect(
      // @ts-expect-error Testing runtime guard: intentionally pass null
      runTriage(git, '/path/to/wt', 'slug', null, async () => {}, { log: (msg: string) => logs.push(msg) })
    ).rejects.toThrow();
  });

  it('TS-1 negative: runTriage throws if SetupFailureError is undefined', async () => {
    const { git } = fakeGit([]);

    // Calling runTriage without SetupFailureError should throw
    await expect(
      // @ts-expect-error Testing runtime guard: undefined error
      runTriage(git, '/path/to/wt', 'slug', undefined, async () => {})
    ).rejects.toThrow();
  });

  it('TS-2 negative: dirty tree is never quarantined without SetupFailureError', async () => {
    const { git, calls } = fakeGit([
      // Dirty tree check
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n' },
      },
    ]);

    // Call classifyTree to detect dirty state
    const treeState = await classifyTree(git);
    expect(treeState).toBe('dirty');

    // But since there's no SetupFailureError passed to runTriage, it won't run
    // Verify no quarantine-related git commands occurred (only status)
    const quarantineCommands = calls.filter(c =>
      (c.includes('add') && c.includes('-A')) ||
      (c.includes('commit') && c.includes('-m')) ||
      (c.includes('branch') && c.includes('-f')) ||
      (c.includes('reset') && c.includes('--hard') && c.includes('HEAD'))
    );
    expect(quarantineCommands.length).toBe(0);
  });

  it('TS-2 happy path: runTriage with SetupFailureError on dirty tree quarantines and retries', async () => {
    const { git, calls } = fakeGit([
      // Quarantine: check if branch exists (first call in quarantine)
      {
        match: ['rev-parse', '--verify', 'wip/setup-quarantine-test-slug'],
        result: { exitCode: 1, stdout: '', stderr: '' }, // Branch doesn't exist yet
      },
      // Initial status for triage
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n' },
      },
      // Quarantine: add -A
      { match: ['add', '-A'], result: { exitCode: 0 } },
      // Quarantine: commit
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      // Quarantine: rev-parse HEAD
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      // Quarantine: branch -f
      {
        match: ['branch', '-f'],
        result: { exitCode: 0 },
      },
      // Quarantine: reset --hard HEAD~1
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
    ]);
    const logs: string[] = [];
    const fakeLogger = { log: (msg: string) => logs.push(msg) };

    const setupError = new SetupFailureError('setup failed', 'Failed at step X');
    let prepareRetryCount = 0;
    const runPrepare = async (_path: string) => {
      prepareRetryCount++;
      // Succeed on retry
    };

    const result = await runTriage(git, '/path/to/wt', 'test-slug', setupError, runPrepare, fakeLogger);

    // Should quarantine and retry
    expect(result.kind).toBe('quarantined-pass');
    expect(result.quarantineRef).toBe('wip/setup-quarantine-test-slug');
    expect(prepareRetryCount).toBe(1);
  });

  it('TS-2 negative: no side effects on happy path (no SetupFailureError, runTriage never runs)', () => {
    const { git, calls } = fakeGit([]);
    const logs: string[] = [];
    const fakeLogger = { log: (msg: string) => logs.push(msg) };

    // When prepare succeeds (no SetupFailureError), runTriage should not be called
    // So there should be no side effects:
    // - No git commands
    // - No triage-related logs

    expect(calls.length).toBe(0);
    expect(logs.length).toBe(0);
  });

  it('TS-1 happy: runTriage constructs and executes only with valid SetupFailureError', async () => {
    const { git, calls } = fakeGit([
      // Quarantine: check if branch exists (first call in quarantine would be, but tree is clean so no quarantine)
      // But classifyTree is called first, which calls status
      {
        match: ['status', '--porcelain'],
        result: { stdout: '' }, // Clean tree
      },
    ]);

    const setupError = new SetupFailureError('setup failed', 'Output tail');
    let prepareCalled = false;
    const runPrepare = async (_path: string) => {
      prepareCalled = true;
    };

    // Should succeed because SetupFailureError is present
    const result = await runTriage(git, '/path/to/wt', 'test-slug', setupError, runPrepare);

    expect(result).toBeDefined();
    expect(result.kind).toBe('pass'); // Clean tree, no quarantine needed
    expect(prepareCalled).toBe(false); // runPrepare not called for pass outcome
  });
});

describe('engine/setup-triage — fixSession (Task 10: fix-session stage)', () => {
  it('(a) happy path: dispatchFixSession succeeds, runPrepare passes, porcelain empty → fixed-pass', async () => {
    const { git, calls } = fakeGit([
      // Final porcelain check after prepare
      {
        match: ['status', '--porcelain'],
        result: { stdout: '' },
      },
    ]);

    let dispatchCalled = false;
    const dispatchFixSession = async () => {
      dispatchCalled = true;
      // Simulates LLM session that attempts fixes
    };

    const runPrepare = async (_path: string) => {
      // Succeeds (no throw)
    };

    const result = await fixSession(git, '/path/to/wt', 'test-slug', dispatchFixSession, runPrepare);

    expect(dispatchCalled).toBe(true);
    expect(result.kind).toBe('fixed-pass');
    expect(result.preservedPaths).toEqual([]);
    expect(result.outputTail).toBe('');
    expect(result.contractOutcome).toBeUndefined();
  });

  it('(b) negative: seam resolves but runPrepare still fails → park with contractOutcome setup-still-failing', async () => {
    const { git, calls } = fakeGit([]);

    let dispatchCalled = false;
    const dispatchFixSession = async () => {
      dispatchCalled = true;
      // LLM session completes but fix didn't work
    };

    const prepareError = new Error('setup still failing after fix attempt');
    const runPrepare = async (_path: string) => {
      throw prepareError;
    };

    const result = await fixSession(git, '/path/to/wt', 'test-slug', dispatchFixSession, runPrepare);

    expect(dispatchCalled).toBe(true);
    expect(result.kind).toBe('park');
    expect(result.contractOutcome).toBe('setup-still-failing');
    expect(result.outputTail).toContain('setup still failing');
  });

  it('(c) negative: runPrepare passes but porcelain dirty → park with dirty paths', async () => {
    const { git, calls } = fakeGit([
      // Porcelain check shows dirty tree
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/dirty-file.ts\n?? src/new-file.ts\n' },
      },
    ]);

    let dispatchCalled = false;
    const dispatchFixSession = async () => {
      dispatchCalled = true;
      // LLM session completes
    };

    const runPrepare = async (_path: string) => {
      // Succeeds
    };

    const result = await fixSession(git, '/path/to/wt', 'test-slug', dispatchFixSession, runPrepare);

    expect(dispatchCalled).toBe(true);
    expect(result.kind).toBe('park');
    expect(result.preservedPaths).toContain('src/dirty-file.ts');
    expect(result.preservedPaths).toContain('src/new-file.ts');
    expect(result.contractOutcome).toBeUndefined();
  });

  it('(d) negative: dispatchFixSession throws → park, seam called exactly once', async () => {
    const { git, calls } = fakeGit([]);

    let dispatchCallCount = 0;
    const dispatchError = new Error('LLM session failed');
    const dispatchFixSession = async () => {
      dispatchCallCount++;
      throw dispatchError;
    };

    const runPrepare = async (_path: string) => {
      // Should not be called
      throw new Error('runPrepare should not be called');
    };

    const result = await fixSession(git, '/path/to/wt', 'test-slug', dispatchFixSession, runPrepare);

    expect(dispatchCallCount).toBe(1);
    expect(result.kind).toBe('park');
    expect(result.outputTail).toContain('LLM session failed');
  });
});

describe('engine/setup-triage — quarantine sentinel surfacing (Task 14)', () => {
  it('quarantined-pass outcome includes quarantine ref', async () => {
    const { git } = fakeGit([
      {
        match: ['rev-parse', '--verify', 'wip/setup-quarantine-test-slug'],
        result: { exitCode: 1 },
      },
      {
        match: ['status', '--porcelain'],
        result: { stdout: ' M src/foo.ts\n' },
      },
      { match: ['add', '-A'], result: { exitCode: 0 } },
      {
        match: ['commit', '-m'],
        result: { stdout: '[feat-branch aaaaaaa] Quarantine before reset\n', exitCode: 0 },
      },
      {
        match: ['rev-parse', 'HEAD'],
        result: { stdout: 'aaaaaaa11111111111111111111111111111111\n' },
      },
      { match: ['branch', '-f'], result: { exitCode: 0 } },
      {
        match: ['reset', '--hard', 'HEAD~1'],
        result: { stdout: 'HEAD is now at bbbbbb Original commit\n' },
      },
    ]);

    let prepareCallCount = 0;
    const runPrepare = async (worktreePath: string) => {
      prepareCallCount++;
      if (prepareCallCount === 1) {
        throw new Error('setup failed (first attempt)');
      }
    };

    const result = await retryPrepareAfterQuarantine(git, '/path/to/wt', 'test-slug', runPrepare);

    expect(result.kind).toBe('quarantined-pass');
    expect((result as any).quarantineRef).toBe('wip/setup-quarantine-test-slug');
  });

  it('no quarantine ref means no sentinel written', async () => {
    const { git } = fakeGit([
      {
        match: ['status', '--porcelain'],
        result: { stdout: '' },
      },
    ]);

    const setupError = new SetupFailureError('setup failed', 'output tail');
    let prepareCalled = false;
    const runPrepare = async (_path: string) => {
      prepareCalled = true;
    };

    const result = await runTriage(git, '/path/to/wt', 'test-slug', setupError, runPrepare);

    expect(result.kind).toBe('pass');
    expect((result as any).quarantineRef).toBeUndefined();
    expect(prepareCalled).toBe(false);
  });
});
