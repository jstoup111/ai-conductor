import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateVersionApproval,
  runVersionApprovalGate,
  VERSION_APPROVAL_MARKER,
} from '../../../src/engine/self-host/version-gate.js';

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
});
