import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isEnforcementConfigured,
  markerPath,
  writeBuildStepMarker,
  removeBuildStepMarker,
} from '../../src/engine/attribution-enforcement.js';
import type { HarnessConfig } from '../../src/types/config.js';

// #505 TS-2: enforcement predicate + marker file helpers. The marker file is
// the session-hook-visible signal that inline build work is in flight so
// commits made during that window can be attributed correctly.

describe('isEnforcementConfigured', () => {
  it('returns false when attribution_enforcement_cutover is absent', () => {
    const config = {} as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it('returns true when cutover is in the past', () => {
    const config = { attribution_enforcement_cutover: '2026-01-01T00:00:00Z' } as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(true);
  });

  it('returns false when cutover is in the future', () => {
    const config = { attribution_enforcement_cutover: '2027-01-01T00:00:00Z' } as HarnessConfig;
    expect(isEnforcementConfigured(config, new Date('2026-07-10T00:00:00Z'))).toBe(false);
  });

  it('returns true when cutover is exactly now (boundary, on/after)', () => {
    const now = new Date('2026-07-10T00:00:00Z');
    const config = { attribution_enforcement_cutover: now.toISOString() } as HarnessConfig;
    expect(isEnforcementConfigured(config, now)).toBe(true);
  });
});

describe('markerPath', () => {
  it('returns .pipeline/build-step-active relative to root', () => {
    expect(markerPath('/some/root')).toBe(join('/some/root', '.pipeline', 'build-step-active'));
  });

  it('throws on empty root', () => {
    expect(() => markerPath('')).toThrow();
  });
});

describe('writeBuildStepMarker / removeBuildStepMarker', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'attribution-enforcement-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes an ISO-8601 timestamp to the marker file', () => {
    const now = new Date('2026-07-10T12:34:56.000Z');
    writeBuildStepMarker(root, now);
    const path = markerPath(root);
    expect(existsSync(path)).toBe(true);
    const contents = readFileSync(path, 'utf8').trim();
    expect(contents).toBe(now.toISOString());
  });

  it('creates the .pipeline directory if absent', () => {
    writeBuildStepMarker(root, new Date());
    expect(existsSync(join(root, '.pipeline'))).toBe(true);
  });

  it('removes the marker file', () => {
    writeBuildStepMarker(root, new Date());
    const path = markerPath(root);
    expect(existsSync(path)).toBe(true);
    removeBuildStepMarker(root);
    expect(existsSync(path)).toBe(false);
  });

  it('remove is idempotent — no error if marker absent', () => {
    expect(existsSync(markerPath(root))).toBe(false);
    expect(() => removeBuildStepMarker(root)).not.toThrow();
    expect(() => removeBuildStepMarker(root)).not.toThrow();
  });
});
