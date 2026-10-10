// Covers: task:5
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(__dirname, '..', '..');
const repositoryRoot = join(packageRoot, '..', '..');

function jobBlock(workflow: string, job: string): string {
  const start = workflow.indexOf(`  ${job}:`);
  expect(start).toBeGreaterThanOrEqual(0);

  const remainder = workflow.slice(start + `  ${job}:`.length);
  const nextJob = remainder.search(/\n  [a-zA-Z0-9_-]+:/);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

describe('CI progress reporter wiring', () => {
  it('uses the reporter only for conductor Vitest shards', () => {
    const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const conductorJob = jobBlock(workflow, 'conductor');

    expect(conductorJob).toContain(
      '- run: npm test -- --shard=${{ matrix.shard }}/4 --reporter=./test/reporters/ci-progress-reporter.ts\n'
        + '        working-directory: src/conductor',
    );
    expect(existsSync(join(packageRoot, 'test', 'reporters', 'ci-progress-reporter.ts'))).toBe(true);
    expect(jobBlock(workflow, 'conductor-e2e')).not.toContain('ci-progress-reporter');
  });

  it('keeps local test runs on the dot reporter alone', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts.test).toBe(
      "sh -c 'node scripts/run-vitest.mjs run --reporter=dot --silent --slowTestThreshold=1800000 \"$@\" && echo \"AGGREGATE_TEST_SUITE_PASS\"' --",
    );
    expect(packageJson.scripts.test).not.toContain('ci-progress');
  });
});
