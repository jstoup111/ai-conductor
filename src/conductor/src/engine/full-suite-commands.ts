import { resolve } from 'node:path';
import { DEFAULT_FULL_SUITE_TIMEOUT_MS } from './full-suite-executor.js';
import type { TestSuiteConfig } from '../types/config.js';

export interface FullSuiteCommandEntry {
  command: string;
  working_directory: string;
  timeout_seconds: number;
}

export function resolveFullSuiteCommandEntries(
  testSuite: { project_root: string } & TestSuiteConfig,
): FullSuiteCommandEntry[] {
  const entries = testSuite.commands ?? [];
  const defaultTimeoutSeconds = DEFAULT_FULL_SUITE_TIMEOUT_MS / 1_000;

  return entries.map((entry) => ({
    command: entry.command,
    working_directory: resolve(
      testSuite.project_root,
      entry.working_directory ?? testSuite.working_directory ?? '.',
    ),
    timeout_seconds:
      entry.timeout_seconds ?? testSuite.timeout_seconds ?? defaultTimeoutSeconds,
  }));
}
