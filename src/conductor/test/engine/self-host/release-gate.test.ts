import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runIntegritySuite,
  evaluateChangelogUnreleased,
  classifyBreakingSurfaces,
  evaluateMigration,
  hasRunnableMigrationBlock,
  runReleaseArtifactGate,
} from '../../../src/engine/self-host/release-gate.js';

// Phase 5 (TR-8/9/10): the ReleaseArtifactGate — integrity suite, CHANGELOG
// [Unreleased], and Migration block. All fail-closed: an absent/unknown input
// HALTs, never silently passes.

describe('runIntegritySuite (TR-8)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'rg-int-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exit 0 → pass', async () => {
    const v = await runIntegritySuite({
      harnessRoot: root,
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v).toEqual({ ok: true });
  });

  it('non-zero exit → HALT naming the failing suite', async () => {
    const v = await runIntegritySuite({
      harnessRoot: root,
      access: async () => {},
      exec: async () => ({ code: 2, timedOut: false }),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/integrity suite failed/i);
  });

  it('missing script → fail-closed HALT (not a silent pass)', async () => {
    const v = await runIntegritySuite({
      harnessRoot: root,
      access: async () => {
        throw new Error('ENOENT');
      },
      exec: async () => ({ code: 0, timedOut: false }), // would pass — must not be reached
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/not found|missing/i);
  });

  it('timeout → treated as failure (HALT), not an indefinite block', async () => {
    const v = await runIntegritySuite({
      harnessRoot: root,
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: true }),
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/timed out/i);
  });
});

describe('evaluateChangelogUnreleased (TR-9)', () => {
  it('populated [Unreleased] with an entry → pass', () => {
    const cl = `# Changelog\n\n## [Unreleased]\n\n### Added\n- a new gate\n\n## [0.99.18] - 2026-06-30\n- old\n`;
    expect(evaluateChangelogUnreleased(cl)).toEqual({ ok: true });
  });

  it('empty [Unreleased] (header only) → HALT', () => {
    const cl = `# Changelog\n\n## [Unreleased]\n\n## [0.99.18] - 2026-06-30\n- old\n`;
    const v = evaluateChangelogUnreleased(cl);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/unreleased/i);
  });

  it('missing [Unreleased] section → HALT naming the missing section', () => {
    const cl = `# Changelog\n\n## [0.99.18] - 2026-06-30\n- old\n`;
    const v = evaluateChangelogUnreleased(cl);
    expect(v.ok).toBe(false);
  });

  it('whitespace/subheaders only under [Unreleased] → treated as empty (HALT)', () => {
    const cl = `## [Unreleased]\n\n### Added\n\n### Fixed\n\n## [0.99.18]\n- old\n`;
    expect(evaluateChangelogUnreleased(cl).ok).toBe(false);
  });

  it('tolerates duplicate [Unreleased] headers, entry under the second → pass', () => {
    const cl = `## [Unreleased]\n## [Unreleased]\n\n### Fixed\n- real entry\n\n## [0.99.18]\n- old\n`;
    expect(evaluateChangelogUnreleased(cl)).toEqual({ ok: true });
  });

  it('null changelog → HALT (fail-closed)', () => {
    expect(evaluateChangelogUnreleased(null).ok).toBe(false);
  });
});

describe('classifyBreakingSurfaces + evaluateMigration (TR-10)', () => {
  it('non-breaking changes → migration not required', () => {
    const surfaces = classifyBreakingSurfaces([
      { status: 'M', path: 'src/conductor/src/engine/self-host/detector.ts' },
      { status: 'A', path: 'skills/newskill/SKILL.md' }, // additive skill — not breaking
    ]);
    expect(surfaces.breaking).toBe(false);
    expect(evaluateMigration({ surfaces, hasBlock: false })).toEqual({ ok: true });
  });

  it('breaking surface (hook wiring) + no migration block → HALT naming the surface', () => {
    const surfaces = classifyBreakingSurfaces([{ status: 'M', path: 'hooks/claude/rtk-rewrite.sh' }]);
    expect(surfaces.breaking).toBe(true);
    const v = evaluateMigration({ surfaces, hasBlock: false });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/migration/i);
    expect(v.reason).toMatch(/hook wiring/i);
  });

  it('breaking surface + runnable migration block → pass', () => {
    const surfaces = classifyBreakingSurfaces([{ status: 'M', path: 'bin/conduct' }]);
    expect(surfaces.breaking).toBe(true);
    expect(evaluateMigration({ surfaces, hasBlock: true })).toEqual({ ok: true });
  });

  it('deleted/renamed skill → skill symlink targets breaking surface', () => {
    expect(classifyBreakingSurfaces([{ status: 'D', path: 'skills/oldskill/SKILL.md' }]).breaking).toBe(
      true,
    );
    expect(
      classifyBreakingSurfaces([{ status: 'R096', path: 'skills/renamed/SKILL.md' }]).surfaces,
    ).toContain('skill symlink targets');
  });

  it('unknown changed-file list (null) → uncertain → require block (fail-closed)', () => {
    const surfaces = classifyBreakingSurfaces(null);
    expect(surfaces.uncertain).toBe(true);
    expect(evaluateMigration({ surfaces, hasBlock: false }).ok).toBe(false);
    expect(evaluateMigration({ surfaces, hasBlock: true }).ok).toBe(true);
  });
});

describe('hasRunnableMigrationBlock — matches bin/migrate contract', () => {
  it('true for a ```bash migration fence under a Migration heading', () => {
    const body = `### Fixed\n- x\n\n## Migration\n\n\`\`\`bash migration\necho hi\n\`\`\`\n`;
    expect(hasRunnableMigrationBlock(body)).toBe(true);
  });

  it('false for a prose-only Migration section (no runnable fence)', () => {
    const body = `## Migration\n\nRun bin/install manually.\n`;
    expect(hasRunnableMigrationBlock(body)).toBe(false);
  });

  it('false for a plain ```bash fence WITHOUT the migration tag (bin/migrate would not run it)', () => {
    const body = `## Migration\n\n\`\`\`bash\necho hi\n\`\`\`\n`;
    expect(hasRunnableMigrationBlock(body)).toBe(false);
  });
});

describe('runReleaseArtifactGate — composed, HALT on first failure (TR-8/9/10)', () => {
  let projectRoot: string;
  let harnessRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'rg-proj-'));
    harnessRoot = await mkdtemp(join(tmpdir(), 'rg-harness-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(harnessRoot, { recursive: true, force: true });
  });

  const GOOD_CHANGELOG = `## [Unreleased]\n\n### Added\n- self-host guardrails\n\n## [0.99.18]\n- old\n`;

  it('all three sub-gates satisfied → pass, no HALT', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => GOOD_CHANGELOG,
      changedFiles: async () => [{ status: 'M', path: 'src/conductor/src/engine/x.ts' }],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('integrity failure → HALT written, later gates not consulted', async () => {
    let changelogRead = false;
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => {
        changelogRead = true;
        return GOOD_CHANGELOG;
      },
      changedFiles: async () => [],
      access: async () => {},
      exec: async () => ({ code: 1, timedOut: false }),
    });
    expect(v.ok).toBe(false);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(true);
    expect(changelogRead).toBe(false); // short-circuits on the first failing gate
  });

  it('integrity ok but empty CHANGELOG → HALT with the changelog reason', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => `## [Unreleased]\n\n## [0.99.18]\n- old\n`,
      changedFiles: async () => [],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v.ok).toBe(false);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/unreleased/i);
  });
});
