import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', '..', 'src');

/**
 * Task 8: EventPersister MUST be wired only in index.ts — zero references in
 * conductor.ts or step-runners.ts.
 */
describe('EventPersister wiring constraints', () => {
  it('conductor.ts has zero EventPersister references', () => {
    const conductorSrc = readFileSync(join(srcRoot, 'engine', 'conductor.ts'), 'utf-8');
    expect(conductorSrc).not.toContain('EventPersister');
  });

  it('step-runners.ts has zero EventPersister references', () => {
    const stepRunnersSrc = readFileSync(join(srcRoot, 'engine', 'step-runners.ts'), 'utf-8');
    expect(stepRunnersSrc).not.toContain('EventPersister');
  });

  it('index.ts imports EventPersister', () => {
    const indexSrc = readFileSync(join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).toContain('EventPersister');
  });
});
