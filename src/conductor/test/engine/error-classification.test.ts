/**
 * Tests for classifyFixError (CF-4): a spawn failure from the ci-fix resolver
 * must map to one of `flag-invalid` | `auth` | `spawn-env` | `unknown`, and
 * any log line built from it must include both the classification tag and
 * the underlying error message — not just the bare ExecaError string.
 *
 * RED phase: classifyFixError does not exist yet in ci-fix.ts.
 */

import { describe, it, expect } from 'vitest';
import { classifyFixError } from '../../src/engine/ci-fix.js';

describe('classifyFixError', () => {
  it('classifies an unrecognized CLI flag error as flag-invalid', () => {
    const err = new Error("unknown option '--fix-session'");
    expect(classifyFixError(err)).toBe('flag-invalid');
  });

  it('classifies an authentication failure as auth', () => {
    const err = new Error('Request failed with status 401: not authenticated');
    expect(classifyFixError(err)).toBe('auth');
  });

  it('classifies a spawn/environment failure as spawn-env', () => {
    const err = new Error('spawn claude ENOENT');
    expect(classifyFixError(err)).toBe('spawn-env');
  });

  it('classifies an unrecognized error as unknown', () => {
    const err = new Error('something unexpected happened deep in the process');
    expect(classifyFixError(err)).toBe('unknown');
  });

  it('produces a log line with both the classification tag and the underlying message, not just a bare error dump', () => {
    const err = new Error('spawn claude ENOENT');
    const tag = classifyFixError(err);
    const logLine = `ci-fix failed [${tag}]: ${err.message}`;

    expect(logLine).toContain('spawn-env');
    expect(logLine).toContain('ENOENT');
    // must be more informative than the bare stringified error alone
    expect(logLine).not.toBe(String(err));
  });
});
