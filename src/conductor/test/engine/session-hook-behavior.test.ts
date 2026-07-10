import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PRE_DISPATCH_HOOK } from '../../src/engine/session-hook-assets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'session-hook-payloads');

interface PreDispatchToolInput {
  description: string;
  prompt: string;
}

interface PreDispatchPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt_id: string;
  permission_mode: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: PreDispatchToolInput;
  tool_use_id: string;
}

/**
 * Loads a real captured PreToolUse payload fixture from the 2026-07-10 #477
 * spike session and optionally overrides `tool_input.prompt` so scenario
 * tests can vary the prompt while staying anchored to the real payload shape.
 */
function loadPreDispatchPayload(
  fixtureName: string,
  overrides: { prompt?: string } = {},
): PreDispatchPayload {
  const raw = readFileSync(join(FIXTURES_DIR, fixtureName), 'utf-8');
  const payload = JSON.parse(raw) as PreDispatchPayload;
  if (overrides.prompt !== undefined) {
    payload.tool_input = { ...payload.tool_input, prompt: overrides.prompt };
  }
  return payload;
}

describe('session-hook-behavior fixtures', () => {
  const fixtures: Array<[string, string]> = [
    ['pre-dispatch-task-id.json', 'Task: 7 — reply with the single word done'],
    ['pre-dispatch-settings-local.json', 'Task: 9 — reply with the single word done'],
  ];

  it.each(fixtures)('%s loads with the verbatim spike payload shape', (fixtureName, prompt) => {
    const payload = loadPreDispatchPayload(fixtureName);

    expect(payload.hook_event_name).toBe('PreToolUse');
    expect(payload.tool_name).toBe('Agent');
    expect(payload.permission_mode).toBe('default');
    expect(payload.tool_input.description).toBe('Launch general-purpose subagent');
    expect(payload.tool_input.prompt).toBe(prompt);
    expect(typeof payload.session_id).toBe('string');
    expect(payload.session_id.length).toBeGreaterThan(0);
    expect(typeof payload.tool_use_id).toBe('string');
    expect(payload.tool_use_id.startsWith('toolu_')).toBe(true);
  });

  it('loader overrides tool_input.prompt without mutating other fields', () => {
    const base = loadPreDispatchPayload('pre-dispatch-task-id.json');
    const overridden = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: 'Task: 42 — reply with the single word done',
    });

    expect(overridden.tool_input.prompt).toBe('Task: 42 — reply with the single word done');
    expect(overridden.tool_input.description).toBe(base.tool_input.description);
    expect(overridden.session_id).toBe(base.session_id);
    expect(base.tool_input.prompt).toBe('Task: 7 — reply with the single word done');
  });

  it('loader throws for a nonexistent fixture', () => {
    expect(() => loadPreDispatchPayload('does-not-exist.json')).toThrow();
  });
});

describe('PRE_DISPATCH_HOOK behavior', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('script source contains explicit "Task: none" pass-through handling', () => {
    // Guards against a no-op skeleton silently satisfying the functional
    // assertions below for the wrong reason (i.e. because it does nothing
    // at all, not because it recognizes "Task: none").
    expect(PRE_DISPATCH_HOOK).toContain('Task: none');
  });

  it('passes through (exit 0, no state change) when line 1 is "Task: none"', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
    const pipelineDir = join(tempDir, '.pipeline');
    mkdirSync(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const seededStatus = JSON.stringify({
      tasks: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'in_progress' },
        { id: '7', status: 'pending' },
      ],
    });
    writeFileSync(statusPath, seededStatus, 'utf-8');

    const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
    writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

    const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: 'Task: none',
    });

    let exitCode = 0;
    try {
      execFileSync('bash', [hookPath], {
        input: JSON.stringify(payload),
        cwd: tempDir,
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number };
      exitCode = execErr.status ?? 1;
    }

    expect(exitCode).toBe(0);
    expect(readFileSync(statusPath, 'utf-8')).toBe(seededStatus);
    expect(existsSync(join(pipelineDir, 'current-task'))).toBe(false);
  });

  it('flips the row to in_progress and writes .pipeline/current-task when line 1 is "Task: <id>"', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
    const pipelineDir = join(tempDir, '.pipeline');
    mkdirSync(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const seededStatus = {
      tasks: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'in_progress' },
        { id: '7', status: 'pending' },
      ],
    };
    writeFileSync(statusPath, JSON.stringify(seededStatus), 'utf-8');

    const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
    writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

    const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: 'Task: 7',
    });

    let exitCode = 0;
    try {
      execFileSync('bash', [hookPath], {
        input: JSON.stringify(payload),
        cwd: tempDir,
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number };
      exitCode = execErr.status ?? 1;
    }

    expect(exitCode).toBe(0);

    const updated = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(updated.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
    expect(updated.tasks.find((t) => t.id === '1')?.status).toBe('completed');
    expect(updated.tasks.find((t) => t.id === '2')?.status).toBe('in_progress');

    expect(existsSync(join(pipelineDir, 'current-task'))).toBe(true);
    expect(readFileSync(join(pipelineDir, 'current-task'), 'utf-8')).toBe('7');

    // No leftover .tmp intermediate from the atomic write
    const leftoverTmp = readdirSync(pipelineDir).filter((f: string) => f.endsWith('.tmp'));
    expect(leftoverTmp).toEqual([]);
  });

  it('ignores Task: tokens in the prompt body — only line 1 is authoritative', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
    const pipelineDir = join(tempDir, '.pipeline');
    mkdirSync(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const seededStatus = {
      tasks: [
        { id: '1', status: 'pending' },
        { id: '2', status: 'pending' },
        { id: '7', status: 'pending' },
        { id: '8', status: 'pending' },
        { id: '42', status: 'pending' },
      ],
    };
    writeFileSync(statusPath, JSON.stringify(seededStatus), 'utf-8');

    const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
    writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

    const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: [
        'Task: 7',
        '',
        'include trailer `Task: 42`',
        'Task: 8',
      ].join('\n'),
    });

    let exitCode = 0;
    try {
      execFileSync('bash', [hookPath], {
        input: JSON.stringify(payload),
        cwd: tempDir,
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number };
      exitCode = execErr.status ?? 1;
    }

    expect(exitCode).toBe(0);

    const updated = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(updated.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
    expect(updated.tasks.find((t) => t.id === '8')?.status).toBe('pending');
    expect(updated.tasks.find((t) => t.id === '42')?.status).toBe('pending');
    expect(updated.tasks.find((t) => t.id === '1')?.status).toBe('pending');
    expect(updated.tasks.find((t) => t.id === '2')?.status).toBe('pending');

    expect(existsSync(join(pipelineDir, 'current-task'))).toBe(true);
    expect(readFileSync(join(pipelineDir, 'current-task'), 'utf-8')).toBe('7');
  });

  it('exits 2 and leaves state untouched when the task id is unknown', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
    const pipelineDir = join(tempDir, '.pipeline');
    mkdirSync(pipelineDir, { recursive: true });

    const statusPath = join(pipelineDir, 'task-status.json');
    const seededStatus = JSON.stringify({
      tasks: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'in_progress' },
        { id: '7', status: 'pending' },
      ],
    });
    writeFileSync(statusPath, seededStatus, 'utf-8');

    const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
    writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

    const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
      prompt: 'Task: 99',
    });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('bash', [hookPath], {
        input: JSON.stringify(payload),
        cwd: tempDir,
        stdio: 'pipe',
      });
    } catch (err) {
      const execErr = err as { status?: number; stderr?: Buffer };
      exitCode = execErr.status ?? 1;
      stderr = execErr.stderr ? execErr.stderr.toString('utf-8') : '';
    }

    expect(exitCode).toBe(2);
    expect(stderr).toContain('99');
    expect(stderr).toContain('1');
    expect(stderr).toContain('2');
    expect(stderr).toContain('7');

    expect(readFileSync(statusPath, 'utf-8')).toBe(seededStatus);
    expect(existsSync(join(pipelineDir, 'current-task'))).toBe(false);
  });

  describe('malformed line-1 marker grammar', () => {
    const seededStatus = {
      tasks: [
        { id: '1', status: 'pending' },
        { id: '7', status: 'pending' },
        { id: '8', status: 'pending' },
      ],
    };

    const scenarios: Array<[string, string]> = [
      [
        'line 1 lacking any marker (body may contain Task: tokens)',
        ['reply with the single word done', '', 'Task: 7'].join('\n'),
      ],
      ['line 1 "Task:7" (no space)', 'Task:7'],
      ['line 1 "task: 7" (lowercase)', 'task: 7'],
      ['line 1 "Task: 7 and Task: 8" (multiple markers)', 'Task: 7 and Task: 8'],
    ];

    it.each(scenarios)('blocks with exit 2 and an instructive stderr message: %s', (_label, prompt) => {
      tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
      const pipelineDir = join(tempDir, '.pipeline');
      mkdirSync(pipelineDir, { recursive: true });

      const statusPath = join(pipelineDir, 'task-status.json');
      const seededStatusJson = JSON.stringify(seededStatus);
      writeFileSync(statusPath, seededStatusJson, 'utf-8');

      const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
      writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

      const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', { prompt });

      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync('bash', [hookPath], {
          input: JSON.stringify(payload),
          cwd: tempDir,
          stdio: 'pipe',
        });
      } catch (err) {
        const execErr = err as { status?: number; stderr?: Buffer };
        exitCode = execErr.status ?? 1;
        stderr = execErr.stderr ? execErr.stderr.toString('utf-8') : '';
      }

      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/Task: <id>/);
      expect(stderr).toMatch(/Task: none/);

      // Zero state change
      expect(readFileSync(statusPath, 'utf-8')).toBe(seededStatusJson);
      expect(existsSync(join(pipelineDir, 'current-task'))).toBe(false);
    });
  });

  describe('idempotent re-stamp and overlap guard', () => {
    it('is a no-op (state unchanged) when the stamped id matches the dispatched id', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
      const pipelineDir = join(tempDir, '.pipeline');
      mkdirSync(pipelineDir, { recursive: true });

      const statusPath = join(pipelineDir, 'task-status.json');
      const seededStatus = {
        tasks: [
          { id: '1', status: 'completed' },
          { id: '7', status: 'in_progress' },
        ],
      };
      writeFileSync(statusPath, JSON.stringify(seededStatus), 'utf-8');
      const currentTaskPath = join(pipelineDir, 'current-task');
      writeFileSync(currentTaskPath, '7', 'utf-8');

      const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
      writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

      const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
        prompt: 'Task: 7',
      });

      let exitCode = 0;
      try {
        execFileSync('bash', [hookPath], {
          input: JSON.stringify(payload),
          cwd: tempDir,
          stdio: 'pipe',
        });
      } catch (err) {
        const execErr = err as { status?: number };
        exitCode = execErr.status ?? 1;
      }

      expect(exitCode).toBe(0);

      const updated = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
        tasks: Array<{ id: string; status: string }>;
      };
      expect(updated.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');
      expect(updated.tasks.find((t) => t.id === '1')?.status).toBe('completed');

      expect(existsSync(currentTaskPath)).toBe(true);
      expect(readFileSync(currentTaskPath, 'utf-8')).toBe('7');
    });

    it('clears the stamp file (overlap guard) when the dispatched id differs from the stamped id', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'pre-dispatch-hook-'));
      const pipelineDir = join(tempDir, '.pipeline');
      mkdirSync(pipelineDir, { recursive: true });

      const statusPath = join(pipelineDir, 'task-status.json');
      const seededStatus = {
        tasks: [
          { id: '1', status: 'completed' },
          { id: '7', status: 'in_progress' },
          { id: '9', status: 'pending' },
        ],
      };
      writeFileSync(statusPath, JSON.stringify(seededStatus), 'utf-8');
      const currentTaskPath = join(pipelineDir, 'current-task');
      writeFileSync(currentTaskPath, '7', 'utf-8');

      const hookPath = join(tempDir, 'pre-dispatch-hook.sh');
      writeFileSync(hookPath, PRE_DISPATCH_HOOK, { mode: 0o755 });

      const payload = loadPreDispatchPayload('pre-dispatch-task-id.json', {
        prompt: 'Task: 9',
      });

      let exitCode = 0;
      try {
        execFileSync('bash', [hookPath], {
          input: JSON.stringify(payload),
          cwd: tempDir,
          stdio: 'pipe',
        });
      } catch (err) {
        const execErr = err as { status?: number };
        exitCode = execErr.status ?? 1;
      }

      expect(exitCode).toBe(0);

      const updated = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
        tasks: Array<{ id: string; status: string }>;
      };
      expect(updated.tasks.find((t) => t.id === '9')?.status).toBe('in_progress');
      expect(updated.tasks.find((t) => t.id === '7')?.status).toBe('in_progress');

      // Overlap guard: stamp removed so the commit hook can't attribute
      expect(existsSync(currentTaskPath)).toBe(false);
    });
  });
});
