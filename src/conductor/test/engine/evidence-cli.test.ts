// Tests for the `conduct evidence` command group after the citation-judge
// GATING removal (feature #773, Task 12).
//
// `evidence judge <slug>` used to dispatch a semantic-attribution verifier,
// validate its citations, and stamp task evidence so the build gate could
// advance on the verdict. That gating role is deleted: citation-quality
// sampling now lives exclusively in the separate, non-blocking spot-audit
// path (attribution-audit.ts). `conduct evidence` is retained only as a
// guide-only stub that reports the removal.

import { describe, it, expect } from 'vitest';

describe('CLI surface — conduct evidence subcommand (post-Task-12)', () => {
  it('createProgram() still exposes an `evidence` subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain('evidence');
  });

  it('the `judge` sub-subcommand is no longer registered', async () => {
    const { createProgram } = await import('../../src/index.js');
    const evidence = createProgram().commands.find((c) => c.name() === 'evidence');
    expect(evidence).toBeDefined();
    const judgeCmd = evidence?.commands.find((c) => c.name() === 'judge');
    expect(judgeCmd).toBeUndefined();
  });
});

describe('detectEvidenceCommand — argv detection (post-Task-12)', () => {
  it('returns {kind:"guide"} for any "evidence" argv, including a former judge invocation', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'judge', 'some-feature']);
    expect(result).toEqual({ kind: 'guide' });
  });

  it('returns {kind:"guide"} for bare "conduct evidence"', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence']);
    expect(result).toEqual({ kind: 'guide' });
  });

  it('returns null for non-evidence argv (pipeline run not hijacked)', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'run']);
    expect(result).toBeNull();
  });

  it('returns null when argv has fewer than 3 elements', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct']);
    expect(result).toBeNull();
  });
});

describe('dispatchEvidence — guide-only after judge removal', () => {
  it('prints the removal notice and exits 2', async () => {
    const { dispatchEvidence } = await import('../../src/engine/evidence-cli.js');
    const printed: string[] = [];
    const code = await dispatchEvidence({ kind: 'guide' }, { print: (m) => printed.push(m) });
    expect(code).toBe(2);
    expect(printed.join('\n')).toMatch(/judge.*removed/i);
  });

  it('no longer exports runEvidenceJudge or runEvidenceJudgeCLI (gating path deleted)', async () => {
    const mod = await import('../../src/engine/evidence-cli.js');
    expect((mod as Record<string, unknown>).runEvidenceJudge).toBeUndefined();
  });
});
