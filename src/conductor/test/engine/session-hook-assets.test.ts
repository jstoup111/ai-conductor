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
  // Production wires two matcher entries sharing this script: the
  // Edit|Write|NotebookEdit entry passes argv "write", the Bash entry passes
  // "bash". Unit rows that omit `surface` exercise the payload-driven path
  // (SURFACE unset), which is where the tool_name switch lives.
  surface?: 'write' | 'bash';
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
    const argv = opts.surface ? [scriptPath, opts.surface] : [scriptPath];
    try {
      const stdout = execFileSync('bash', argv, {
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

// ─────────────────────────────────────────────────────────────────────────────
// #627: Bash-mediated writes and stamped Edits of engine-owned .pipeline state
// bypassed the gate. Two new guarantees:
//   1. A Bash command that WRITES an engine-owned path
//      (current-task / build-step-active / task-evidence / attribution-verdict)
//      is blocked exit-2, EVEN WHEN STAMPED — closes the heredoc/tee/python -c
//      escape around the Edit|Write block.
//   2. An Edit/Write/NotebookEdit targeting an engine-owned path is blocked
//      exit-2, EVEN WHEN STAMPED — the engine owns these files, not agents.
// Over-blocking guard: normal writes (source heredocs, scratchpad, reads,
// task-status.json which skills legitimately write) still pass.
// ─────────────────────────────────────────────────────────────────────────────
describe('MUTATION_GATE_HOOK — engine-owned .pipeline path protection (#627)', () => {
  const ENGINE_OWNED = [
    'current-task',
    'build-step-active',
    'task-evidence',
    'attribution-verdict',
  ];

  // ── Bash bypass attempts that MUST be blocked (regardless of stamp) ──
  const bashBypasses: Array<[string, string]> = [
    ['heredoc redirect', 'cat > .pipeline/current-task <<EOF\ntask-9\nEOF'],
    ['append redirect', 'echo task-9 >> .pipeline/current-task'],
    ['tee', 'echo task-9 | tee .pipeline/current-task'],
    ['python3 -c open-for-write', 'python3 -c "open(\'.pipeline/current-task\',\'w\').write(\'task-9\')"'],
    ['node -e writeFileSync', 'node -e "require(\'fs\').writeFileSync(\'.pipeline/current-task\',\'task-9\')"'],
    ['rm the gate marker', 'rm -f .pipeline/build-step-active'],
    ['sed -i on task-evidence', "sed -i 's/x/y/' .pipeline/task-evidence.json"],
    ['redirect to attribution-verdict', 'echo pass > .pipeline/attribution-verdict'],
    ['chained after cd', 'cd sub && echo task-9 > .pipeline/current-task'],
  ];

  it.each(bashBypasses)(
    'blocks a STAMPED Bash write to an engine-owned path: %s',
    (_name, command) => {
      const result = runMutationGateHook({
        marker: true,
        stamp: 'task-1',
        surface: 'bash',
        payload: { tool_name: 'Bash', tool_input: { command } },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/engine-owned/);
    },
  );

  it.each(bashBypasses)(
    'blocks an UNSTAMPED Bash write to an engine-owned path: %s',
    (_name, command) => {
      const result = runMutationGateHook({
        marker: true,
        surface: 'bash',
        payload: { tool_name: 'Bash', tool_input: { command } },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/engine-owned/);
    },
  );

  // ── Edit/Write/NotebookEdit to an engine-owned path — blocked even stamped ──
  it.each(ENGINE_OWNED)(
    'blocks a STAMPED Edit targeting .pipeline/%s',
    (name) => {
      const result = runMutationGateHook({
        marker: true,
        stamp: 'task-1',
        payload: { tool_name: 'Edit', tool_input: { file_path: `/repo/.pipeline/${name}` } },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/engine-owned/);
    },
  );

  it('blocks a STAMPED Edit on the write surface (argv "write") targeting current-task', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'write',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/repo/.pipeline/current-task' } },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/engine-owned/);
  });

  it('write surface still fails CLOSED with no stamp and no payload delivered', () => {
    const result = runMutationGateHook({
      marker: true,
      surface: 'write',
      payload: '', // host delivered no stdin
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/stamped Agent dispatch/);
  });

  // ── Legitimate writes that MUST pass (no over-blocking) ──
  it('passes a STAMPED source-file heredoc during a dispatch', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'bash',
      payload: { tool_name: 'Bash', tool_input: { command: 'cat > src/foo.ts <<EOF\nexport const x = 1;\nEOF' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes a STAMPED scratchpad write', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'bash',
      payload: { tool_name: 'Bash', tool_input: { command: 'echo hi > /tmp/scratch/notes.txt' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes a Bash READ of current-task (cat) — protection is against mutation, not reads', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'bash',
      payload: { tool_name: 'Bash', tool_input: { command: 'cat .pipeline/current-task' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes a STAMPED write to .pipeline/task-status.json (skills legitimately reset it)', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'bash',
      payload: { tool_name: 'Bash', tool_input: { command: 'echo "{}" > .pipeline/task-status.json' } },
    });
    expect(result.status).toBe(0);
  });

  it('passes a STAMPED Edit to .pipeline/task-status.json', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/repo/.pipeline/task-status.json' } },
    });
    expect(result.status).toBe(0);
  });

  it('does NOT block a commit message that merely mentions current-task (quoted mention)', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      surface: 'bash',
      payload: {
        tool_name: 'Bash',
        tool_input: { command: 'echo "refreshed .pipeline/current-task stamping logic"' },
      },
    });
    expect(result.status).toBe(0);
  });

  it('does NOT block a normal source Edit under a stamp', () => {
    const result = runMutationGateHook({
      marker: true,
      stamp: 'task-1',
      payload: { tool_name: 'Edit', tool_input: { file_path: '/repo/src/foo.ts' } },
    });
    expect(result.status).toBe(0);
  });
});
