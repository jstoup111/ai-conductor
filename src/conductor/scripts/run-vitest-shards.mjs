import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(packageRoot, 'test');
// A worker can retain enough fixture state to exceed its 8 GiB cap while
// processing a ninth file. Derive the shard count from the discovered suite so
// later test growth cannot silently increase that per-worker bound.
const maxFilesPerBatch = 8;
const vitestArgs = ['run', '--reporter=dot', '--silent', '--slowTestThreshold=1800000'];

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.sort((left, right) => left.name.localeCompare(right.name)).map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.test.ts') || entry.name.endsWith('.smoke.test.ts')) return [];
    return [relative(packageRoot, path).split(sep).join('/')];
  }));
  return files.flat();
}

function partition(files) {
  const count = Math.ceil(files.length / maxFilesPerBatch);
  const batches = Array.from({ length: count }, () => []);
  for (const [index, file] of files.entries()) batches[index % count].push(file);
  return batches;
}

function runVitest(selectors) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(packageRoot, 'scripts', 'run-vitest.mjs'), ...vitestArgs, ...selectors], {
      cwd: packageRoot,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

const selectors = process.argv.slice(2);
const discovered = selectors.length === 0 ? await collectTestFiles(testRoot) : [];
const batches = selectors.length > 0 ? [selectors] : partition(discovered);

for (const batch of batches.length === 0 ? [[]] : batches) {
  const { code, signal } = await runVitest(batch);
  if (signal !== null) process.kill(process.pid, signal);
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}

if (process.exitCode === undefined) console.log('AGGREGATE_TEST_SUITE_PASS');
