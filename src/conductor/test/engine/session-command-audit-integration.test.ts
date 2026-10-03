// Covers: task:4
import { describe, expect, it } from 'vitest';
import { auditManagedSessionInstructionSource } from '../../src/engine/session-command-audit.js';

describe('managed session instruction contexts', () => {
  it('refuses an operator-only region when that prompt is dispatched to a marked session', () => {
    const source = [
      '// ai-conductor:session-command-context=operator-only',
      "const systemPrompt = 'Run ai-conductor scoped-run test/example.test.ts';",
      '// /ai-conductor:session-command-context',
    ].join('\n');

    expect(auditManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' })).toEqual([
      expect.objectContaining({ line: 2, subcommand: 'scoped-run', reason: 'managed dispatch cannot execute an operator-only instruction' }),
    ]);
  });

  it('allows a managed instruction and excludes an unmarked operator instruction', () => {
    const source = [
      '// ai-conductor:session-command-context=managed',
      "const systemPrompt = 'Run ai-conductor scoped-run test/example.test.ts';",
      '// /ai-conductor:session-command-context',
      "const operatorHint = 'An operator can run ai-conductor daemon status.';",
    ].join('\n');

    expect(auditManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' })).toEqual([]);
  });
});
