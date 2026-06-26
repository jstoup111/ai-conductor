// RED specs for the NOT-YET-BUILT `conduct engineer` subcommand wiring (Phase 9.3, Task 32).
//
// Mirrors the structural detection pattern used by the registry-cli tests:
//  - createProgram() must expose a `engineer` subcommand in its command list.
//  - detectEngineerCommand(argv) must return a dispatch descriptor when argv[2] === 'engineer'.
//  - index.ts main() must route a `engineer` argv to the engineer entry (runEngineerMode)
//    instead of entering the interactive pipeline.
//
// All assertions use REAL exports from src/ — no mocks of the units under test.

import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── 1. Structural: `createProgram()` registers a `engineer` subcommand ──────────

describe('CLI surface — conduct engineer subcommand (FR-1 wiring)', () => {
  it('createProgram() exposes a `engineer` subcommand', async () => {
    const { createProgram } = await import('../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    // RED until program.command('engineer') is added to cli.ts.
    expect(names).toContain('engineer');
  });
});

// ─── 2. Detection: detectEngineerCommand matches argv[2] === 'engineer' ─────────────

describe('detectEngineerCommand — argv detection', () => {
  it('returns a engineer dispatch descriptor when argv[2] is "engineer"', async () => {
    const { detectEngineerCommand } = await import('../src/engine/engineer-cli.js');
    const result = detectEngineerCommand(['node', 'conduct', 'engineer']);
    // RED until detectEngineerCommand is implemented in src/engine/engineer-cli.ts.
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('engineer');
  });

  it('returns null for non-engineer argv (pipeline run not hijacked)', async () => {
    const { detectEngineerCommand } = await import('../src/engine/engineer-cli.js');
    expect(detectEngineerCommand(['node', 'conduct', 'some feature'])).toBeNull();
    expect(detectEngineerCommand(['node', 'conduct', '--resume'])).toBeNull();
    expect(detectEngineerCommand(['node', 'conduct', 'register', '.'])).toBeNull();
  });

  it('returns null when argv has fewer than 3 elements', async () => {
    const { detectEngineerCommand } = await import('../src/engine/engineer-cli.js');
    expect(detectEngineerCommand(['node', 'conduct'])).toBeNull();
    expect(detectEngineerCommand(['node'])).toBeNull();
  });

  it('returns null for a feature description that happens to contain "engineer"', async () => {
    // e.g. "add engineer-dump feature" is NOT the `engineer` subcommand — it's a
    // positional feature description.
    const { detectEngineerCommand } = await import('../src/engine/engineer-cli.js');
    // Subcommand detection is ONLY triggered by argv[2] === 'engineer' exactly.
    expect(detectEngineerCommand(['node', 'conduct', '--auto', 'engineer-dump feature'])).toBeNull();
  });
});

// ─── 3. Dispatch: detectEngineerCommand result dispatches to the engineer entry ─────

describe('dispatchEngineer — routes to engineer entry stub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatchEngineer invokes the engineer entry and returns a numeric exit code', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    // dispatchEngineer must exist and be callable.
    expect(typeof mod.dispatchEngineer).toBe('function');
    // Inject a scripted io that immediately returns EOF (null) so the engineer
    // loop exits cleanly without blocking on process.stdin.
    const scriptedIo = {
      prompt: (): Promise<string | null> => Promise.resolve(null),
      print: (_s: string): void => { /* no-op */ },
    };
    const code = await mod.dispatchEngineer({ kind: 'engineer' }, { io: scriptedIo });
    expect(typeof code).toBe('number');
  });
});
