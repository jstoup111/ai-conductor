import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runIntegritySuite,
  classifyBreakingSurfaces,
  evaluateMigration,
  hasRunnableMigrationBlock,
  runReleaseArtifactGate,
} from '../../../src/engine/self-host/release-gate.js';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';

// Phase 5 (TR-8/10): the ReleaseArtifactGate — integrity suite and Migration
// block. Both fail-closed: an absent/unknown input HALTs, never silently passes.

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

  it('skill renamed OUT of skills/ is caught via origPath even though the destination is not under skills/', () => {
    // A rename records the destination in `path` and the source in `origPath`.
    // `skills/foo → archive/foo` removes a skill from skills/ (breaking symlink
    // targets); classification must inspect the source path, not just the dest.
    const surfaces = classifyBreakingSurfaces([
      { status: 'R100', path: 'archive/foo/SKILL.md', origPath: 'skills/foo/SKILL.md' },
    ]);
    expect(surfaces.surfaces).toContain('skill symlink targets');
    expect(evaluateMigration({ surfaces, hasBlock: false }).ok).toBe(false);
  });

  it('rename INTO a breaking surface (bin/conduct) is caught via the destination path', () => {
    const surfaces = classifyBreakingSurfaces([
      { status: 'R100', path: 'bin/conduct', origPath: 'bin/conduct-old' },
    ]);
    expect(surfaces.surfaces).toContain('bin/conduct CLI');
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

describe('runReleaseArtifactGate — composed, HALT on first failure (TR-8/10)', () => {
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

  it('accepts a parsed runnable migration from structured PR metadata without reading CHANGELOG', async () => {
    const migration = '```bash migration\n./bin/install --update\n```';
    const releaseMetadata = parseReleaseDisposition([
      'Release-Disposition: note',
      'Release-Category: Changed',
      'Release-Semver: major',
      'Release-Note: Preserve a consumer migration.',
      '',
      '## Migration',
      '',
      migration,
    ].join('\n'));

    expect(releaseMetadata).toMatchObject({ migration });

    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => {
        throw new Error('the structured migration gate must not read CHANGELOG');
      },
      releaseMetadata,
      changedFiles: async () => [{ status: 'M', path: 'bin/conduct' }],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v).toEqual({ ok: true });
  });

  it.each([
    [
      'a non-runnable fence',
      [
        'Release-Disposition: note',
        'Release-Category: Changed',
        'Release-Semver: major',
        'Release-Note: Preserve a consumer migration.',
        '',
        '## Migration',
        '',
        '```bash',
        './bin/install --update',
        '```',
      ].join('\n'),
    ],
    [
      'a runnable migration on an explicit no-note disposition',
      ['Release-Disposition: no-note', '', '## Migration', '', '```bash migration', './bin/install --update', '```'].join('\n'),
    ],
  ])('rejects %s in structured metadata', (_scenario, body) => {
    expect(() => parseReleaseDisposition(body)).toThrow('Invalid release disposition: Migration');
  });

  it('both sub-gates satisfied → pass, no HALT', async () => {
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

  it('default emitter-less integrity HALT surfaces a failed marker write without throwing', async () => {
    await expect(
      runReleaseArtifactGate({
        projectRoot: '/dev/null',
        harnessRoot,
        readText: async () => GOOD_CHANGELOG,
        changedFiles: async () => [],
        access: async () => {},
        exec: async () => ({ code: 1, timedOut: false }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/HALT marker write failed: .*ENOTDIR/i),
    });
  });

  it('integrity ok and empty [Unreleased] with non-breaking changes → pass without HALT', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => `## [Unreleased]\n\n## [0.99.18]\n- old\n`,
      changedFiles: async () => [],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('empty [Unreleased] does not bypass the migration gate for a breaking change', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => `## [Unreleased]\n\n## [0.99.18]\n- old\n`,
      changedFiles: async () => [{ status: 'M', path: 'bin/conduct' }],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v.ok).toBe(false);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/migration block required/i);
  });

  it('empty [Unreleased] does not bypass fail-closed migration when changes are uncertain', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => `## [Unreleased]\n\n## [0.99.18]\n- old\n`,
      changedFiles: async () => null,
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });
    expect(v.ok).toBe(false);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/migration block required/i);
    expect(halt).toMatch(/could not be determined|fail-closed/i);
  });

  it('accepts a fresh waiver that covers the classified breaking surface', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => 'Waives: bin/conduct CLI\n\nRationale: This command edit is internal-only.\n',
      changedFiles: async () => [
        { status: 'M', path: 'bin/conduct' },
        { status: 'A', path: '.docs/release-waivers/internal-conduct.md' },
      ],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v).toEqual({ ok: true });
  });

  it('rejects a valid waiver that was not committed in the current change set', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => 'Waives: bin/conduct CLI\n\nRationale: This command edit is internal-only.\n',
      changedFiles: async () => [{ status: 'M', path: 'bin/conduct' }],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/not committed with this change set|prior feature/i);
  });

  it('rejects a malformed fresh waiver', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => 'Waives: not a canonical surface\n\nRationale: This command edit is internal-only.\n',
      changedFiles: async () => [
        { status: 'M', path: 'bin/conduct' },
        { status: 'A', path: '.docs/release-waivers/internal-conduct.md' },
      ],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/malformed/i);
  });

  it('rejects a fresh waiver that only partially covers classified breaking surfaces', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => 'Waives: bin/conduct CLI\n\nRationale: This command edit is internal-only.\n',
      changedFiles: async () => [
        { status: 'M', path: 'bin/conduct' },
        { status: 'M', path: 'hooks/claude/rtk-rewrite.sh' },
        { status: 'A', path: '.docs/release-waivers/internal-conduct.md' },
      ],
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/does not cover: hook wiring/i);
  });

  it('rejects an uncertain change set without reading a waiver', async () => {
    const v = await runReleaseArtifactGate({
      projectRoot,
      harnessRoot,
      readText: async () => {
        throw new Error('uncertain changes must not evaluate waivers');
      },
      changedFiles: async () => null,
      access: async () => {},
      exec: async () => ({ code: 0, timedOut: false }),
    });

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/could not be determined|fail-closed/i);
    expect(v.reason).not.toMatch(/waiver/i);
  });
});
