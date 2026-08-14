import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

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
  source: string;
}

export interface SmokeVitestOutcome {
  executedAssertions: boolean;
  output: string;
}

export interface SmokeRunDependencies {
  discover: () => Promise<readonly DiscoveredSmokeFile[]>;
  runVitest: (file: string) => Promise<SmokeVitestOutcome>;
  mode?: SmokeRunMode;
  hasCommand?: (command: string) => boolean;
  environment?: Readonly<Record<string, string | undefined>>;
  emit?: (line: string) => void;
}

/** Parses one discovered smoke file's declaration and enforces the closed capability set. */
function parseSmokeCapabilityDeclaration(
  file: string,
  source: string,
): SmokeCapability {
  const match = source.match(/(?:export\s+)?const\s+smokeCapability\s*=\s*['\"]([^'\"]+)['\"]/);
  if (match === null) {
    throw new Error(`Smoke file ${file} declares no capability`);
  }
  if (!SMOKE_CAPABILITIES.includes(match[1] as SmokeCapability)) {
    throw new Error(`Smoke file ${file} declares invalid capability ${match[1]}`);
  }
  return match[1] as SmokeCapability;
}

/** Runs each discovered smoke file according to its declared capability. */
async function runSmoke({
  discover,
  runVitest,
  mode = 'advisory',
  hasCommand = defaultHasCommand,
  environment = process.env,
  emit = console.info,
}: SmokeRunDependencies): Promise<void> {
  const files = (await discover()).map(({ file, source }) => ({
    file,
    capability: parseSmokeCapabilityDeclaration(file, source),
  }));
  assertSmokeDiscovery(files);

  const ledger: SmokeOutcomeLedgerEntry[] = [];
  const executedCapabilities: SmokeCapability[] = [];
  let failure: Error | undefined;

  for (const { file, capability } of files) {
    const resolution = mode === 'gate'
      ? resolveGateSmokeFile(file, capability, { hasCommand, environment })
      : resolveAdvisorySmokeFile(file, capability, { hasCommand, environment });
    if (resolution.outcome !== 'ran') {
      const gateFailure = mode === 'gate' && resolution.outcome === 'failed';
      ledger.push(gateFailure
        ? { file, capability, outcome: 'failed', evidencePath: resolution.unmet }
        : { file, capability, outcome: 'skipped', unmet: resolution.unmet });
      if (gateFailure) {
        failure ??= new Error(`Smoke gate unmet for ${file}: ${resolution.unmet}`);
      }
      continue;
    }

    try {
      const outcome = await runVitest(file);
      if (outcome.output.length > 0) emit(outcome.output);
      if (outcome.executedAssertions) {
        executedCapabilities.push(capability);
        ledger.push({ file, capability, outcome: 'ran' });
      } else {
        ledger.push({ file, capability, outcome: 'skipped', unmet: 'no Vitest assertions executed' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.length > 0) emit(message);
      ledger.push({ file, capability, outcome: 'failed', evidencePath: `Vitest output for ${file}` });
      failure ??= error instanceof Error ? error : new Error(message);
    }
  }

  emitSmokeOutcomeLedger(ledger, emit);
  if (failure !== undefined) throw failure;
  if (mode === 'gate') assertGateCredentialedExecution(executedCapabilities);
}

interface VitestJsonReport {
  numPassedTests: number;
}

function parseVitestOutcome(output: string): SmokeVitestOutcome {
  const report = JSON.parse(output) as Partial<VitestJsonReport>;
  if (typeof report.numPassedTests !== 'number') {
    throw new Error('Vitest JSON report does not include numPassedTests');
  }
  return { executedAssertions: report.numPassedTests > 0, output };
}

async function runVitestWithReport(file: string, config: string): Promise<SmokeVitestOutcome> {
  const reportDirectory = await mkdtemp(join(tmpdir(), 'ai-conductor-smoke-report-'));
  const reportPath = join(reportDirectory, 'vitest.json');
  try {
    const result = await execa(
      'vitest',
      ['run', '--config', config, '--reporter=json', '--outputFile', reportPath, file],
      { all: true, reject: false },
    );
    const report = await readFile(reportPath, 'utf8').catch(() => '');
    const output = result.all.length > 0 ? `${result.all}\n${report}` : report;
    if (result.exitCode !== 0) {
      throw new Error(output.length > 0 ? output : `Vitest exited ${result.exitCode} for ${file}`);
    }
    const outcome = parseVitestOutcome(report);
    return {
      ...outcome,
      output,
    };
  } finally {
    await rm(reportDirectory, { recursive: true, force: true });
  }
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

interface SmokeDiscoveryVitest {
  globTestFiles(): Promise<readonly { moduleId: string }[]>;
  close(): Promise<void>;
}

export interface SmokeDiscoveryDependencies {
  createTempDir?: (prefix: string) => Promise<string>;
  createVitest?: (mode: 'test', options: { config: string; root: string }) => Promise<SmokeDiscoveryVitest>;
  readFile?: (path: string) => Promise<string>;
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
}

/** Discovers smoke files in an isolated Vitest workspace. */
export async function discoverSmokeFiles(
  config: string,
  dependencies: SmokeDiscoveryDependencies = {},
): Promise<readonly DiscoveredSmokeFile[]> {
  const createTempDir = dependencies.createTempDir ?? (prefix => mkdtemp(prefix));
  const createDiscoveryVitest = dependencies.createVitest
    ?? ((mode, options) => createVitest(mode, options));
  const readDiscoveredFile = dependencies.readFile ?? (path => readFile(path, 'utf8'));
  const remove = dependencies.remove ?? ((path, options) => rm(path, options));
  const parentRunTmpRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
  const parentTmpdir = process.env.TMPDIR;
  const discoveryTmpRoot = await createTempDir(join(tmpdir(), 'ai-conductor-smoke-discovery-'));
  let vitest: SmokeDiscoveryVitest | undefined;

  try {
    // Vitest allocates its own workspace tmpdir while constructing the project,
    // before it evaluates the smoke config's tmpdir redirect. Isolate discovery
    // first, then restore the caller environment before dispatching each child:
    // every child must create and tear down its own run root.
    delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    process.env.TMPDIR = discoveryTmpRoot;
    vitest = await createDiscoveryVitest('test', {
      config: resolve(config),
      root: process.cwd(),
    });
    const files = await vitest.globTestFiles();
    return Promise.all(files.map(async ({ moduleId }) => {
      const file = relative(process.cwd(), moduleId).replaceAll('\\', '/');
      const source = await readDiscoveredFile(moduleId);
      return { file, source };
    }));
  } finally {
    try {
      await vitest?.close();
    } finally {
      if (parentRunTmpRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = parentRunTmpRoot;
      if (parentTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = parentTmpdir;
      await remove(discoveryTmpRoot, { recursive: true, force: true });
    }
  }
}

export async function runSmokeCli(
  config = 'vitest.smoke.config.ts',
  dependencies: Partial<SmokeRunDependencies> = {},
): Promise<void> {
  await runSmoke({
    discover: dependencies.discover ?? (() => discoverSmokeFiles(config)),
    runVitest: dependencies.runVitest ?? ((file) => runVitestWithReport(file, config)),
    mode: dependencies.mode ?? (process.env.SMOKE_MODE === 'gate' ? 'gate' : 'advisory'),
    hasCommand: dependencies.hasCommand,
    environment: dependencies.environment,
    emit: dependencies.emit,
  });
}
