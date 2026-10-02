import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import {
  parseSessionCommandContexts,
  sessionCommandContextAt,
  type SessionCommandContext,
  type SessionCommandSourceFamily,
} from './session-command-contexts.js';

export interface SessionCommandSource {
  readonly file: string;
  readonly source: string;
  readonly family: SessionCommandSourceFamily;
}

export interface SessionCommandInstruction {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly subcommand: string;
  readonly context?: SessionCommandContext;
  readonly reason?: string;
}

const COMMAND = /\b(?:ai-conductor|conduct-ts)\s+([a-z][a-z0-9-]*)\b/g;

function normalized(path: string): string { return path.split(sep).join('/'); }
function walk(directory: string, permitted: (name: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && permitted(entry.name)) files.push(path);
    }
  };
  visit(directory);
  return files.sort();
}

/**
 * Discover executable instruction sources, not repository prose.  The roots
 * deliberately exclude `.docs`, tests, examples, and generated output.
 */
export function discoverSessionCommandSources(repositoryRoot: string): SessionCommandSource[] {
  const engineRoot = existsSync(join(repositoryRoot, 'src', 'engine'))
    ? join(repositoryRoot, 'src', 'engine')
    : join(repositoryRoot, 'src', 'conductor', 'src', 'engine');
  const sources: SessionCommandSource[] = [];
  for (const file of walk(engineRoot, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))) {
    sources.push({ file: `engine/${normalized(relative(engineRoot, file))}`, source: readFileSync(file, 'utf8'), family: 'engine' });
  }
  for (const file of walk(join(repositoryRoot, 'skills'), (name) => name === 'SKILL.md')) {
    sources.push({ file: normalized(relative(repositoryRoot, file)), source: readFileSync(file, 'utf8'), family: 'skill' });
  }
  return sources.sort((left, right) => left.file.localeCompare(right.file));
}

function commandLocations(input: SessionCommandSource): Array<{ line: number; column: number; subcommand: string }> {
  const found: Array<{ line: number; column: number; subcommand: string }> = [];
  const add = (text: string, offset: number): void => {
    for (const match of text.matchAll(COMMAND)) {
      const start = offset + (match.index ?? 0);
      const before = input.source.slice(0, start);
      found.push({ line: before.split('\n').length, column: start - before.lastIndexOf('\n'), subcommand: match[1]! });
    }
  };
  if (input.family !== 'engine') { add(input.source, 0); return found; }
  const parsed = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node.getStart(parsed) + 1);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** Classify every command-bearing instruction and fail closed on bad context. */
export function auditSessionCommandSource(input: SessionCommandSource): SessionCommandInstruction[] {
  const contexts = parseSessionCommandContexts(input.source, input.family);
  return commandLocations(input).map((command) => {
    const problem = contexts.problems.find((item) => item.line <= command.line);
    const classification = problem
      ? { reason: problem.reason }
      : sessionCommandContextAt(contexts, command.line);
    return { file: input.file, ...command, ...classification };
  });
}
