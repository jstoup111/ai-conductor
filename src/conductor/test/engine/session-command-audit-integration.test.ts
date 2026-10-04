// Covers: task:4
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  auditManagedSessionInstructionSource,
  auditShippedManagedSessionInstructionSource,
  MANAGED_DISPATCH_PROMPT_SURFACES,
} from '../../src/engine/session-command-audit.js';

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

  it('fails unmarked template, array, and concatenated engine constructions without prose-name heuristics', () => {
    const source = [
      'const unrelated = `Run ai-conductor daemon park feature-a`;',
      "const pieces = ['Run ai-conductor ', 'daemon park feature-b'];",
      "const chained = 'Run ai-conductor ' +\n  'daemon park feature-c';",
    ].join('\n');
    const findings = auditShippedManagedSessionInstructionSource({
      file: 'engine/new-dispatch.ts', source, family: 'engine',
    });
    expect(findings).toHaveLength(3);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'unclassified session-command context in engine instruction' }),
    ]));
  });

  it('retains unresolved managed command construction through the shipped entry', () => {
    const source = [
      '// ai-conductor:session-command-context=managed',
      'const subcommand = process.env.SUBCOMMAND;',
      "const prompt = `Run ai-conductor ${subcommand}`;",
      '// /ai-conductor:session-command-context',
    ].join('\n');

    expect(auditShippedManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' }))
      .toContainEqual(expect.objectContaining({ reason: 'unresolved command construction' }));
  });

  it('retains a trailing stale endpoint through the shipped entry', () => {
    const source = [
      '// ai-conductor:session-command-context=managed',
      "const prompt = 'Run ai-conductor daemon status';",
      '// /ai-conductor:session-command-context',
      '// /ai-conductor:session-command-context',
    ].join('\n');

    expect(auditShippedManagedSessionInstructionSource({ file: 'engine/step-runners.ts', source, family: 'engine' }))
      .toContainEqual(expect.objectContaining({ reason: 'stale session-command context endpoint without an open region' }));
  });

  it('carries a conductor retry/recovery contradiction from the registered production surface', () => {
    const productionSource = readFileSync(join(__dirname, '../../src/engine/conductor.ts'), 'utf8');
    const retrySurface = MANAGED_DISPATCH_PROMPT_SURFACES.find((surface) => surface.file === 'conductor.ts');
    expect(retrySurface?.symbols).toContain('buildRetryHint');
    const source = productionSource.replace(
      '// ai-conductor:session-command-context=managed',
      '// ai-conductor:session-command-context=operator-only',
    );
    expect(auditShippedManagedSessionInstructionSource({ file: 'engine/conductor.ts', source, family: 'engine' }))
      .toContainEqual(expect.objectContaining({
        reason: 'managed dispatch cannot execute an operator-only instruction',
      }));
  });

  it('carries a project-prelude contradiction from its registered managed surface', () => {
    const productionSource = readFileSync(join(__dirname, '../../src/engine/project-prelude.ts'), 'utf8');
    const source = productionSource.replace(
      'const execution = options.providerExecution;',
      [
        '// ai-conductor:session-command-context=operator-only',
        "const injectedPreludeInstruction = 'Run ai-conductor daemon park feature-a';",
        '// /ai-conductor:session-command-context',
        'const execution = options.providerExecution;',
      ].join('\n'),
    );
    expect(auditShippedManagedSessionInstructionSource({ file: 'engine/project-prelude.ts', source, family: 'engine' }))
      .toContainEqual(expect.objectContaining({
        reason: 'managed dispatch cannot execute an operator-only instruction',
      }));
  });

  it('registers only declarations that exist in each managed prompt producer', () => {
    for (const surface of MANAGED_DISPATCH_PROMPT_SURFACES) {
      const source = readFileSync(join(__dirname, '../../src/engine', surface.file), 'utf8');
      const parsed = ts.createSourceFile(surface.file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const symbol of surface.symbols) {
        let found = false;
        const visit = (node: ts.Node): void => {
          const name = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node))
            ? node.name?.getText(parsed)
            : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : undefined;
          if (name === symbol) found = true;
          ts.forEachChild(node, visit);
        };
        visit(parsed);
        expect(found, `${surface.file} must declare ${symbol}`).toBe(true);
      }
    }
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
