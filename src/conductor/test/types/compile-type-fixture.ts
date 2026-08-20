import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const tsc = resolve(projectRoot, 'node_modules/typescript/bin/tsc');

export function compileTypeFixture(path: string) {
  return spawnSync(process.execPath, [
    tsc,
    '--noEmit',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--strict',
    '--esModuleInterop',
    '--skipLibCheck',
    '--isolatedModules',
    resolve(projectRoot, path),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}
