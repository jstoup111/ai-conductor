/** Development launcher entry point: runs the current TypeScript CLI source. */
import { main } from './index.js';

try {
  await main();
} catch (error) {
  console.error('Fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
