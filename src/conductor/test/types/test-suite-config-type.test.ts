import { describe, it, expect } from 'vitest';
import type { HarnessConfig, TestSuiteConfig } from '../../src/types/config.js';

describe('TestSuiteConfig type on HarnessConfig', () => {
  it('declares every aggregate suite field', () => {
    const testSuite: TestSuiteConfig = {
      command: 'npm test',
      working_directory: 'src/conductor',
      timeout_seconds: 1800,
      inputs: ['test-support/**'],
      environment: ['CI', 'DATABASE_URL'],
    };
    const config: HarnessConfig = { test_suite: testSuite };

    expect(config.test_suite).toEqual(testSuite);
  });
});
