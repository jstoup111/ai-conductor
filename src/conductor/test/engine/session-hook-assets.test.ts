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

  it('fails open on an unparseable payload even when the marker is present', () => {
    const result = runMutationGateHook({
      marker: true,
      payload: 'not valid json{{{',
    });
    expect(result.status).toBe(0);
  });
});
