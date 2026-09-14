import type { HarnessConfig } from '../../../src/types/config.js';

const config: HarnessConfig = {
  test_suite: {
    commands: [{ command: 'npm run test:unit', suite_name: 'unit' }],
  },
};

void config;
