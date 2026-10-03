// Covers: task:4
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManagedSessionInstructionSource, auditShippedManagedSessionInstructionSource } from '../../src/engine/session-command-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('managed session instruction contexts', () => {
  it('refuses an operator-only region when that prompt is dispatched to a marked session', () => {
    const source = [
      '// ai-conductor:session-command-context=operator-only',
      "const buildSystemPrompt = 'Run ai-conductor scoped-run test/example.test.ts';",
      '// /ai-conductor:session-command-context',
    ].join('\n');

    expect(auditShippedManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' })).toEqual([
      expect.objectContaining({ line: 2, subcommand: 'scoped-run', reason: 'managed dispatch cannot execute an operator-only instruction' }),
    ]);
  });

  it('carries an operator-only contradiction from the production system-prompt surface to the shipped gate', () => {
    const productionSource = readFileSync(join(__dirname, '../../src/engine/step-runners.ts'), 'utf8');
    const source = productionSource.replace(
      '// ai-conductor:session-command-context=managed',
      "// ai-conductor:session-command-context=operator-only\nconst productionPromptFixture = 'Run ai-conductor daemon park feature-a';",
    );

    expect(auditShippedManagedSessionInstructionSource({
      file: 'engine/step-runners.ts', source, family: 'engine',
    })).toContainEqual(expect.objectContaining({
      reason: 'managed dispatch cannot execute an operator-only instruction',
    }));
  });

  it('fails an unmarked engine prompt through the shipped audit variant', () => {
    expect(auditShippedManagedSessionInstructionSource({
      file: 'engine/new-dispatch.ts', family: 'engine',
      source: "export const buildSystemPrompt = 'Run ai-conductor daemon park feature-a';",
    })).toEqual([expect.objectContaining({
      reason: 'unclassified session-command context in engine instruction',
    })]);
  });

  it('allows a managed instruction and excludes an unmarked operator instruction', () => {
    const source = [
      '// ai-conductor:session-command-context=managed',
      "const systemPrompt = 'Run ai-conductor scoped-run test/example.test.ts';",
      '// /ai-conductor:session-command-context',
      "const operatorHint = 'An operator can check daemon status.';",
    ].join('\n');

    expect(auditManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' })).toEqual([]);
  });

  it('audits a managed retry-shaped producer without relying on its identifier', () => {
    const source = [
      'export function buildRetryHint() {',
      '  // ai-conductor:session-command-context=managed',
      "  return 'Run ' + 'ai-conductor daemon park feature';",
      '  // /ai-conductor:session-command-context',
      '}',
    ].join('\n');

    expect(auditManagedSessionInstructionSource({ file: 'engine/conductor.ts', source, family: 'engine' }))
      .toEqual([expect.objectContaining({ subcommand: 'daemon', reason: expect.stringMatching(/blocked/i) })]);
  });
});
