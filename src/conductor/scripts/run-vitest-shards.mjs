import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(packageRoot, 'test');
// A worker can retain enough fixture state to exceed its 8 GiB cap while
// processing a small number of large fixtures. Bound both file count and
// source bytes so a growing heavyweight fixture cannot share a worker merely
// because it fits below the count limit.
const maxFilesPerBatch = 2;
// Tests around 120 KiB can retain enough fixture state to make a two-file
// worker exceed its heap ceiling. Treat that size as a dedicated-process
// boundary rather than allowing it to share a batch merely below 128 KiB.
const maxBytesPerBatch = 120 * 1024;
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

async function partition(files) {
  const batches = [];
  let batch = [];
  let batchBytes = 0;

  for (const file of files) {
    const fileBytes = (await stat(join(packageRoot, file))).size;
    if (batch.length > 0 && (
      batch.length >= maxFilesPerBatch || batchBytes + fileBytes > maxBytesPerBatch
    )) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(file);
    batchBytes += fileBytes;
    if (batchBytes >= maxBytesPerBatch) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
  }

  if (batch.length > 0) batches.push(batch);
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
const batches = selectors.length > 0 ? [selectors] : await partition(discovered);

for (const batch of batches.length === 0 ? [[]] : batches) {
  const { code, signal } = await runVitest(batch);
  if (signal !== null) process.kill(process.pid, signal);
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}

if (process.exitCode === undefined) console.log('AGGREGATE_TEST_SUITE_PASS');
