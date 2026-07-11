// Quick script to trace .pipeline deletion
const fs = require('fs');
const path = require('path');
const tmpdir = require('os').tmpdir();

// Create a test directory
const testDir = fs.mkdtempSync(path.join(tmpdir, 'trace-deletion-'));
const pipelineDir = path.join(testDir, '.pipeline');

console.log('Test dir:', testDir);
console.log('Pipeline dir:', pipelineDir);

// Create .pipeline with sentinel
fs.mkdirSync(pipelineDir, { recursive: true });
const sentinelPath = path.join(pipelineDir, 'sentinel');
fs.writeFileSync(sentinelPath, 'test-sentinel-file');

console.log('Created sentinel at:', sentinelPath);
console.log('Sentinel exists:', fs.existsSync(sentinelPath));

// Check if it still exists after a short delay
setTimeout(() => {
  console.log('After delay, sentinel exists:', fs.existsSync(sentinelPath));
  console.log('Pipeline dir exists:', fs.existsSync(pipelineDir));
  if (fs.existsSync(pipelineDir)) {
    console.log('Contents:', fs.readdirSync(pipelineDir));
  }
  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
}, 100);
