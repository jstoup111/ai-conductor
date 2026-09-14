import type { HarnessConfig } from '../../../src/types/config.js';

const config: HarnessConfig = {
  test_suite: {
    commands: [
      { command: 'npm run test:unit' },
      {
        command: 'npm run test:integration',
        working_directory: 'src/conductor',
        timeout_seconds: 1800,
      },
    ],
  },
};

void config;
