// Covers: task:8
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('engine/feature-executor', () => {
  it('keeps the executor entry point order-only and free of daemon root-state imports', async () => {
    const executorSource = await readFile(
      fileURLToPath(new URL('../../src/engine/feature-executor.ts', import.meta.url)),
      'utf8',
    );

    expect({
      acceptsWorkOrder: /execute\(order: WorkOrder\)/.test(executorSource),
      importsRootState: /from ['"]\.\/(?:daemon(?:-backlog|-deps|-runner)?|park-marker)['"]/.test(executorSource),
      readsDaemonPath: executorSource.includes('.daemon/'),
    }).toEqual({ acceptsWorkOrder: true, importsRootState: false, readsDaemonPath: false });
  });
});
