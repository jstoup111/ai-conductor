// Covers: task:1
import { describe, expect, it } from 'vitest';

import { validateConfig } from '../../src/engine/config.js';

describe('test_suite.pre_check validation', () => {
  const preCheck = [
    { command: 'npm run format:check --silent', working_directory: 'src/conductor' },
    { command: 'npm run typecheck --silent', timeout_seconds: 120 },
  ];

  it('accepts a list of command entries unchanged', () => {
    const result = validateConfig({ test_suite: { command: 'npm test', pre_check: preCheck } });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.test_suite?.pre_check).toEqual(preCheck);
  });

  it('refuses an empty list', () => {
    const result = validateConfig({ test_suite: { command: 'npm test', pre_check: [] } });

    expect(result).toMatchObject({
      ok: false,
      error: { type: 'validation_error', message: 'test_suite.pre_check must be a non-empty array' },
    });
  });

  it('refuses an empty command or an unknown key, naming the entry', () => {
    for (const entry of [{ command: '' }, { command: 'npm run lint', shell: 'bash' }]) {
      const result = validateConfig({ test_suite: { command: 'npm test', pre_check: [entry] } });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.type).toBe('validation_error');
      expect(!result.ok && result.error.message).toContain('test_suite.pre_check[0]');
    }
  });
});
