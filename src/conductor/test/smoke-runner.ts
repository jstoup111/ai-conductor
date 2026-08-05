import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { createVitest } from 'vitest/node';

import {
  SMOKE_CAPABILITIES,
  assertGateCredentialedExecution,
  assertSmokeDiscovery,
  emitSmokeOutcomeLedger,
  type SmokeCapability,
  type SmokeOutcomeLedgerEntry,
  resolveAdvisorySmokeFile,
  resolveGateSmokeFile,
} from './smoke-capability.js';

export type SmokeRunMode = 'advisory' | 'gate';

export interface DiscoveredSmokeFile {
  file: string;
  capability: SmokeCapability;
}

export interface SmokeRunDependencies {
  discover: () => Promise<readonly DiscoveredSmokeFile[]>;
  runVitest: (file: string) => Promise<unknown>;
  mode?: SmokeRunMode;
  hasCommand?: (command: string) => boolean;
  environment?: Readonly<Record<string, string | undefined>>;
  emit?: (line: string) => void;
}

/** Parses one discovered smoke file's declaration and enforces the closed capability set. */
export function parseSmokeCapabilityDeclaration(
  file: string,
  source: string,
): SmokeCapability {
  const match = source.match(/declareSmokeCapability\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)/);
  if (match === null || match[1] !== file) {
    throw new Error(`Smoke file ${file} declares no capability`);
  }
  if (!SMOKE_CAPABILITIES.includes(match[2] as SmokeCapability)) {
    throw new Error(`Smoke file ${file} declares invalid capability ${match[2]}`);
  }
  return match[2] as SmokeCapability;
}

/** Runs each discovered smoke file according to its declared capability. */
export async function runSmoke({
  discover,
  runVitest,
  mode = 'advisory',
  hasCommand = defaultHasCommand,
  environment = process.env,
  emit = console.info,
}: SmokeRunDependencies): Promise<void> {
  const files = await discover();
  assertSmokeDiscovery(files);

  const ledger: SmokeOutcomeLedgerEntry[] = [];
  const executedCapabilities: SmokeCapability[] = [];
  let failure: Error | undefined;

  for (const { file, capability } of files) {
    const resolution = mode === 'gate'
      ? resolveGateSmokeFile(file, capability, { hasCommand, environment })
      : resolveAdvisorySmokeFile(file, capability, { hasCommand, environment });
    if (resolution.outcome !== 'ran') {
      ledger.push(mode === 'gate'
        ? { file, capability, outcome: 'failed', evidencePath: resolution.unmet }
        : { file, capability, outcome: 'skipped', unmet: resolution.unmet });
      if (mode === 'gate') {
        failure ??= new Error(`Smoke gate unmet for ${file}: ${resolution.unmet}`);
      }
      continue;
    }

    try {
      await runVitest(file);
      executedCapabilities.push(capability);
      ledger.push({ file, capability, outcome: 'ran' });
    } catch (error) {
      ledger.push({ file, capability, outcome: 'failed', evidencePath: `Vitest output for ${file}` });
      failure ??= error instanceof Error ? error : new Error(String(error));
    }
  }

  emitSmokeOutcomeLedger(ledger, emit);
  if (failure !== undefined) throw failure;
  if (mode === 'gate') assertGateCredentialedExecution(executedCapabilities);
}

function defaultHasCommand(command: string): boolean {
  return command.includes('/')
    ? existsSync(resolve(process.cwd(), '..', '..', command))
    : (() => {
      try {
        execFileSync('which', [command], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();
}

async function discoverSmokeFiles(config: string): Promise<readonly DiscoveredSmokeFile[]> {
  const vitest = await createVitest('test', {
    config: resolve(config),
    root: process.cwd(),
  });

  try {
    const files = await vitest.globTestFiles();
    const { readFile } = await import('node:fs/promises');
    return Promise.all(files.map(async ({ moduleId }) => {
      const file = moduleId.slice(process.cwd().length + 1).replaceAll('\\', '/');
      const source = await readFile(moduleId, 'utf8');
      return { file, capability: parseSmokeCapabilityDeclaration(file, source) };
    }));
  } finally {
    await vitest.close();
  }
}

async function main(): Promise<void> {
  const config = process.argv[2] ?? 'vitest.smoke.config.ts';
  await runSmoke({
    discover: () => discoverSmokeFiles(config),
    runVitest: (file) => execa('vitest', ['run', '--config', config, file], { stdio: 'inherit' }),
    mode: process.env.SMOKE_MODE === 'gate' ? 'gate' : 'advisory',
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
