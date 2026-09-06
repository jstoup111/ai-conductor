import { describe, expect, it, vi } from 'vitest';
import {
  GH_VERSION_FLOOR,
  checkGhVersionFloor,
  parseGhVersion,
  probeGhVersion,
} from '../src/engine/gh-version-floor.js';

describe('gh version floor', () => {
  it.each([
    ['gh version 2.73.0 (2025-05-19)\nhttps://example.test', { major: 2, minor: 73, patch: 0 }],
    ['gh version 2.14.1 (2022-07-12)', { major: 2, minor: 14, patch: 1 }],
    ['gh version 2.100.0', { major: 2, minor: 100, patch: 0 }],
  ])('parses the gh banner first line', (banner, expected) => {
    expect(parseGhVersion(banner)).toEqual(expected);
  });

  it('rejects an empty or non-gh first line even if a later line looks valid', () => {
    expect(parseGhVersion('')).toBeNull();
    expect(parseGhVersion('not gh\ngh version 2.73.0')).toBeNull();
  });

  it('defines prerelease and metadata comparison', () => {
    expect(checkGhVersionFloor('gh version 2.73.0-beta.1').kind).toBe('below-floor');
    expect(checkGhVersionFloor('gh version 2.73.0+build.5').kind).toBe('ok');
  });

  it.each([
    ['gh version 2.73.0', 'ok'],
    ['gh version 2.100.0', 'ok'],
    ['gh version 2.72.9', 'below-floor'],
    ['gh version 2.18.0', 'below-floor'],
    ['gh version 2.14.1', 'below-floor'],
    ['unknown', 'unparseable'],
  ])('returns the closed verdict for %s', (banner, kind) => {
    expect(checkGhVersionFloor(banner).kind).toBe(kind);
  });

  it('keeps the floor fixed outside configuration', () => {
    expect(GH_VERSION_FLOOR).toEqual({ major: 2, minor: 73, patch: 0 });
    expect(process.env.GH_VERSION_FLOOR).toBeUndefined();
  });

  it('uses injected output and refuses failed, absent, silent, or timed-out probes', async () => {
    await expect(probeGhVersion(async () => ({ stdout: 'gh version 2.73.0' }))).resolves.toMatchObject({ kind: 'ok' });
    await expect(probeGhVersion(async () => ({ stdout: '', exitCode: 1 }))).resolves.toEqual({ kind: 'unparseable' });
    await expect(probeGhVersion(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); })).resolves.toEqual({ kind: 'absent' });
    await expect(probeGhVersion(() => new Promise(() => {}), 1)).resolves.toEqual({ kind: 'timeout' });
  });

  it('passes the injected runner banner directly to the version-floor check', async () => {
    const banner = 'gh version 2.100.0 (2026-09-01)';
    const runner = vi.fn(async () => ({ stdout: banner }));

    await expect(probeGhVersion(runner)).resolves.toEqual(checkGhVersionFloor(banner));
    expect(runner).toHaveBeenCalledOnce();
  });

  it('rethrows the production real-exec guard instead of converting it to a verdict', async () => {
    await expect(probeGhVersion()).rejects.toThrow(
      "tracker-client: real 'gh' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC",
    );
  });
});
