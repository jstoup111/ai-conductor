import { runSmokeCli } from '../src/engine/smoke-runner.js';

await runSmokeCli(process.argv[2], { selectedFile: process.argv[3] });
