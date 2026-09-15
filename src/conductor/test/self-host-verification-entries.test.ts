import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/engine/config.js';
import type { TestSuiteConfig } from '../src/types/config.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../..');
const integrityCommand = 'test/test_harness_integrity.sh';

function expectVerificationEntries(testSuite: TestSuiteConfig | undefined): void {
  expect(testSuite?.commands, `missing ${integrityCommand} verification entry`).toEqual([
    { command: 'npm test', working_directory: 'src/conductor' },
    { command: integrityCommand, working_directory: '.' },
  ]);
}

describe('self-host verification entries', () => {
  it('loads both ordered build verification entries from the committed project config', async () => {
    const loaded = await loadConfig(repoRoot);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expectVerificationEntries(loaded.config.test_suite);
    expect(existsSync(resolve(repoRoot, integrityCommand))).toBe(true);
    expect(loaded.config.test_suite).toMatchObject({
      scoped_command: './node_modules/.bin/vitest run {selectors}',
      timeout_seconds: 1800,
      verification: { mode: 'aggregate' },
    });
  });

  it('names the missing integrity entry instead of accepting only the vitest entry', () => {
    expect(() =>
      expectVerificationEntries({ commands: [{ command: 'npm test', working_directory: 'src/conductor' }] }),
    ).toThrow(integrityCommand);
  });
});
