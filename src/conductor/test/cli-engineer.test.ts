// Specs for the `conduct engineer` subcommand wiring (Phase 9.3, ADR-008 conformance).
//
// Mirrors the structural detection pattern used by the registry-cli tests:
//  - createProgram() must expose a `engineer` subcommand in its command list.
//  - detectEngineerCommand(argv) must return a dispatch descriptor when argv[2] === 'engineer'.
//  - index.ts main() must route a `engineer` argv to the engineer entry
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
    expect(names).toContain('engineer');
  });
});

// ─── 2. Detection: detectEngineerCommand matches argv[2] === 'engineer' ─────────────

describe('detectEngineerCommand — argv detection', () => {
  it('returns a non-null dispatch descriptor when argv[2] is "engineer"', async () => {
    const { detectEngineerCommand } = await import('../src/engine/engineer-cli.js');
    const result = detectEngineerCommand(['node', 'conduct', 'engineer']);
    expect(result).not.toBeNull();
    // Bare 'engineer' with no subcommand → launch the interactive /engineer loop
    expect(result?.kind).toBe('launch');
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

describe('dispatchEngineer — routes to engineer entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatchEngineer({kind:"guide"}) exists and returns a numeric exit code 0', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    // dispatchEngineer must exist and be callable.
    expect(typeof mod.dispatchEngineer).toBe('function');
    const out: string[] = [];
    const code = await mod.dispatchEngineer({ kind: 'guide' }, { print: (s) => out.push(s) });
    expect(typeof code).toBe('number');
    expect(code).toBe(0);
    // Should print a usage message mentioning the /engineer loop.
    expect(out.join('\n')).toMatch(/\/engineer|skill|interactive/i);
  });

  it('dispatchEngineer({kind:"launch"}) launches the interactive loop and returns its exit code', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    // Injected launcher stands in for spawning a real `claude /engineer`.
    const launchInteractive = vi.fn().mockResolvedValue(0);
    const code = await mod.dispatchEngineer({ kind: 'launch' }, { launchInteractive });
    expect(launchInteractive).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it('dispatchEngineer({kind:"launch"}) loops one fresh session per idea until confirmAnother is false', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    // Each launch is a fresh `claude /engineer` (fresh context). confirmAnother
    // gates the outer loop: continue, continue, stop → exactly 3 launches.
    const launchInteractive = vi.fn().mockResolvedValue(0);
    const answers = [true, true, false];
    const confirmAnother = vi.fn().mockImplementation(() => answers.shift());
    const code = await mod.dispatchEngineer({ kind: 'launch' }, { launchInteractive, confirmAnother });
    expect(launchInteractive).toHaveBeenCalledTimes(3);
    expect(confirmAnother).toHaveBeenCalledTimes(3);
    expect(code).toBe(0);
  });

  it('dispatchEngineer({kind:"launch"}) returns the failing code and stops the loop on launch error', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    const launchInteractive = vi.fn().mockRejectedValue(new Error('spawn claude ENOENT'));
    const confirmAnother = vi.fn().mockResolvedValue(true);
    const out: string[] = [];
    const code = await mod.dispatchEngineer(
      { kind: 'launch' },
      { launchInteractive, confirmAnother, printErr: (s) => out.push(s) },
    );
    expect(code).toBe(1);
    // A launch failure must NOT keep looping.
    expect(confirmAnother).not.toHaveBeenCalled();
    expect(out.join('\n')).toMatch(/could not launch/i);
  });

  it('dispatchEngineer({kind:"launch"}) does NOT spawn a nested session when already inside Claude Code', async () => {
    const mod = await import('../src/engine/engineer-cli.js');
    const out: string[] = [];
    // insideClaudeSession:true must short-circuit before any spawn (no launcher injected).
    const code = await mod.dispatchEngineer(
      { kind: 'launch' },
      { insideClaudeSession: true, print: (s) => out.push(s) },
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/already inside|run \/engineer directly/i);
  });
});

// ─── 4. Launch argv: never plan mode (the engineer must be able to write) ────────

describe('engineerLaunchArgs — permission mode', () => {
  it('defaults to --permission-mode default (NOT plan) so the engineer can write', async () => {
    const { engineerLaunchArgs } = await import('../src/engine/engineer-cli.js');
    const args = engineerLaunchArgs({});
    expect(args).toEqual(['--permission-mode', 'default', '/engineer']);
    // Hard invariant: a launched engineer is never read-only.
    expect(args).not.toContain('plan');
  });

  it('honors CONDUCT_ENGINEER_PERMISSION_MODE override', async () => {
    const { engineerLaunchArgs } = await import('../src/engine/engineer-cli.js');
    expect(engineerLaunchArgs({ CONDUCT_ENGINEER_PERMISSION_MODE: 'acceptEdits' })).toEqual([
      '--permission-mode',
      'acceptEdits',
      '/engineer',
    ]);
  });

  it('coerces an explicit "plan" override back to default (plan would defeat the loop)', async () => {
    const { engineerLaunchArgs } = await import('../src/engine/engineer-cli.js');
    expect(engineerLaunchArgs({ CONDUCT_ENGINEER_PERMISSION_MODE: 'plan' })).toEqual([
      '--permission-mode',
      'default',
      '/engineer',
    ]);
  });
});
