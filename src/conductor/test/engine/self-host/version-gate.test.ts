import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateVersionApproval,
  runVersionApprovalGate,
  VERSION_APPROVAL_MARKER,
} from '../../../src/engine/self-host/version-gate.js';
import type { VersionSignal } from '../../../src/engine/self-host/version-signal.js';

// Phase 4 (TR-7): a self-build HALTs for the operator's semver-bump approval
// before opening a PR — CLAUDE.md's "present the VERSION bump for approval" rule
// enforced in `auto` mode instead of silently guessed.

describe('evaluateVersionApproval (TR-7 pure decision)', () => {
  it('marker present + matching VERSION → pass', () => {
    expect(evaluateVersionApproval({ approvalMarker: '0.99.19', repoVersion: '0.99.19' })).toEqual({
      ok: true,
    });
  });

  it('tolerates surrounding whitespace/newlines in marker and VERSION', () => {
    expect(
      evaluateVersionApproval({ approvalMarker: '  0.99.19\n', repoVersion: '0.99.19\n' }),
    ).toEqual({ ok: true });
  });

  it('absent marker → HALT with a distinct version-approval reason', () => {
    const v = evaluateVersionApproval({ approvalMarker: null, repoVersion: '0.99.19' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/VERSION.*approval/i);
    expect(v.reason).not.toMatch(/rebase/i); // distinct from a rebase HALT
  });

  it('marker VERSION ≠ repo VERSION → HALT naming the mismatch', () => {
    const v = evaluateVersionApproval({ approvalMarker: '0.99.20', repoVersion: '0.99.19' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('0.99.20');
    expect(v.reason).toContain('0.99.19');
  });

  it('empty/whitespace-only marker is treated as absent (not a blank match)', () => {
    const v = evaluateVersionApproval({ approvalMarker: '   \n', repoVersion: '0.99.19' });
    expect(v.ok).toBe(false);
  });
});

describe('evaluateVersionApproval — version freeze (#261)', () => {
  it('marker absent + freeze matching VERSION → pass (standing approval)', () => {
    expect(
      evaluateVersionApproval({
        approvalMarker: null,
        repoVersion: '0.99.19',
        versionFreeze: '0.99.19',
      }),
    ).toEqual({ ok: true });
  });

  it('marker absent + freeze ≠ VERSION → HALT naming both (a freeze never approves a bump)', () => {
    const v = evaluateVersionApproval({
      approvalMarker: null,
      repoVersion: '1.0.0',
      versionFreeze: '0.99.19',
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('0.99.19');
    expect(v.reason).toContain('1.0.0');
    expect(v.reason).toMatch(/never approves a bump/i);
  });

  it('explicit marker wins over the freeze — matching marker passes despite stale freeze', () => {
    expect(
      evaluateVersionApproval({
        approvalMarker: '1.0.0',
        repoVersion: '1.0.0',
        versionFreeze: '0.99.19',
      }),
    ).toEqual({ ok: true });
  });

  it('explicit marker wins over the freeze — mismatched marker HALTs even when freeze matches VERSION', () => {
    const v = evaluateVersionApproval({
      approvalMarker: '0.99.20',
      repoVersion: '0.99.19',
      versionFreeze: '0.99.19',
    });
    expect(v.ok).toBe(false);
  });

  it('blank freeze is no freeze — cannot match a blank VERSION read', () => {
    const v = evaluateVersionApproval({ approvalMarker: null, repoVersion: '', versionFreeze: '  \n' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/approval required/i);
  });
});

describe('evaluateVersionApproval — marker invariance (TR-3 Task 10)', () => {
  it('marker == VERSION: gate passes, classifier is NEVER invoked (spy check)', () => {
    const classifierSpy = vi.fn();
    const signal: VersionSignal = { level: 'patch' };
    const v = evaluateVersionApproval({
      approvalMarker: '0.99.19',
      repoVersion: '0.99.19',
      signal,
      classifier: classifierSpy,
    });
    expect(v.ok).toBe(true);
    expect(classifierSpy).not.toHaveBeenCalled();
  });

  it('marker ≠ VERSION: gate halts with mismatch reason even when signal is pure PATCH', () => {
    const classifierSpy = vi.fn();
    const signal: VersionSignal = { level: 'patch' };
    const v = evaluateVersionApproval({
      approvalMarker: '0.99.20',
      repoVersion: '0.99.19',
      signal,
      classifier: classifierSpy,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('0.99.20');
    expect(v.reason).toContain('0.99.19');
    // Classifier is not invoked on marker mismatch
    expect(classifierSpy).not.toHaveBeenCalled();
  });
});

describe('runVersionApprovalGate (TR-7 wiring: HALT on failure, no PR)', () => {
  let projectRoot: string;
  let harnessRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'vgate-proj-'));
    harnessRoot = await mkdtemp(join(tmpdir(), 'vgate-harness-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(harnessRoot, { recursive: true, force: true });
  });

  const reads = (map: Record<string, string | null>) => async (p: string) => map[p] ?? null;

  it('marker present + matching VERSION → pass, no HALT written', async () => {
    const readText = reads({
      [join(projectRoot, VERSION_APPROVAL_MARKER)]: '0.99.19',
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const verdict = await runVersionApprovalGate({ projectRoot, harnessRoot, readText });
    expect(verdict.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('absent marker → HALT file written with the version reason, PR unreachable (verdict !ok)', async () => {
    const readText = reads({ [join(harnessRoot, 'VERSION')]: '0.99.19' });
    const verdict = await runVersionApprovalGate({ projectRoot, harnessRoot, readText });
    expect(verdict.ok).toBe(false);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/VERSION.*approval/i);
    expect(halt).toMatch(/never merges/i); // ADR-005 resume procedure present
  });

  it('freeze auto-approval → pass, no HALT, and the standing approval recorded to the marker (#261)', async () => {
    const readText = reads({ [join(harnessRoot, 'VERSION')]: '0.99.19' });
    const written: Record<string, string> = {};
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      versionFreeze: '0.99.19',
      writeText: async (p, c) => {
        written[p] = c;
      },
    });
    expect(verdict.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
    expect(written[join(projectRoot, VERSION_APPROVAL_MARKER)]).toBe('0.99.19\n');
  });

  it('freeze ≠ VERSION → HALT written, marker NOT written (#261 negative)', async () => {
    const readText = reads({ [join(harnessRoot, 'VERSION')]: '1.0.0' });
    const written: Record<string, string> = {};
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      versionFreeze: '0.99.19',
      writeText: async (p, c) => {
        written[p] = c;
      },
    });
    expect(verdict.ok).toBe(false);
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toMatch(/never approves a bump/i);
    expect(Object.keys(written)).toHaveLength(0);
  });

  it('freeze auto-approval survives a failing marker write (evidence is best-effort)', async () => {
    const readText = reads({ [join(harnessRoot, 'VERSION')]: '0.99.19' });
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      versionFreeze: '0.99.19',
      writeText: async () => {
        throw new Error('disk full');
      },
    });
    expect(verdict.ok).toBe(true);
    expect(existsSync(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
  });

  it('explicit marker present → freeze does not overwrite it', async () => {
    const readText = reads({
      [join(projectRoot, VERSION_APPROVAL_MARKER)]: '0.99.19',
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const written: Record<string, string> = {};
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      versionFreeze: '0.99.19',
      writeText: async (p, c) => {
        written[p] = c;
      },
    });
    expect(verdict.ok).toBe(true);
    expect(Object.keys(written)).toHaveLength(0);
  });
});

describe('evaluateVersionApproval — no-marker classification (TR-3 Task 11)', () => {
  it('no marker + minor change set → HALT with level, paths, and resume procedure', () => {
    const signal: VersionSignal = { level: 'minor', signals: [{ kind: 'new skill', files: ['skills/new-thing/SKILL.md'] }] };
    const v = evaluateVersionApproval({
      approvalMarker: null,
      repoVersion: '0.99.19',
      signal,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/minor/i);
    expect(v.reason).toContain('skills/new-thing/SKILL.md');
    expect(v.reason).toMatch(/\.pipeline\/version-approval/);
  });

  it('no marker + major change set → HALT with level, paths, and resume procedure', () => {
    const signal: VersionSignal = { level: 'major', signals: [{ kind: 'bin/conduct CLI', files: ['bin/conduct'] }] };
    const v = evaluateVersionApproval({
      approvalMarker: null,
      repoVersion: '0.99.19',
      signal,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/major/i);
    expect(v.reason).toContain('bin/conduct');
  });

  it('no marker + null diff (undeterminable) → HALT reason contains "undeterminable"', () => {
    const signal: VersionSignal = { level: 'halt-undeterminable', reason: 'change set is null or empty; cannot determine version bump' };
    const v = evaluateVersionApproval({
      approvalMarker: null,
      repoVersion: '0.99.19',
      signal,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toMatch(/undeterminable/i);
  });

  it('no marker + patch change set → verdict ok (auto-pass)', () => {
    const signal: VersionSignal = { level: 'patch' };
    const v = evaluateVersionApproval({
      approvalMarker: null,
      repoVersion: '0.99.19',
      signal,
    });
    expect(v.ok).toBe(true);
  });

  it('marker present (even if mismatch) short-circuits signal classification', () => {
    // A mismatch marker halts regardless of signal classification
    const signal: VersionSignal = { level: 'patch' };
    const v = evaluateVersionApproval({
      approvalMarker: '0.99.20',
      repoVersion: '0.99.19',
      signal,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toContain('0.99.20');
    expect(v.reason).toContain('0.99.19');
  });
});

describe('runVersionApprovalGate — audit record write (TR-3 Task 12)', () => {
  let projectRoot: string;
  let harnessRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'vgate-audit-'));
    harnessRoot = await mkdtemp(join(tmpdir(), 'vgate-audit-harness-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(harnessRoot, { recursive: true, force: true });
  });

  const reads = (map: Record<string, string | null>) => async (p: string) => map[p] ?? null;

  it('PATCH auto-pass writes .pipeline/version-signal.json with verdict/level/files/classifiedAt', async () => {
    const readText = reads({
      [join(projectRoot, VERSION_APPROVAL_MARKER)]: '0.99.19',
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const auditWrites: Record<string, string> = {};
    const signal: VersionSignal = { level: 'patch' };
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      signal,
      writeAudit: async (p, c) => {
        auditWrites[p] = c;
      },
    });
    expect(verdict.ok).toBe(true);
    const auditPath = join(projectRoot, '.pipeline', 'version-signal.json');
    expect(auditWrites[auditPath]).toBeDefined();
    const auditRecord = JSON.parse(auditWrites[auditPath]);
    expect(auditRecord.verdict).toBe('ok');
    expect(auditRecord.level).toBe('patch');
    expect(auditRecord.files).toEqual([]);
    expect(auditRecord.classifiedAt).toBeDefined();
    expect(typeof auditRecord.classifiedAt).toBe('string');
  });

  it('PATCH auto-pass includes changed files in audit record when signal specifies them', async () => {
    const readText = reads({
      [join(projectRoot, VERSION_APPROVAL_MARKER)]: '0.99.19',
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const auditWrites: Record<string, string> = {};
    const signal: VersionSignal = {
      level: 'patch',
      changedFiles: ['README.md', 'src/conductor/src/engine/selector.ts'],
    };
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      signal,
      writeAudit: async (p, c) => {
        auditWrites[p] = c;
      },
    });
    expect(verdict.ok).toBe(true);
    const auditPath = join(projectRoot, '.pipeline', 'version-signal.json');
    const auditRecord = JSON.parse(auditWrites[auditPath]);
    expect(auditRecord.files).toEqual(['README.md', 'src/conductor/src/engine/selector.ts']);
  });

  it('signal HALT does not write a pass record (no stale .pipeline/version-signal.json)', async () => {
    const readText = reads({
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const auditWrites: Record<string, string> = {};
    const signal: VersionSignal = {
      level: 'minor',
      signals: [{ kind: 'new skill', files: ['skills/new-skill/SKILL.md'] }],
    };
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      signal,
      writeAudit: async (p, c) => {
        auditWrites[p] = c;
      },
    });
    expect(verdict.ok).toBe(false);
    const auditPath = join(projectRoot, '.pipeline', 'version-signal.json');
    expect(auditWrites[auditPath]).toBeUndefined();
  });

  it('write failure on audit record → gate HALTs, not an unaudio pass', async () => {
    const readText = reads({
      [join(projectRoot, VERSION_APPROVAL_MARKER)]: '0.99.19',
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const signal: VersionSignal = { level: 'patch' };
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      signal,
      writeAudit: async () => {
        throw new Error('disk full');
      },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain('disk full');
    }
    const halt = await readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf-8');
    expect(halt).toContain('disk full');
  });

  it('marker absent, freeze match, PATCH signal → audit writes, marker writes too', async () => {
    const readText = reads({
      [join(harnessRoot, 'VERSION')]: '0.99.19',
    });
    const auditWrites: Record<string, string> = {};
    const markerWrites: Record<string, string> = {};
    const signal: VersionSignal = { level: 'patch' };
    const verdict = await runVersionApprovalGate({
      projectRoot,
      harnessRoot,
      readText,
      versionFreeze: '0.99.19',
      signal,
      writeText: async (p, c) => {
        markerWrites[p] = c;
      },
      writeAudit: async (p, c) => {
        auditWrites[p] = c;
      },
    });
    expect(verdict.ok).toBe(true);
    const auditPath = join(projectRoot, '.pipeline', 'version-signal.json');
    expect(auditWrites[auditPath]).toBeDefined();
    // Marker write still happens (best-effort) for the freeze case
    expect(markerWrites[join(projectRoot, VERSION_APPROVAL_MARKER)]).toBe('0.99.19\n');
  });
});
