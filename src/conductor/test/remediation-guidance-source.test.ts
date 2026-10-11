// Covers: task:5
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { detectInline, parseArgs } from '../src/cli.js';
import { detectDaemonCommand, detectDaemonSupervisorCommand } from '../src/engine/daemon-command.js';
import { detectEngineerCommand } from '../src/engine/engineer-cli.js';
import {
  formatPreGuardCommand,
  isTopLevelHelpRequest,
  PRE_GUARD_COMMAND_FIXTURES,
  REMEDIATION_COMMAND_FIXTURES,
} from '../src/remediation-commands.js';
import { formatInlineGuardGuidance } from '../src/remediation-guidance.js';

export interface HandWrittenCommand {
  readonly line: number;
  readonly text: string;
}

const HAND_WRITTEN_COMMAND = /(?:ai-conductor|conduct) (?:[-"]|[a-z]+(?=\s|`|$))/;

function isReplaceSearchPattern(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return ts.isCallExpression(parent) &&
    parent.arguments[0] === node &&
    ts.isPropertyAccessExpression(parent.expression) &&
    (parent.expression.name.text === 'replace' || parent.expression.name.text === 'replaceAll');
}

/** Finds command-shaped literals that bypass the remediation command builders. */
export function findHandWrittenCommands(sourceText: string): HandWrittenCommand[] {
  const sourceFile = ts.createSourceFile('source.ts', sourceText, ts.ScriptTarget.Latest, true);
  const matches: HandWrittenCommand[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (!isReplaceSearchPattern(node) && HAND_WRITTEN_COMMAND.test(node.text)) {
        matches.push({
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          text: node.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matches;
}

function formatOffenders(offenders: readonly HandWrittenCommand[]): string {
  return offenders.map(({ line, text }) => `line ${line}: ${text}`).join('\n');
}

function assertAcceptedByCli(commandText: string): void {
  const argv = commandText.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((token) => token.replace(/^"|"$/g, '')) ?? [];
  const binary = argv.shift();
  expect(binary).toBe('ai-conductor');
  const detected = detectInline(['node', binary!, ...argv]);
  expect(detected.isInline).toBe(true);
  parseArgs(detected.rest);
}

describe('findHandWrittenCommands', () => {
  it('finds command literals across diagnostic surfaces and ignores builder/search-pattern exceptions', () => {
    const source = [
      "console.error(`Run ai-conductor --reset to clear`);",
      "console.error('conduct daemon park x');",
      "const status = 'ai-conductor --status'; console.log(status);",
      "throw new Error('Run ai-conductor --fresh');",
      "process.stderr.write('ai-conductor --reset');",
      "formatRemediationCommand({ kind: 'inline-reset' });",
      "value.replaceAll('ai-conductor --reset', 'ok');",
      "value.replaceAll('old', 'ai-conductor --reset');",
      "console.error('conduct daemon: unknown subcommand');",
    ].join('\n');

    expect(findHandWrittenCommands(source)).toEqual([
      { line: 1, text: 'Run ai-conductor --reset to clear' },
      { line: 2, text: 'conduct daemon park x' },
      { line: 3, text: 'ai-conductor --status' },
      { line: 4, text: 'Run ai-conductor --fresh' },
      { line: 5, text: 'ai-conductor --reset' },
      { line: 8, text: 'ai-conductor --reset' },
    ]);
  });

  it('keeps index guidance command literals behind remediation builders', () => {
    const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const offenders = findHandWrittenCommands(indexSource);

    expect(offenders, `Hand-written guidance commands:\n${formatOffenders(offenders)}`).toEqual([]);
  });
});

describe('pre-guard remediation guidance', () => {
  it('renders the inline guard with builder commands accepted by their parsers', () => {
    const guidance = formatInlineGuardGuidance();

    expect(guidance).toContain('ai-conductor inline "<feature description>"');
    expect(guidance).toContain('ai-conductor inline --status');
    expect(guidance).toContain('ai-conductor inline --resume');
    expect(guidance).toContain('ai-conductor inline --report');
    expect(guidance).toContain('ai-conductor inline --diagnose');
    expect(guidance).toContain('ai-conductor --help');
    expect(isTopLevelHelpRequest(['node', 'ai-conductor', '--help'])).toBe(true);

    for (const command of REMEDIATION_COMMAND_FIXTURES) {
      assertAcceptedByCli(formatPreGuardCommand(command));
    }
  });

  it('keeps pre-guard commands separate and accepts them through their owning parser', () => {
    const inlineKinds = new Set(REMEDIATION_COMMAND_FIXTURES.map(({ kind }) => kind));
    expect([...inlineKinds]).toEqual(expect.arrayContaining([
      'inline-resume',
      'inline-report',
      'inline-diagnose',
    ]));

    for (const command of PRE_GUARD_COMMAND_FIXTURES) {
      expect(REMEDIATION_COMMAND_FIXTURES).not.toContain(command);
      const argv = formatPreGuardCommand(command).split(' ');
      const parsed = command.kind === 'daemon-start'
        ? detectDaemonSupervisorCommand(['node', argv[0], ...argv.slice(1)]) ?? detectDaemonCommand(['node', argv[0], ...argv.slice(1)])
        : command.kind === 'compose'
          ? detectEngineerCommand(['node', argv[0], ...argv.slice(1)])
          : isTopLevelHelpRequest(['node', argv[0], ...argv.slice(1)]);
      expect(parsed).not.toBeNull();
      expect(parsed).not.toMatchObject({ kind: 'invalidArgs' });
    }
  });
});
