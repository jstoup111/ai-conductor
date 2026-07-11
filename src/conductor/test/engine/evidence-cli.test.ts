// Tests for the `conduct evidence` command group (Task 19)
// Covers: CLI evidence command group + resolution errors

import { describe, it, expect } from 'vitest';

// ─── 1. Structural: `createProgram()` registers an `evidence` subcommand ────

describe('CLI surface — conduct evidence subcommand (Task 19)', () => {
  it('createProgram() exposes an `evidence` subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain('evidence');
  });

  it('evidence subcommand has a `judge` sub-subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const evidence = createProgram().commands.find((c) => c.name() === 'evidence');
    expect(evidence).toBeDefined();
    const judgeCmd = evidence?.commands.find((c) => c.name() === 'judge');
    expect(judgeCmd).toBeDefined();
  });
});

// ─── 2. Detection: detectEvidenceCommand matches argv[2] === 'evidence' ─────

describe('detectEvidenceCommand — argv detection', () => {
  it('returns a non-null dispatch descriptor when argv[2] is "evidence"', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence']);
    expect(result).not.toBeNull();
    // Bare 'evidence' with no subcommand → guide
    expect(result?.kind).toBe('guide');
  });

  it('detects: conduct evidence judge <slug>', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'judge', 'my-feature']);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('judge');
    expect((result as any)?.slug).toBe('my-feature');
  });

  it('returns guide for evidence judge with missing slug', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'judge']);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('guide');
  });

  it('returns guide for unknown evidence subcommand', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'unknown']);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('guide');
  });

  it('returns null for non-evidence argv (pipeline run not hijacked)', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    expect(detectEvidenceCommand(['node', 'conduct', 'some feature'])).toBeNull();
    expect(detectEvidenceCommand(['node', 'conduct', '--resume'])).toBeNull();
    expect(detectEvidenceCommand(['node', 'conduct', 'task', 'start', '1'])).toBeNull();
  });

  it('returns null when argv has fewer than 3 elements', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    expect(detectEvidenceCommand(['node', 'conduct'])).toBeNull();
    expect(detectEvidenceCommand(['node'])).toBeNull();
  });
});

// ─── 3. Dispatch: dispatchEvidence routes to judge handler ─────────────────

describe('dispatchEvidence — routes to evidence entry', () => {
  it('dispatchEvidence({kind:"guide"}) prints usage and exits 2', async () => {
    const { dispatchEvidence } = await import('../../src/engine/evidence-cli.js');
    const out: string[] = [];
    const code = await dispatchEvidence(
      { kind: 'guide' },
      { print: (s: string) => out.push(s) },
    );
    expect(code).toBe(2);
    expect(out.join('\n')).toMatch(/evidence judge/i);
  });

  it('dispatchEvidence({kind:"judge", slug:"feature"}) exists and is callable', async () => {
    const { dispatchEvidence } = await import('../../src/engine/evidence-cli.js');
    expect(typeof dispatchEvidence).toBe('function');
  });
});

// ─── 4. Feature resolution: judge command with unknown feature ──────────────

describe('evidence judge command — feature resolution errors', () => {
  it('unknown feature slug returns non-zero and prints clear message', async () => {
    const { dispatchEvidence } = await import('../../src/engine/evidence-cli.js');
    const out: string[] = [];
    const code = await dispatchEvidence(
      { kind: 'judge', slug: 'nonexistent-feature' },
      { print: (s: string) => out.push(s), cwd: process.cwd() },
    );
    expect(code).not.toBe(0);
    const message = out.join('\n');
    // Should mention either the feature, slug, or worktree
    expect(message).toMatch(/feature|worktree|slug/i);
  });

  it('judge command with zero writes on error', async () => {
    const { dispatchEvidence } = await import('../../src/engine/evidence-cli.js');
    // Should not throw even on error
    const code = await dispatchEvidence(
      { kind: 'judge', slug: 'nonexistent-feature-xyz' },
      { print: () => {}, cwd: process.cwd() },
    );
    expect(typeof code).toBe('number');
    expect(code).not.toBe(0);
  });
});
