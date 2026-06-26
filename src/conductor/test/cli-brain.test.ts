// RED specs for the NOT-YET-BUILT `conduct brain` subcommand wiring (Phase 9.3, Task 32).
//
// Mirrors the structural detection pattern used by the registry-cli tests:
//  - createProgram() must expose a `brain` subcommand in its command list.
//  - detectBrainCommand(argv) must return a dispatch descriptor when argv[2] === 'brain'.
//  - index.ts main() must route a `brain` argv to the brain entry (runBrainMode)
//    instead of entering the interactive pipeline.
//
// All assertions use REAL exports from src/ — no mocks of the units under test.

import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── 1. Structural: `createProgram()` registers a `brain` subcommand ──────────

describe('CLI surface — conduct brain subcommand (FR-1 wiring)', () => {
  it('createProgram() exposes a `brain` subcommand', async () => {
    const { createProgram } = await import('../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    // RED until program.command('brain') is added to cli.ts.
    expect(names).toContain('brain');
  });
});

// ─── 2. Detection: detectBrainCommand matches argv[2] === 'brain' ─────────────

describe('detectBrainCommand — argv detection', () => {
  it('returns a brain dispatch descriptor when argv[2] is "brain"', async () => {
    const { detectBrainCommand } = await import('../src/engine/brain-cli.js');
    const result = detectBrainCommand(['node', 'conduct', 'brain']);
    // RED until detectBrainCommand is implemented in src/engine/brain-cli.ts.
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('brain');
  });

  it('returns null for non-brain argv (pipeline run not hijacked)', async () => {
    const { detectBrainCommand } = await import('../src/engine/brain-cli.js');
    expect(detectBrainCommand(['node', 'conduct', 'some feature'])).toBeNull();
    expect(detectBrainCommand(['node', 'conduct', '--resume'])).toBeNull();
    expect(detectBrainCommand(['node', 'conduct', 'register', '.'])).toBeNull();
  });

  it('returns null when argv has fewer than 3 elements', async () => {
    const { detectBrainCommand } = await import('../src/engine/brain-cli.js');
    expect(detectBrainCommand(['node', 'conduct'])).toBeNull();
    expect(detectBrainCommand(['node'])).toBeNull();
  });

  it('returns null for a feature description that happens to contain "brain"', async () => {
    // e.g. "add brain-dump feature" is NOT the `brain` subcommand — it's a
    // positional feature description.
    const { detectBrainCommand } = await import('../src/engine/brain-cli.js');
    // Subcommand detection is ONLY triggered by argv[2] === 'brain' exactly.
    expect(detectBrainCommand(['node', 'conduct', '--auto', 'brain-dump feature'])).toBeNull();
  });
});

// ─── 3. Dispatch: detectBrainCommand result dispatches to the brain entry ─────

describe('dispatchBrain — routes to brain entry stub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatchBrain invokes the brain entry and returns a numeric exit code', async () => {
    const mod = await import('../src/engine/brain-cli.js');
    // dispatchBrain must exist and be callable.
    expect(typeof mod.dispatchBrain).toBe('function');
    // Inject a scripted io that immediately returns EOF (null) so the brain
    // loop exits cleanly without blocking on process.stdin.
    const scriptedIo = {
      prompt: (): Promise<string | null> => Promise.resolve(null),
      print: (_s: string): void => { /* no-op */ },
    };
    const code = await mod.dispatchBrain({ kind: 'brain' }, { io: scriptedIo });
    expect(typeof code).toBe('number');
  });
});
