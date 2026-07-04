import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/engine/config.js';
import {
  DEFAULT_SELF_HOST_ACTIVATION,
  resolveSelfHostConfig,
} from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

// Phase 0 (TR-11): the `harness_self_host` config block — validation + resolution.
// Absent/partial config must default to the SAFE posture: auto-detect, all gates ON.

describe('config — harness_self_host validation (TR-11)', () => {
  it('accepts a well-formed block (activation + per-gate booleans)', () => {
    const raw: HarnessConfig = {
      harness_self_host: {
        activation: 'auto',
        skill_relink_preflight: true,
        sandbox_build_env: true,
        version_approval_gate: false,
        release_artifact_gate: true,
      },
    };
    const result = validateConfig(raw);
    expect(result.ok).toBe(true);
  });

  it('accepts each activation value (auto / force_on / force_off)', () => {
    for (const activation of ['auto', 'force_on', 'force_off'] as const) {
      const result = validateConfig({ harness_self_host: { activation } });
      expect(result.ok, `activation=${activation}`).toBe(true);
    }
  });

  it('accepts config with no harness_self_host block', () => {
    const result = validateConfig({ defaults: { model: 'sonnet' } });
    expect(result.ok).toBe(true);
  });

  it('rejects an unrecognized activation value with a keyed error naming allowed values', () => {
    const result = validateConfig({
      harness_self_host: { activation: 'yes' as never },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('activation');
    expect(result.error.message).toMatch(/auto.*force_on.*force_off/);
  });

  it('rejects a non-boolean gate toggle with a keyed error naming the offending key', () => {
    const result = validateConfig({
      harness_self_host: { sandbox_build_env: 'true' as never },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('sandbox_build_env');
  });

  it('rejects an unknown key under harness_self_host (catches typo\'d gate names)', () => {
    const result = validateConfig({
      harness_self_host: { sandbox_buld_env: true as never },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('sandbox_buld_env');
  });

  it('rejects a non-object harness_self_host block', () => {
    const result = validateConfig({ harness_self_host: 'on' as never });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('harness_self_host');
  });

  it('accepts a version_freeze string (#261)', () => {
    const result = validateConfig({ harness_self_host: { version_freeze: '0.99.19' } });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-string or blank version_freeze with a keyed error (#261)', () => {
    for (const bad of [true, 42, '   '] as const) {
      const result = validateConfig({
        harness_self_host: { version_freeze: bad as never },
      });
      expect(result.ok, `version_freeze=${String(bad)}`).toBe(false);
      if (result.ok) continue;
      expect(result.error.message).toContain('version_freeze');
    }
  });
});

describe('resolved-config — resolveSelfHostConfig (TR-11 safe defaults)', () => {
  it('exports DEFAULT_SELF_HOST_ACTIVATION = auto', () => {
    expect(DEFAULT_SELF_HOST_ACTIVATION).toBe('auto');
  });

  it('absent block → activation auto, ALL gates ON, no freeze', () => {
    const resolved = resolveSelfHostConfig();
    expect(resolved).toEqual({
      activation: 'auto',
      skillRelinkPreflight: true,
      sandboxBuildEnv: true,
      versionApprovalGate: true,
      releaseArtifactGate: true,
      versionFreeze: null,
      authParkTimeoutMinutes: 60,
    });
  });

  it('config without the block → all gates ON', () => {
    const resolved = resolveSelfHostConfig({ defaults: { model: 'sonnet' } });
    expect(resolved.activation).toBe('auto');
    expect(resolved.skillRelinkPreflight).toBe(true);
    expect(resolved.sandboxBuildEnv).toBe(true);
    expect(resolved.versionApprovalGate).toBe(true);
    expect(resolved.releaseArtifactGate).toBe(true);
  });

  it('partial block (only activation set) → omitted gates default ON', () => {
    const resolved = resolveSelfHostConfig({
      harness_self_host: { activation: 'force_on' },
    });
    expect(resolved.activation).toBe('force_on');
    expect(resolved.skillRelinkPreflight).toBe(true);
    expect(resolved.sandboxBuildEnv).toBe(true);
    expect(resolved.versionApprovalGate).toBe(true);
    expect(resolved.releaseArtifactGate).toBe(true);
  });

  it('explicit gate disable is honored (only that gate flips; others stay ON)', () => {
    const resolved = resolveSelfHostConfig({
      harness_self_host: { activation: 'force_off', version_approval_gate: false },
    });
    expect(resolved.activation).toBe('force_off');
    expect(resolved.versionApprovalGate).toBe(false);
    expect(resolved.releaseArtifactGate).toBe(true);
    expect(resolved.sandboxBuildEnv).toBe(true);
  });

  it('version_freeze resolves trimmed; absent or blank → null (#261)', () => {
    expect(
      resolveSelfHostConfig({ harness_self_host: { version_freeze: ' 0.99.19\n' } }).versionFreeze,
    ).toBe('0.99.19');
    expect(resolveSelfHostConfig({ harness_self_host: {} }).versionFreeze).toBeNull();
    expect(
      resolveSelfHostConfig({ harness_self_host: { version_freeze: '   ' } }).versionFreeze,
    ).toBeNull();
  });
});
