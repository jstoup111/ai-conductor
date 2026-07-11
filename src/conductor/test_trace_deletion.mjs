// Trace deletion patterns
import fs from 'fs/promises';
import { mkdtempSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

(async () => {
// Test 1: Simple deletion simulation
console.log('=== Test 1: Simple deletion ===');
const dir1 = mkdtempSync(path.join(tmpdir(), 'trace-test-'));
const pipeline1 = path.join(dir1, '.pipeline');
await fs.mkdir(path.join(pipeline1, 'gates'), { recursive: true });
await fs.writeFile(path.join(pipeline1, 'sentinel'), 'test');

console.log('Before delete - sentinel exists:', existsSync(path.join(pipeline1, 'sentinel')));
await fs.rm(pipeline1, { recursive: true, force: true });
console.log('After delete - sentinel exists:', existsSync(path.join(pipeline1, 'sentinel')));
console.log('After delete - pipeline dir exists:', existsSync(pipeline1));

// Test 2: Check if process.cwd() interferes
console.log('\n=== Test 2: Check process.cwd() ===');
console.log('Current working directory:', process.cwd());

const dir2 = mkdtempSync(path.join(tmpdir(), 'trace-test-'));
console.log('Test dir:', dir2);
const pipeline2 = path.join(dir2, '.pipeline');
await fs.mkdir(pipeline2, { recursive: true });
await fs.writeFile(path.join(pipeline2, 'sentinel'), 'test');

// Try to delete from process.cwd() (should not affect our test dir)
const cwdPipelineDelete = path.join(process.cwd(), '.pipeline');
if (existsSync(cwdPipelineDelete)) {
  console.log('process.cwd() .pipeline exists, would be deleted');
  await fs.rm(cwdPipelineDelete, { recursive: true, force: true });
}

// Check if our test pipeline still exists
console.log('After cwd delete - our pipeline exists:', existsSync(pipeline2));
console.log('After cwd delete - our sentinel exists:', existsSync(path.join(pipeline2, 'sentinel')));

// Cleanup
await fs.rm(dir1, { recursive: true, force: true });
await fs.rm(dir2, { recursive: true, force: true });
})();
