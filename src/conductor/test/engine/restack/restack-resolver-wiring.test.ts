// Covers: task:rem-prd-audit-R14
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const engineRoot = fileURLToPath(new URL('../../../src/engine/', import.meta.url));

async function source(path: string): Promise<string> {
  return readFile(new URL(path, `file://${engineRoot}`), 'utf8');
}

describe('restack resolver production wiring', () => {
  it('forwards the provider resolver and configured cap through every replay entry point', async () => {
    const [executor, conductor, rekick, preflight, recovery] = await Promise.all([
      source('restack/restack-executor.ts'),
      source('conductor.ts'),
      source('daemon-rekick.ts'),
      source('restack/stack-preflight.ts'),
      source('restack/restack-recovery.ts'),
    ]);

    expect(executor).toContain('cap: options.resolverCap ?? resolveRebaseResolutionAttempts()');
    expect(conductor).toContain('resolverCap: resolveRebaseResolutionAttempts(this.config)');
    expect(conductor).toContain('resolver: this.stepRunner.resolveRebaseConflict');
    expect(rekick).toContain('resolver: opts.resolveConflict');
    expect(rekick).toContain('resolverCap: opts.resolveAttempts');
    expect(preflight.match(/resolver: options\.resolver/g)).toHaveLength(2);
    expect(preflight.match(/resolverCap: options\.resolverCap/g)).toHaveLength(2);
    expect(recovery).toContain('resolver: options.resolver');
    expect(recovery).toContain('resolverCap: options.resolverCap');
  });
});
