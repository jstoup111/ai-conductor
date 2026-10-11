// Covers: task:1
import { describe, expect, it } from 'vitest';
import { detectInline, parseArgs } from '../src/cli.js';
import {
  formatRemediationCommand,
  REMEDIATION_COMMAND_FIXTURES,
} from '../src/remediation-commands.js';

/** Tokenizes the command shapes emitted by the remediation command builder. */
function shellSplit(command: string): string[] {
  const tokenRe = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export function assertAcceptedByCli(commandText: string): void {
  const tokens = shellSplit(commandText);
  const binary = tokens.shift();
  if (binary !== 'ai-conductor') {
    throw new Error(`Expected ai-conductor command: ${commandText}`);
  }

  const detected = detectInline(['node', binary, ...tokens]);
  if (!detected.isInline) {
    throw new Error(`Expected inline command: ${commandText}`);
  }

  try {
    parseArgs(detected.rest);
  } catch (error) {
    throw new Error(
      `CLI rejected remediation command ${commandText}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

describe('remediation commands', () => {
  it('formats every closed-set fixture as an inline command accepted by the CLI', () => {
    for (const command of REMEDIATION_COMMAND_FIXTURES) {
      const formatted = formatRemediationCommand(command);
      expect(formatted).toMatch(/^ai-conductor inline(?:\s|$)/);
      expect(() => assertAcceptedByCli(formatted)).not.toThrow();
    }
  });

  it('rejects a bare-form command while naming the complete rejected command', () => {
    expect(() => assertAcceptedByCli('ai-conductor --reset')).toThrow('ai-conductor --reset');
  });

  it.each([
    [undefined, 'ai-conductor inline', 'ai-conductor inline --fresh'],
    ['', 'ai-conductor inline', 'ai-conductor inline --fresh'],
    ['add login', 'ai-conductor inline "add login"', 'ai-conductor inline --fresh "add login"'],
  ])('formats run and fresh commands without empty feature tokens for %j', (feature, run, fresh) => {
    expect(formatRemediationCommand({ kind: 'inline-run', feature })).toBe(run);
    expect(formatRemediationCommand({ kind: 'inline-fresh', feature })).toBe(fresh);
    expect(run).not.toContain('""');
    expect(fresh).not.toContain('""');
    expect(() => assertAcceptedByCli(run)).not.toThrow();
    expect(() => assertAcceptedByCli(fresh)).not.toThrow();
  });

  it('formats reset and status as inline state operations', () => {
    expect(formatRemediationCommand({ kind: 'inline-reset' })).toBe('ai-conductor inline --reset');
    expect(formatRemediationCommand({ kind: 'inline-status' })).toBe('ai-conductor inline --status');
  });
});
