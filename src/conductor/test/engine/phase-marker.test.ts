import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { phaseMarkerPath, writePhaseMarker, removePhaseMarker, resolveDocsAllowlist } from '../../src/engine/phase-marker.js';

// #788: phase-active marker — the session-hook-visible signal for which
// step/phase is currently dispatched, so a write-guard hook can tell
// "docs/spec artifacts changed mid-BUILD" from "changed during DECIDE/SHIP".

describe('phase-marker', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'phase-marker-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('phaseMarkerPath resolves under .pipeline/phase-active', () => {
    expect(phaseMarkerPath(root)).toBe(join(root, '.pipeline', 'phase-active'));
  });

  it('writePhaseMarker creates the .pipeline directory when absent', () => {
    expect(existsSync(join(root, '.pipeline'))).toBe(false);
    expect(() =>
      writePhaseMarker(root, { step: 'acceptance_specs', phase: 'BUILD', allow: [] }),
    ).not.toThrow();
    expect(existsSync(phaseMarkerPath(root))).toBe(true);
  });

  it('writePhaseMarker writes step, phase, and an ISO-8601 written timestamp', () => {
    writePhaseMarker(root, { step: 'acceptance_specs', phase: 'BUILD', allow: [] });
    const content = readFileSync(phaseMarkerPath(root), 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    expect(lines).toContain('step: acceptance_specs');
    expect(lines).toContain('phase: BUILD');
    const writtenLine = lines.find((l) => l.startsWith('written: '));
    expect(writtenLine).toBeDefined();
    const iso = writtenLine!.slice('written: '.length);
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('writePhaseMarker writes one allow line per allow-list entry', () => {
    writePhaseMarker(root, {
      step: 'build',
      phase: 'BUILD',
      allow: ['.docs/plans/', '.docs/shipped/'],
    });
    const lines = readFileSync(phaseMarkerPath(root), 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toContain('allow: .docs/plans/');
    expect(lines).toContain('allow: .docs/shipped/');
  });

  it('removePhaseMarker deletes an existing marker', () => {
    writePhaseMarker(root, { step: 'build', phase: 'BUILD', allow: [] });
    expect(existsSync(phaseMarkerPath(root))).toBe(true);
    removePhaseMarker(root);
    expect(existsSync(phaseMarkerPath(root))).toBe(false);
  });

  it('removePhaseMarker is idempotent when the marker is absent', () => {
    expect(existsSync(phaseMarkerPath(root))).toBe(false);
    expect(() => removePhaseMarker(root)).not.toThrow();
    expect(() => removePhaseMarker(root)).not.toThrow();
  });

  it('resolveDocsAllowlist merges always-allowed with per-step entries for retro', () => {
    expect(resolveDocsAllowlist('retro')).toEqual([
      '.docs/release-waivers/',
      '.docs/retros/',
      '.docs/stories/',
    ]);
  });

  it('resolveDocsAllowlist returns only always-allowed for manual_test', () => {
    expect(resolveDocsAllowlist('manual_test')).toEqual(['.docs/release-waivers/']);
  });

  it('resolveDocsAllowlist returns only always-allowed for an unknown step', () => {
    expect(resolveDocsAllowlist('some_unknown_step')).toEqual(['.docs/release-waivers/']);
  });
});
