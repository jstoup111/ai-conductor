import { runSmokeCommand } from '../src/engine/smoke-runner.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runSmokeEntryPoint(
  arguments_ = process.argv.slice(2),
  command: typeof runSmokeCommand = runSmokeCommand,
): Promise<void> {
  await command(arguments_);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runSmokeEntryPoint();
}
