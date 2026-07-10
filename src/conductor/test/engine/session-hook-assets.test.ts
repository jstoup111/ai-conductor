import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRE_DISPATCH_HOOK,
  POST_DISPATCH_HOOK,
} from '../../src/engine/session-hook-assets.js';

function assertValidBash(name: string, script: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'session-hook-assets-'));
  try {
    const file = join(dir, name);
    writeFileSync(file, script, 'utf-8');
    // Throws if bash -n reports a syntax error.
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('session-hook-assets', () => {
  const hooks: Array<[string, string]> = [
    ['PRE_DISPATCH_HOOK', PRE_DISPATCH_HOOK],
    ['POST_DISPATCH_HOOK', POST_DISPATCH_HOOK],
  ];

  it.each(hooks)('%s is a non-empty string', (_name, script) => {
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it.each(hooks)('%s starts with a bash shebang', (_name, script) => {
    expect(script.startsWith('#!/bin/bash')).toBe(true);
  });

  it.each(hooks)('%s passes bash -n syntax check', (name, script) => {
    expect(() => assertValidBash(name, script)).not.toThrow();
  });
});
