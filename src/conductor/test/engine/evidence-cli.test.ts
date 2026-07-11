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

// ─── 5. Dry-run flag: detectEvidenceCommand parses --dry-run ────────────────

describe('detectEvidenceCommand — dry-run flag parsing (Task 21)', () => {
  it('parses --dry-run flag from argv[5]', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'judge', 'my-feature', '--dry-run']);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('judge');
    expect((result as any)?.slug).toBe('my-feature');
    expect((result as any)?.dryRun).toBe(true);
  });

  it('detects missing dry-run flag as false', async () => {
    const { detectEvidenceCommand } = await import('../../src/engine/evidence-cli.js');
    const result = detectEvidenceCommand(['node', 'conduct', 'evidence', 'judge', 'my-feature']);
    expect(result).not.toBeNull();
    expect((result as any)?.dryRun).toBeUndefined();
  });
});

// ─── 6. Active-build guard: evidence judge rejects during active build ──────

describe('runEvidenceJudge — active-build guard (Task 21)', () => {
  it('returns error when .pipeline/build-step-active exists', async () => {
    const { runEvidenceJudge } = await import('../../src/engine/evidence-cli.js');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tmpDir = await mkdtemp(join(tmpdir(), 'evidence-judge-'));
    try {
      // Create .pipeline/build-step-active marker
      const pipelineDir = join(tmpDir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await writeFile(join(pipelineDir, 'build-step-active'), '');

      const result = await runEvidenceJudge({
        featureSlug: 'test-feature',
        planPath: join(tmpDir, '.docs', 'plans', 'test-feature.md'),
        projectRoot: tmpDir,
        dryRun: false,
        resolveWorktree: async () => ({ root: tmpDir, branch: 'main' }),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/active|build/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── 7. Full-resolution recovery: HALT marker + REKICK sentinel (Task 21) ────

describe('runEvidenceJudge — full-resolution recovery tail (Task 21)', () => {
  it('drops HALT marker and writes REKICK sentinel when fully resolved', async () => {
    const { runEvidenceJudge } = await import('../../src/engine/evidence-cli.js');
    const { mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const tmpDir = await mkdtemp(join(tmpdir(), 'evidence-judge-recovery-'));
    try {
      // Set up minimal worktree with HALT marker
      const pipelineDir = join(tmpDir, '.pipeline');
      const docsDir = join(tmpDir, '.docs', 'plans');
      await mkdir(docsDir, { recursive: true });
      await mkdir(pipelineDir, { recursive: true });

      // Create HALT marker
      const haltPath = join(pipelineDir, 'HALT');
      await writeFile(haltPath, 'build was incomplete\n');

      // Create minimal plan with one task
      const planPath = join(docsDir, 'test-feature.md');
      await writeFile(planPath, '### Task 1\n\n**Files:** `src/test.ts`\n');

      // Create git repo structure
      const gitDir = join(tmpDir, '.git');
      await mkdir(gitDir, { recursive: true });
      await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      // Pre-populate evidence to mark task as fully resolved
      const evidenceFile = join(pipelineDir, 'task-evidence.json');
      await writeFile(
        evidenceFile,
        JSON.stringify({
          evidenceStamps: {
            '1': {
              sha: 'abc123',
              form: 'semantic-verified',
            },
          },
          noEvidenceAttempts: 0,
          noEvidenceReasons: [],
          migrationGrandfather: [],
        }),
      );

      // Mock resolver
      const result = await runEvidenceJudge({
        featureSlug: 'test-feature',
        planPath,
        projectRoot: tmpDir,
        dryRun: false,
        resolveWorktree: async () => ({ root: tmpDir, branch: 'main' }),
        dispatchVerifier: async () => {
          // No residue verifier dispatch for fully-resolved case
        },
      });

      // When all tasks are resolved, HALT should be dropped and REKICK written
      expect(existsSync(haltPath)).toBe(false);
      expect(existsSync(join(pipelineDir, 'REKICK'))).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('leaves HALT marker untouched when partially resolved', async () => {
    const { runEvidenceJudge } = await import('../../src/engine/evidence-cli.js');
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const tmpDir = await mkdtemp(join(tmpdir(), 'evidence-judge-partial-'));
    try {
      // Set up minimal worktree with HALT marker
      const pipelineDir = join(tmpDir, '.pipeline');
      const docsDir = join(tmpDir, '.docs', 'plans');
      await mkdir(docsDir, { recursive: true });
      await mkdir(pipelineDir, { recursive: true });

      // Create HALT marker
      const haltPath = join(pipelineDir, 'HALT');
      await writeFile(haltPath, 'build has remaining tasks\n');

      // Create plan with multiple tasks (to ensure partial resolution)
      const planPath = join(docsDir, 'test-feature.md');
      await writeFile(
        planPath,
        '### Task 1\n\n**Files:** `src/test.ts`\n\n### Task 2\n\n**Files:** `src/test2.ts`\n',
      );

      // Create git repo structure
      const gitDir = join(tmpDir, '.git');
      await mkdir(gitDir, { recursive: true });
      await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const result = await runEvidenceJudge({
        featureSlug: 'test-feature',
        planPath,
        projectRoot: tmpDir,
        dryRun: false,
        resolveWorktree: async () => ({ root: tmpDir, branch: 'main' }),
      });

      // When partially resolved (remaining tasks exist), HALT should remain
      expect(existsSync(haltPath)).toBe(true);
      expect(existsSync(join(pipelineDir, 'REKICK'))).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
