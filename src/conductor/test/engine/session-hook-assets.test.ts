import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRE_DISPATCH_HOOK,
  POST_DISPATCH_HOOK,
  MUTATION_GATE_HOOK,
  DOCS_GUARD_HOOK,
} from '../../src/engine/session-hook-assets.js';

function assertValidBash(name: string, script: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'session-hook-assets-'));
  try {
    const file = join(dir, name);
    writeFileSync(file, script, 'utf-8');
    // Throws if bash -n reports a syntax error.
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type RunResult = { status: number; stderr: string; stdout: string };

function runMutationGateHook(opts: {
  marker?: boolean;
  stamp?: string;
  payload: unknown;
}): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-gate-hook-'));
  try {
    const scriptPath = join(dir, 'mutation-gate.sh');
    writeFileSync(scriptPath, MUTATION_GATE_HOOK, 'utf-8');
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    if (opts.marker) {
      writeFileSync(join(dir, '.pipeline', 'build-step-active'), 'ts\n', 'utf-8');
    }
    if (opts.stamp !== undefined) {
      writeFileSync(join(dir, '.pipeline', 'current-task'), opts.stamp, 'utf-8');
    }
    const payloadStr =
      typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload);
    try {
      const stdout = execFileSync('bash', [scriptPath], {
        cwd: dir,
        input: payloadStr,
        stdio: 'pipe',
      });
      return { status: 0, stderr: '', stdout: stdout.toString('utf-8') };
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
      return {
        status: e.status ?? -1,
        stderr: (e.stderr ?? Buffer.from('')).toString('utf-8'),
        stdout: (e.stdout ?? Buffer.from('')).toString('utf-8'),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('session-hook-assets', () => {
  const hooks: Array<[string, string]> = [
    ['PRE_DISPATCH_HOOK', PRE_DISPATCH_HOOK],
    ['POST_DISPATCH_HOOK', POST_DISPATCH_HOOK],
    ['MUTATION_GATE_HOOK', MUTATION_GATE_HOOK],
    ['DOCS_GUARD_HOOK', DOCS_GUARD_HOOK],
  ];

  it.each(hooks)('%s is a non-empty string', (_name, script) => {
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it.each(hooks)('%s starts with a bash shebang', (_name, script) => {
    expect(script.startsWith('#!/bin/bash')).toBe(true);
  });

  it.each(hooks)('%s passes bash -n syntax check', (name, script) => {
    expect(() => assertValidBash(name, script)).not.toThrow();
  });

  const staleEngineReferencePatterns = [/dist\//, /conduct-ts/, /require\(['"]\.\//];

  it.each(hooks)(
    '%s contains no stale dynamic-module references (dist/, conduct-ts, require(\'./)',
    (_name, script) => {
      for (const pattern of staleEngineReferencePatterns) {
        expect(script).not.toMatch(pattern);
      }
    },
  );
});

describe('MUTATION_GATE_HOOK', () => {
  it('blocks an unstamped Edit when the marker is present, with the redirect message', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
    expect(result.stderr).toMatch(/Task: <id>/);
  });

  it('blocks an unstamped Write when the marker is present, with the redirect message', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('blocks an unstamped NotebookEdit when the marker is present, with the redirect message', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/tmp/x.ipynb' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('passes through a stamped Edit when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through a stamped Write when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through a stamped NotebookEdit when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/tmp/x.ipynb' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped Edit when the marker is absent (enforcement inactive)', () => {
    const result = runMutationGateHook({
      marker: false,
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped Write when the marker is absent (enforcement inactive)', () => {
    const result = runMutationGateHook({
      marker: false,
      payload: { tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it('blocks an unstamped `git commit` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('passes through a stamped `git commit` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('blocks an unstamped `git commit --no-verify` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "wip"' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('blocks an unstamped chained `git commit` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'cd a && git commit -m "wip"' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('passes through a stamped `git commit --no-verify` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through a stamped chained `git commit` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '7',
      payload: { tool_name: 'Bash', tool_input: { command: 'cd a && git commit -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `git commit --no-verify` Bash invocation when the marker is absent', () => {
    const result = runMutationGateHook({
      marker: false,
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped chained `git commit` Bash invocation when the marker is absent', () => {
    const result = runMutationGateHook({
      marker: false,
      payload: { tool_name: 'Bash', tool_input: { command: 'cd a && git commit -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `git status` Bash invocation when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'git status' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `git commit` Bash invocation when the marker is absent', () => {
    const result = runMutationGateHook({
      marker: false,
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `grep \'git commit\' f` Bash invocation when the marker is present (mention, not invocation)', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: "grep 'git commit' f" } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `echo "git commit"` Bash invocation when the marker is present (mention, not invocation)', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'echo "git commit"' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `npx vitest run` Bash invocation when the marker is present (unrelated command)', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'npx vitest run' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped `conduct-ts task start 3` Bash invocation when the marker is present (unrelated command)', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Bash', tool_input: { command: 'conduct-ts task start 3' } },
    });
    expect(result.status).toBe(0);
  });

  it('fails open on an unparseable payload even when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: 'not valid json{{{',
    });
    expect(result.status).toBe(0);
  });

  it('fails open on a truncated JSON payload even when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: '{"tool_name": "Edit", "tool_input": {',
    });
    expect(result.status).toBe(0);
  });

  it('passes through an unstamped Edit when the marker is absent, regardless of stamp state', () => {
    const result = runMutationGateHook({
      marker: false,
      stamp: '',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes through a stamped Bash mutation when the marker is absent, regardless of stamp state', () => {
    const result = runMutationGateHook({
      marker: false,
      stamp: '7',
      payload: { tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' } },
    });
    expect(result.status).toBe(0);
  });

  it('treats an empty stamp file as absent and blocks an Edit when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('treats a whitespace-only stamp file as absent and blocks a Write when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: '   \n\t \n',
      payload: { tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  it('blocks an unstamped Edit under a "Task: none" dispatch (no stamp by design)', () => {
    // A "Task: none" dispatch (e.g. /simplify during pipeline) intentionally
    // writes no .pipeline/current-task stamp — mutations remain blocked,
    // same as any other unstamped context (ADR-2026-07-10).
    const result = runMutationGateHook({
      marker: true,
      payload: { tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/Task: <id>/);
    expect(result.stderr).toMatch(/Task: none/);
  });
});

function runDocsGuardHook(opts: {
  markerContent?: string;
  payload?: unknown;
}): RunResult {
  const dir = mkdtempSync(join(tmpdir(), 'docs-guard-hook-'));
  try {
    const scriptPath = join(dir, 'docs-guard.sh');
    writeFileSync(scriptPath, DOCS_GUARD_HOOK, 'utf-8');
    mkdirSync(join(dir, '.pipeline'), { recursive: true });
    if (opts.markerContent !== undefined) {
      writeFileSync(join(dir, '.pipeline', 'phase-active'), opts.markerContent, 'utf-8');
    }
    const payloadStr =
      opts.payload === undefined
        ? undefined
        : typeof opts.payload === 'string'
          ? opts.payload
          : JSON.stringify(opts.payload);
    try {
      const stdout = execFileSync('bash', [scriptPath], {
        cwd: dir,
        // Omitting `input` when there's no payload lets us prove the
        // marker-absent fast path never reads stdin: if the script blocked
        // reading, execFileSync would hang/timeout rather than return.
        input: payloadStr,
        timeout: 5000,
        stdio: 'pipe',
      });
      return { status: 0, stderr: '', stdout: stdout.toString('utf-8') };
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer; stdout?: Buffer };
      return {
        status: e.status ?? -1,
        stderr: (e.stderr ?? Buffer.from('')).toString('utf-8'),
        stdout: (e.stdout ?? Buffer.from('')).toString('utf-8'),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('DOCS_GUARD_HOOK', () => {
  it('exits 0 with no stdin read when the phase-active marker is absent', () => {
    // No `input` provided at all — if the script attempted to read stdin
    // before checking the marker, execFileSync would block until the
    // 5s timeout and this test would fail/hang rather than return quickly.
    const result = runDocsGuardHook({});
    expect(result.status).toBe(0);
  });

  it('passes through a non-.docs Edit target when the marker is present', () => {
    const result = runDocsGuardHook({
      markerContent: 'step: build\nphase: BUILD\nallow: .docs/plans/foo.md\n',
      payload: { tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts' } },
    });
    expect(result.status).toBe(0);
  });
});
