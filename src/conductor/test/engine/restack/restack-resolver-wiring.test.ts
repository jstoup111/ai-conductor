// Covers: task:9
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const engineRoot = fileURLToPath(new URL('../../../src/engine/', import.meta.url));

async function source(path: string): Promise<string> {
  return readFile(new URL(path, `file://${engineRoot}`), 'utf8');
}

describe('restack resolver production wiring', () => {
  it('passes an operator decision through the restack resolver context', async () => {
    const resolver = await source('restack/restack-resolver.ts');

    expect(resolver).toContain('readonly operatorDecision?: { answer: string; commit: string; paths: readonly string[] }');
    expect(resolver).toContain('...(options.operatorDecision === undefined ? {} : { operatorDecision: options.operatorDecision })');
  });

  it('forwards the provider resolver and configured cap through every replay entry point', async () => {
    const [executor, conductor, rekick, preflight, recovery, routedExit] = await Promise.all([
      source('restack/restack-executor.ts'),
      source('conductor.ts'),
      source('daemon-rekick.ts'),
      source('restack/stack-preflight.ts'),
      source('restack/restack-recovery.ts'),
      source('routing/routed-exit.ts'),
    ]);

    expect(executor).toContain('cap: options.resolverCap ?? resolveRebaseResolutionAttempts()');
    expect(conductor).toContain('resolverCap: resolveRebaseResolutionAttempts(this.config)');
    expect(conductor).toContain('resolver: this.stepRunner.resolveRebaseConflict');
    expect(rekick).toContain('resolver: opts.resolveConflict');
    expect(rekick).toContain('resolverCap: opts.resolveAttempts');
    // Base refresh, journal recovery, and the resumed routed exit.
    expect(preflight.match(/resolver: options\.resolver/g)).toHaveLength(3);
    expect(preflight.match(/resolverCap: options\.resolverCap/g)).toHaveLength(3);
    expect(recovery).toContain('resolver: options.resolver');
    expect(recovery).toContain('resolverCap: options.resolverCap');
    expect(routedExit).toContain('resolver: input.resolver');
    expect(routedExit).toContain('resolverCap: input.resolverCap');
  });
});
