import { runSmokeCommand } from '../src/engine/smoke-runner.js';

await runSmokeCommand(process.argv.slice(2));
