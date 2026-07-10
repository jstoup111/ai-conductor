import { describe, it, expect } from 'vitest';
import { resolveBuildProgressConfig } from '../src/engine/config.js';

describe('resolveBuildProgressConfig', () => {
  it('resolves defaults when build_progress block is absent', () => {
    const result = resolveBuildProgressConfig({});
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 15,
      heartbeat_minutes: 5,
      enabled: true,
    });
  });

  it('resolves defaults when build_progress is explicitly undefined', () => {
    const result = resolveBuildProgressConfig({ build_progress: undefined });
    expect(result).toEqual({
      poll_seconds: 30,
      quiet_minutes: 15,
      heartbeat_minutes: 5,
      enabled: true,
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
    });
  });
});
