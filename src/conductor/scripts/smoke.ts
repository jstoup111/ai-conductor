import { rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installVitestTmpRoot,
  restoreVitestTmpEnvironment,
  VITEST_TMP_ROOT_ENV,
} from './vitest-temp.mjs';
import type { runSmokeCommand } from '../src/engine/smoke-runner.js';

type SmokeCommand = typeof runSmokeCommand;
type SmokeCommandLoader = () => Promise<{ runSmokeCommand: SmokeCommand }>;

const loadSmokeCommand: SmokeCommandLoader = () => import('../src/engine/smoke-runner.js');

export async function runSmokeEntryPoint(
  arguments_ = process.argv.slice(2),
  loadCommand: SmokeCommandLoader = loadSmokeCommand,
): Promise<void> {
  const installation = installVitestTmpRoot({ fresh: true });
  const callerPath = process.env.PATH;
  try {
    delete process.env[VITEST_TMP_ROOT_ENV];
    process.env.PATH = [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin'),
      callerPath,
    ].filter((value): value is string => value !== undefined && value !== '').join(delimiter);
    const { runSmokeCommand } = await loadCommand();
    await runSmokeCommand(arguments_);
  } finally {
    try {
      if (installation.ownsScope) {
        rmSync(installation.scope, { recursive: true, force: true });
      }
    } finally {
      if (callerPath === undefined) delete process.env.PATH;
      else process.env.PATH = callerPath;
      restoreVitestTmpEnvironment(installation.environment);
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runSmokeEntryPoint();
}
