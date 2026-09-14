import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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

  const resolvedEntries = entries.map((entry) => ({
    command: entry.command,
    working_directory: resolve(
      testSuite.project_root,
      entry.working_directory ?? testSuite.working_directory ?? '.',
    ),
    timeout_seconds:
      entry.timeout_seconds ?? testSuite.timeout_seconds ?? defaultTimeoutSeconds,
  }));

  for (const [index, entry] of resolvedEntries.entries()) {
    assertContainedDirectory(testSuite.project_root, entry.working_directory, index);
  }
  return resolvedEntries;
}

function assertContainedDirectory(projectRoot: string, directory: string, index: number): void {
  const field = `test_suite.commands[${index}].working_directory`;
  const root = resolve(projectRoot);
  const lexicalRelative = relative(root, directory);
  if (
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new Error(`${field} must resolve to a directory within the project root`);
  }

  try {
    const [realRoot, realDirectory] = [realpathSync(root), realpathSync(directory)];
    const realRelative = relative(realRoot, realDirectory);
    if (
      realRelative === '..' ||
      realRelative.startsWith(`..${sep}`) ||
      isAbsolute(realRelative) ||
      !statSync(realDirectory).isDirectory()
    ) {
      throw new Error(`${field} must resolve to a directory within the project root`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(field)) throw error;
    throw new Error(`${field} must resolve to a directory within the project root`);
  }
}
