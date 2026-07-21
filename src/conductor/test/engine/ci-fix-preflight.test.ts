// test/engine/ci-fix-preflight.test.ts — unit coverage for preflightCiFixInvocation
//
// CF-5/CF-6 (intake #666): ci-fix startup preflight. This mirrors the acceptance
// specs in test/integration/ci-fix-resolver-autofix.test.ts (describe block
// "CF-5/CF-6: ci-fix startup preflight", ~line 211) with more granular unit
// coverage, and follows this repo's existing preflightXxx unit-test style —
// see test/engine/self-host/build-auth-preflight.test.ts (preflightBuildAuthCheck)
// and test/engine/preflight.test.ts.
//
// RED phase (T8): preflightCiFixInvocation does not exist yet in
// src/engine/ci-fix.ts. This file is expected to fail on import/undefined,
// not on a syntax or assertion-shape error. T9 wires the real implementation
// and the daemon-cli.ts startup call site.

import { describe, it, expect, vi } from 'vitest';
import { preflightCiFixInvocation } from '../../src/engine/ci-fix.js';

describe('engine/ci-fix — preflightCiFixInvocation (CF-5/CF-6)', () => {
  it('a passing probe reports { ok: true } and calls probe exactly once', async () => {
    expect(typeof preflightCiFixInvocation, 'preflightCiFixInvocation is not exported yet').toBe(
      'function',
    );

    const probe = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const result = await preflightCiFixInvocation({ probe });

    expect(result.ok).toBe(true);
    // CF-5: cheap dry probe only — no model round-trip, exactly one subprocess check.
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a failing probe (exit 127, binary missing) reports { ok: false, reason } with a classified reason', async () => {
    const probe = vi.fn().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'claude: command not found',
    });
    const result = await preflightCiFixInvocation({ probe });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
    // Reason should carry diagnostic content, not just a generic boolean flip —
    // mirrors classifyFixError's spawn-env/auth/flag-invalid/unknown vocabulary
    // (src/engine/ci-fix.ts) but the acceptance spec deliberately does not pin
    // the exact shape, so this only asserts the reason is a non-empty string
    // that surfaces the underlying stderr/exit code somehow.
    expect(typeof result.reason).toBe('string');
  });

  it('a failing probe (auth rejection) also reports { ok: false, reason }', async () => {
    const probe = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Unauthorized: authentication failed',
    });
    const result = await preflightCiFixInvocation({ probe });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a failing preflight result never throws — daemon startup (T9) reads .ok and disables ci-fix instead of crashing', async () => {
    const probe = vi.fn().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'claude: command not found',
    });

    // Deliberately no try/catch: if preflightCiFixInvocation throws here, this
    // test itself fails with an uncaught rejection — proving the contract that
    // daemon-cli.ts (T9) can safely do `const pre = await preflightCiFixInvocation(...);
    // if (!pre.ok) { disableCiFix(pre.reason); }` without wrapping it defensively.
    const result = await preflightCiFixInvocation({ probe });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('probe rejecting (thrown error) is still handled without the preflight itself throwing', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('ENOENT: spawn claude ENOENT'));

    const result = await preflightCiFixInvocation({ probe });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
