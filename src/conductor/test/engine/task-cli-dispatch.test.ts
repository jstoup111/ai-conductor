// Specs for the `conduct task` subcommand wiring (Task 7).
//
// Mirrors the structural detection pattern used by the derive-feedback-cli tests:
//  - createProgram() must expose a `task` subcommand in its command list.
//  - detectTaskCommand(argv) must return a dispatch descriptor when argv[2] === 'task'.
//  - index.ts main() must route a `task` argv to the task entry
//    instead of entering the interactive pipeline.
//
// All assertions use REAL exports from src/ — no mocks of the units under test.

import { describe, it, expect } from 'vitest';

// ─── 1. Structural: `createProgram()` registers a `task` subcommand ──────────

describe('CLI surface — conduct task subcommand (Task 7 wiring)', () => {
  it('createProgram() exposes a `task` subcommand', async () => {
    const { createProgram } = await import('../../src/cli.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain('task');
  });

  it('task subcommand appears in full help output', async () => {
    const { renderFullHelp } = await import('../../src/cli.js');
    const help = renderFullHelp();
    expect(help).toMatch(/conduct task/i);
    expect(help).toMatch(/start/i);
    expect(help).toMatch(/done/i);
  });
});

// ─── 2. Detection: detectTaskCommand matches argv[2] === 'task' ─────────────

describe('detectTaskCommand — argv detection', () => {
  it('returns a non-null dispatch descriptor when argv[2] is "task"', async () => {
    const { detectTaskCommand } = await import('../../src/engine/task-cli.js');
    const result = detectTaskCommand(['node', 'conduct', 'task', 'start', '7']);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('start');
  });

  it('returns null for non-task argv (pipeline run not hijacked)', async () => {
    const { detectTaskCommand } = await import('../../src/engine/task-cli.js');
    expect(detectTaskCommand(['node', 'conduct', 'some feature'])).toBeNull();
    expect(detectTaskCommand(['node', 'conduct', '--resume'])).toBeNull();
    expect(detectTaskCommand(['node', 'conduct', 'register', '.'])).toBeNull();
    expect(detectTaskCommand(['node', 'conduct', 'derive-feedback', '--sha', 'abc'])).toBeNull();
  });

  it('returns null when argv has fewer than 3 elements', async () => {
    const { detectTaskCommand } = await import('../../src/engine/task-cli.js');
    expect(detectTaskCommand(['node', 'conduct'])).toBeNull();
    expect(detectTaskCommand(['node'])).toBeNull();
  });

  it('returns null for a feature description that happens to contain "task"', async () => {
    // e.g. "add task-runner feature" is NOT the `task` subcommand — it's a
    // positional feature description.
    const { detectTaskCommand } = await import('../../src/engine/task-cli.js');
    // Subcommand detection is ONLY triggered by argv[2] === 'task' exactly.
    expect(detectTaskCommand(['node', 'conduct', '--auto', 'task-runner feature'])).toBeNull();
  });
});

// ─── 3. Dispatch: dispatchTaskCommand exists and handles start/done ──────────

describe('dispatchTaskCommand — routes to task handlers', () => {
  it('dispatchTaskCommand({kind:"guide"}) exists and returns a numeric exit code', async () => {
    const mod = await import('../../src/engine/task-cli.js');
    // dispatchTaskCommand must exist and be callable.
    expect(typeof mod.dispatchTaskCommand).toBe('function');
    const code = await mod.dispatchTaskCommand({ kind: 'guide' }, process.cwd());
    expect(typeof code).toBe('number');
  });
});
