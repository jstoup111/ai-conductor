import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { createVitest } from 'vitest/node';

import { assertSmokeDiscovery } from './smoke-capability.js';

export interface SmokeRunDependencies {
  discover: () => Promise<readonly unknown[]>;
  runVitest: () => Promise<unknown>;
}

/** Runs the smoke test command after confirming discovery is non-empty. */
export async function runSmoke({ discover, runVitest }: SmokeRunDependencies): Promise<void> {
  assertSmokeDiscovery(await discover());
  await runVitest();
}

async function discoverSmokeFiles(config: string): Promise<readonly unknown[]> {
  const vitest = await createVitest('test', {
    config: resolve(config),
    root: process.cwd(),
  });

  try {
    return await vitest.globTestFiles();
  } finally {
    await vitest.close();
  }
}

async function main(): Promise<void> {
  const config = process.argv[2] ?? 'vitest.smoke.config.ts';
  await runSmoke({
    discover: () => discoverSmokeFiles(config),
    runVitest: () => execa('vitest', ['run', '--config', config], { stdio: 'inherit' }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
