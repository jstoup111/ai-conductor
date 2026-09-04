// Covers: task:8
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createInProcessFeatureExecutor,
  type FeatureExecutionOutcome,
} from '../../src/engine/feature-executor.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

describe('engine/feature-executor', () => {
  const order: WorkOrder = {
    repository: 'jstoup/ai-conductor',
    slug: 'parallel-dispatch',
    baseSha: 'a'.repeat(40),
    manifest: [{ ref: '.docs/plans/parallel-dispatch.md', contentHash: 'sha256:plan' }],
  };

  it('passes the dispatcher-built order through the executor and returns its runner outcome', async () => {
    const outcome: FeatureExecutionOutcome = {
      slug: order.slug,
      status: 'done',
      prUrl: 'https://github.com/jstoup/ai-conductor/pull/1',
      costTokens: 42,
    };
    const events: string[] = [];
    const run = vi.fn(async (received: WorkOrder) => {
      events.push(`run:${received.slug}`);
      return outcome;
    });
    const withFeatureOwnership = async <T>(slug: string, operation: () => Promise<T>) => {
      events.push(`own:${slug}`);
      const result = await operation();
      events.push(`release:${slug}`);
      return result;
    };

    const executor = createInProcessFeatureExecutor({ run, withFeatureOwnership });

    await expect(executor.execute(order)).resolves.toEqual(outcome);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(order);
    expect(events).toEqual([
      `own:${order.slug}`,
      `run:${order.slug}`,
      `release:${order.slug}`,
    ]);
  });

  it('keeps the executor module order-only and free of daemon root-state imports', async () => {
    const executorSource = await readFile(
      fileURLToPath(new URL('../../src/engine/feature-executor.ts', import.meta.url)),
      'utf8',
    );
    const imports = [...executorSource.matchAll(/^import(?:\s+type)?[\s\S]*?from ['"]([^'"]+)['"];/gm)]
      .map((match) => match[1]);
    const executableSource = executorSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    expect(imports).toEqual(['./work-order.js']);
    expect(executableSource).toMatch(/execute\(order: WorkOrder\)/);
    expect(executableSource).not.toMatch(/(?:daemon|park-marker|\.daemon)/);
  });
});
