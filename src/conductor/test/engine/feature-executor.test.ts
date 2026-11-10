// Covers: task:3, task:8
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('engine/feature-executor', () => {
  it('keeps the executor module order-only and free of daemon root-state imports', async () => {
    const executorSource = await readFile(
      fileURLToPath(new URL('../../src/engine/feature-executor.ts', import.meta.url)),
      'utf8',
    );
    const imports = [...executorSource.matchAll(/^import(?:\s+type)?[\s\S]*?from ['"]([^'"]+)['"];/gm)].map(
      (match) => match[1],
    );
    const executableSource = executorSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(imports).toEqual(['./work-order.js']);
    expect(executableSource).toMatch(/execute\(order: WorkOrder\)/);
    expect(executableSource).not.toMatch(/(?:daemon|park-marker|\.daemon)/);
  });
});
