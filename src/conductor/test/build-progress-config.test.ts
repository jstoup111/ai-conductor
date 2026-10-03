import { describe, it, expect } from 'vitest';
import { resolveBuildProgressConfig, validateConfig } from '../src/engine/config.js';

describe('resolveBuildProgressConfig', () => {
  it('resolves defaults when build_progress block is absent', () => {
    const result = resolveBuildProgressConfig({});
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 15,
      heartbeat_minutes: 5,
      enabled: true,
      active_stall_minutes: 45,
      active_stall_action: 'warn',
    });
  });

  it('resolves defaults when build_progress is explicitly undefined', () => {
    const result = resolveBuildProgressConfig({ build_progress: undefined });
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 15,
      heartbeat_minutes: 5,
      enabled: true,
      active_stall_minutes: 45,
      active_stall_action: 'warn',
    });
  });

  it('keeps other defaults when only a partial block is given', () => {
    const result = resolveBuildProgressConfig({
      build_progress: { quiet_minutes: 45 },
    });
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 45,
      heartbeat_minutes: 5,
      enabled: true,
      active_stall_minutes: 45,
      active_stall_action: 'warn',
    });
  });

  it('respects an explicit enabled: false override', () => {
    const result = resolveBuildProgressConfig({
      build_progress: { enabled: false },
    });
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 15,
      heartbeat_minutes: 5,
      enabled: false,
      active_stall_minutes: 45,
      active_stall_action: 'warn',
    });
  });

  it('resolves a fully specified block as-is', () => {
    const result = resolveBuildProgressConfig({
      build_progress: {
        poll_seconds: 10,
        quiet_minutes: 20,
        heartbeat_minutes: 2,
        enabled: false,
      },
    });
    expect(result).toEqual({
      poll_seconds: 10,
      quiet_minutes: 20,
      heartbeat_minutes: 2,
      enabled: false,
      active_stall_minutes: 45,
      active_stall_action: 'warn',
    });
  });
});

describe('validateConfig — build_progress fail-closed validation', () => {
  it('accepts and resolves explicit active-stall settings', () => {
    const validated = validateConfig({
      build_progress: { active_stall_minutes: 90, active_stall_action: 'end_attempt' },
    });

    expect(validated).toMatchObject({ ok: true });
    if (!validated.ok) return;
    expect(resolveBuildProgressConfig(validated.config)).toMatchObject({
      active_stall_minutes: 90,
      active_stall_action: 'end_attempt',
    });
  });

  it.each([0, -5, 'x'])('rejects active_stall_minutes %j', (active_stall_minutes) => {
    const result = validateConfig({ build_progress: { active_stall_minutes } });

    expect(result.ok ? 'accepted invalid active stall bound' : result.error.message)
      .toMatch(/build_progress\.active_stall_minutes must be a positive number/);
  });

  it('rejects an unknown active_stall_action with its allowed values', () => {
    const result = validateConfig({ build_progress: { active_stall_action: 'kill' } });

    expect(result.ok ? 'accepted invalid active stall action' : result.error.message)
      .toMatch(/build_progress\.active_stall_action.*warn.*end_attempt/);
  });

  it('rejects a poll interval exceeding the active-stall bound', () => {
    const result = validateConfig({
      build_progress: { poll_seconds: 600, active_stall_minutes: 5 },
    });

    expect(result.ok ? 'accepted poll interval beyond active stall bound' : result.error.message)
      .toMatch(/poll_seconds.*must not exceed.*active_stall_minutes/);
  });

  it('rejects a poll interval exceeding the resolved default active-stall bound', () => {
    const result = validateConfig({
      build_progress: { poll_seconds: 3_000, quiet_minutes: 60 },
    });

    expect(result.ok ? 'accepted poll interval beyond default active stall bound' : result.error.message)
      .toBe('build_progress.poll_seconds (3000s) must not exceed build_progress.active_stall_minutes (45m = 2700s)');
  });

  it('reports an unknown active-stall key through the build_progress unknown-key path', () => {
    const result = validateConfig({ build_progress: { active_stall_minuts: 45 } });

    expect(result.ok ? 'accepted unknown build_progress key' : result.error.message)
      .toBe('Unknown key in build_progress: "active_stall_minuts"');
  });

  it('rejects poll_seconds: 0', () => {
    const result = validateConfig({ build_progress: { poll_seconds: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/poll_seconds/);
    }
  });

  it('rejects quiet_minutes: -5', () => {
    const result = validateConfig({ build_progress: { quiet_minutes: -5 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/quiet_minutes/);
    }
  });

  it('rejects heartbeat_minutes: "fast"', () => {
    const result = validateConfig({ build_progress: { heartbeat_minutes: 'fast' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/heartbeat_minutes/);
    }
  });

  it('rejects poll_seconds exceeding the quiet_minutes window', () => {
    const result = validateConfig({
      build_progress: { poll_seconds: 1200, quiet_minutes: 15 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/poll_seconds/);
      expect(result.error.message).toMatch(/quiet_minutes/);
    }
  });
});
