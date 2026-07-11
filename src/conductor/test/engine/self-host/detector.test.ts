import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PathSelfHostDetector,
  classifySelfHost,
  defaultSelfHostDetector,
  type SelfHostDetector,
} from '../../../src/engine/self-host/detector.js';
import type { HarnessConfig } from '../../../src/types/config.js';

// Phase 1 (TR-1/2/3): the SelfHostDetector seam. Identity is by RESOLVED PATH,
// never repo name. Activation is positive-only — anything uncertain → false
// (unchanged normal path). Config override layers on top of path detection.

describe('self-host/detector — PathSelfHostDetector (TR-1)', () => {
  let root: string; // stands in for the harness root
  let other: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sh-root-'));
    other = await mkdtemp(join(tmpdir(), 'sh-other-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });

  it('equal realpaths → isSelfHost true', async () => {
    const det = new PathSelfHostDetector(async () => root);
    expect(await det.isSelfHost(root)).toBe(true);
  });

  it('different realpaths → isSelfHost false', async () => {
    const det = new PathSelfHostDetector(async () => root);
    expect(await det.isSelfHost(other)).toBe(false);
  });

  it('null harness root → false and emits a single debug line', async () => {
    const lines: string[] = [];
    const det = new PathSelfHostDetector(async () => null, (m) => lines.push(m));
    expect(await det.isSelfHost(root)).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('harness root');
  });

  it('trailing-slash difference → still true (normalized)', async () => {
    const det = new PathSelfHostDetector(async () => root);
    expect(await det.isSelfHost(root + '/')).toBe(true);
  });

  it('symlinked path segment → still true (realpath resolves the link)', async () => {
    const link = join(other, 'link-to-root');
    await symlink(root, link);
    const det = new PathSelfHostDetector(async () => root);
    expect(await det.isSelfHost(link)).toBe(true);
  });

  it('same basename, different parent → false (identity by path, not name)', async () => {
    const parentA = await mkdtemp(join(tmpdir(), 'sh-a-'));
    const parentB = await mkdtemp(join(tmpdir(), 'sh-b-'));
    const harnessLike = join(parentA, 'james-stoup-agents');
    const impostor = join(parentB, 'james-stoup-agents');
    await mkdir(harnessLike);
    await mkdir(impostor);
    try {
      const det = new PathSelfHostDetector(async () => harnessLike);
      expect(await det.isSelfHost(impostor)).toBe(false);
    } finally {
      await rm(parentA, { recursive: true, force: true });
      await rm(parentB, { recursive: true, force: true });
    }
  });

  it('a non-existent build path → false (unresolvable, not a crash)', async () => {
    const det = new PathSelfHostDetector(async () => root);
    expect(await det.isSelfHost(join(root, 'does-not-exist'))).toBe(false);
  });

  it('regression lock (#363 / TR-5): a worktree-run self-build still classifies as self-host', async () => {
    // The installed-root split (resolveInstalledHarnessRoot) must NOT change
    // detection: for an engine running from a worktree's dist, the probe
    // resolves the WORKTREE, the build repo IS that worktree, and detection
    // returned true during the incident — flipping this to false would
    // silently disable the sandbox and every self-host gate.
    const worktree = join(root, '.worktrees', 'some-feature');
    await mkdir(worktree, { recursive: true });
    const det = new PathSelfHostDetector(async () => worktree);
    expect(await det.isSelfHost(worktree)).toBe(true);
  });
});

describe('self-host/detector — classifySelfHost config override (TR-2)', () => {
  let root: string;
  let other: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sh-root-'));
    other = await mkdtemp(join(tmpdir(), 'sh-other-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });

  const pathDet = () => new PathSelfHostDetector(async () => root);

  it('force_on → true for ANY repo (even a non-harness path)', async () => {
    const config: HarnessConfig = { harness_self_host: { activation: 'force_on' } };
    expect(await classifySelfHost(pathDet(), config, other)).toBe(true);
  });

  it('force_off → false even for the harness repo itself', async () => {
    const config: HarnessConfig = { harness_self_host: { activation: 'force_off' } };
    expect(await classifySelfHost(pathDet(), config, root)).toBe(false);
  });

  it('auto → delegates to path detection (true for harness, false otherwise)', async () => {
    const config: HarnessConfig = { harness_self_host: { activation: 'auto' } };
    expect(await classifySelfHost(pathDet(), config, root)).toBe(true);
    expect(await classifySelfHost(pathDet(), config, other)).toBe(false);
  });

  it('absent config → auto (path detection)', async () => {
    expect(await classifySelfHost(pathDet(), undefined, root)).toBe(true);
    expect(await classifySelfHost(pathDet(), undefined, other)).toBe(false);
  });
});

describe('self-host/detector — swappable seam (TR-3)', () => {
  it('a stub detector implementing the interface drives classification unchanged', async () => {
    const stubTrue: SelfHostDetector = { isSelfHost: async () => true };
    const stubFalse: SelfHostDetector = { isSelfHost: async () => false };
    // No config override → classification follows the injected detector's boolean.
    expect(await classifySelfHost(stubTrue, undefined, '/any/path')).toBe(true);
    expect(await classifySelfHost(stubFalse, undefined, '/any/path')).toBe(false);
  });

  it('force_on/force_off override the injected detector (config wins over the seam)', async () => {
    const stubFalse: SelfHostDetector = { isSelfHost: async () => false };
    const on: HarnessConfig = { harness_self_host: { activation: 'force_on' } };
    expect(await classifySelfHost(stubFalse, on, '/any')).toBe(true);
  });

  it('defaultSelfHostDetector returns a concrete PathSelfHostDetector (no null-seam)', () => {
    const det = defaultSelfHostDetector();
    expect(det).toBeInstanceOf(PathSelfHostDetector);
  });
});
