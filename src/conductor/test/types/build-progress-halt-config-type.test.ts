import { describe, it, expect } from 'vitest';
import type { HarnessConfig, BuildProgressHaltConfig } from '../../src/types/config.js';

describe('BuildProgressHaltConfig type on HarnessConfig', () => {
  it('accepts a typed build_progress_halt field with all fields set', () => {
    const cfg: HarnessConfig = {
      build_progress_halt: { enabled: true, attempt_ceiling: 5, dispatch_ceiling: 3 },
    };
    expect(cfg.build_progress_halt).toBeDefined();
    expect(cfg.build_progress_halt?.enabled).toBe(true);
    expect(cfg.build_progress_halt?.attempt_ceiling).toBe(5);
    expect(cfg.build_progress_halt?.dispatch_ceiling).toBe(3);
  });

  it('build_progress_halt field is optional on HarnessConfig', () => {
    const cfg: HarnessConfig = {};
    expect(cfg.build_progress_halt).toBeUndefined();
  });

  it('BuildProgressHaltConfig type is exported and usable directly with no fields set', () => {
    const haltCfg: BuildProgressHaltConfig = {};
    expect(haltCfg.enabled).toBeUndefined();
    expect(haltCfg.attempt_ceiling).toBeUndefined();
    expect(haltCfg.dispatch_ceiling).toBeUndefined();
  });
});
