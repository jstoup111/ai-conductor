// Covers: task:1
import { describe, it, expect } from 'vitest';
import type {
  AggregateTestSuiteConfig,
  HarnessConfig,
  TestSuiteConfig,
} from '../../src/types/config.js';

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

  it('declares an ordered command list without suite names or runner identifiers', () => {
    const testSuite: TestSuiteConfig = {
      commands: [
        { command: 'npm run test:unit' },
        {
          command: 'npm run test:integration',
          working_directory: 'src/conductor',
          timeout_seconds: 1800,
        },
      ],
    };
    const config: HarnessConfig = { test_suite: testSuite };

    expect(config.test_suite?.commands).toEqual(testSuite.commands);
  });

  it('admits an ordered command list as an aggregate suite form', () => {
    const testSuite: AggregateTestSuiteConfig = {
      commands: [{ command: 'npm run test:unit' }],
    };

    expect(testSuite.commands).toEqual([{ command: 'npm run test:unit' }]);
  });
});
