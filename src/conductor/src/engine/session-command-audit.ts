import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { evaluateDaemonSessionCommandPolicy } from '../execution/daemon-session.js';
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

/**
 * Check only the explicitly declared instruction regions rendered into a
 * marked provider dispatch.  Unmarked prose remains an operator-facing hint;
 * it is not silently promoted into a daemon-session instruction.
 */
export function auditManagedSessionInstructionSource(input: SessionCommandSource): SessionCommandInstruction[] {
  const contexts = parseSessionCommandContexts(input.source, input.family);
  return auditSessionCommandSource(input).flatMap((instruction) => {
    const declared = contexts.ranges.some((range) =>
      range.startLine <= instruction.line && instruction.line <= range.endLine
      && !(range.context === 'managed' && range.startLine === 1),
    );
    if (!declared) return [];
    if (instruction.context !== 'managed') {
      return [{ ...instruction, reason: 'managed dispatch cannot execute an operator-only instruction' }];
    }
    return instruction.reason ? [instruction] : [];
  });
}

const COMMAND = /\b(?:ai-conductor|conduct-ts)\s+([a-z][a-z0-9-]*)\b/g;
const COMMAND_PREFIX = /\b(?:ai-conductor|conduct-ts)\b/;
const MAX_CONSTANT_EVALUATION_DEPTH = 32;

interface SourceSegment {
  readonly text: string;
  readonly start: number;
}

interface ResolvedString {
  readonly segments: readonly SourceSegment[];
  readonly unresolved: boolean;
}

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

/**
 * Every executable engine prompt and shipped skill can be rendered into a
 * managed session. Discovery, rather than an occurrence inventory, keeps new
 * instructions inside the validation boundary.
 */
export function discoverShippedSessionCommandSources(repositoryRoot: string): SessionCommandSource[] {
  return discoverSessionCommandSources(repositoryRoot);
}

function sourceLocation(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

function resolvedText(result: ResolvedString): string { return result.segments.map((segment) => segment.text).join(''); }

function offsetAt(result: ResolvedString, index: number): number {
  let remaining = index;
  for (const segment of result.segments) {
    if (remaining < segment.text.length) return segment.start + remaining;
    remaining -= segment.text.length;
  }
  return result.segments.at(-1)?.start ?? 0;
}

function append(left: ResolvedString, right: ResolvedString): ResolvedString {
  return { segments: [...left.segments, ...right.segments], unresolved: left.unresolved || right.unresolved };
}

function constantString(
  node: ts.Expression,
  source: ts.SourceFile,
  constants: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string> = new Set(),
  depth = 0,
): ResolvedString {
  if (depth >= MAX_CONSTANT_EVALUATION_DEPTH) return { segments: [], unresolved: true };
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return constantString(node.expression, source, constants, seen, depth + 1);
  }
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { segments: [{ text: node.text, start: node.getStart(source) + 1 }], unresolved: false };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return append(constantString(node.left, source, constants, seen, depth + 1), constantString(node.right, source, constants, seen, depth + 1));
  }
  if (ts.isTemplateExpression(node)) {
    let result: ResolvedString = {
      segments: [{ text: node.head.text, start: node.head.getStart(source) + 1 }],
      unresolved: false,
    };
    for (const span of node.templateSpans) {
      result = append(result, constantString(span.expression, source, constants, seen, depth + 1));
      result = append(result, {
        segments: [{ text: span.literal.text, start: span.literal.getStart(source) + 1 }],
        unresolved: false,
      });
    }
    return result;
  }
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const initializer = constants.get(node.text);
    if (initializer) return constantString(initializer, source, constants, new Set([...seen, node.text]), depth + 1);
  }
  return { segments: [], unresolved: true };
}

function stringConstructionRoot(node: ts.Node): node is ts.Expression {
  if (!ts.isExpression(node)) return false;
  if (!(ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)
    || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken))) return false;
  return !ts.isBinaryExpression(node.parent) && !ts.isTemplateSpan(node.parent);
}

function commandLocations(input: SessionCommandSource): Array<{ line: number; column: number; subcommand: string; unresolved?: boolean }> {
  const found: Array<{ line: number; column: number; subcommand: string; unresolved?: boolean }> = [];
  const add = (text: string, offset: number): void => {
    for (const match of text.matchAll(COMMAND)) {
      const start = offset + (match.index ?? 0);
      found.push({ ...sourceLocation(input.source, start), subcommand: match[1]! });
    }
  };
  const addResolved = (result: ResolvedString): boolean => {
    const text = resolvedText(result);
    let matched = false;
    for (const match of text.matchAll(COMMAND)) {
      matched = true;
      const start = offsetAt(result, match.index ?? 0);
      found.push({ ...sourceLocation(input.source, start), subcommand: match[1]! });
    }
    return matched;
  };
  if (input.family !== 'engine') { add(input.source, 0); return found; }
  const parsed = ts.createSourceFile(input.file, input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constants = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const visit = (node: ts.Node): void => {
    if (stringConstructionRoot(node)) {
      const result = constantString(node, parsed, constants);
      const text = resolvedText(result);
      const matched = addResolved(result);
      if (result.unresolved && !matched && COMMAND_PREFIX.test(text)) {
        const start = text.search(COMMAND_PREFIX);
        found.push({ ...sourceLocation(input.source, offsetAt(result, start)), subcommand: 'unknown', unresolved: true });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** Classify every command-bearing instruction and fail closed on bad context. */
export function auditSessionCommandSource(input: SessionCommandSource): SessionCommandInstruction[] {
  const contexts = parseSessionCommandContexts(input.source, input.family);
  return commandLocations(input).map((command) => {
    const { unresolved, ...location } = command;
    const problem = contexts.problems.find((item) => item.line <= command.line);
    const classification = problem
      ? { reason: problem.reason }
      : sessionCommandContextAt(contexts, command.line);
    if (classification.reason) return { file: input.file, ...location, reason: classification.reason };
    if (unresolved && classification.context === 'managed') {
      return { file: input.file, ...location, context: classification.context, reason: 'unresolved command construction' };
    }
    if (classification.context === 'managed') {
      const policy = evaluateDaemonSessionCommandPolicy(['node', 'ai-conductor', location.subcommand]);
      if (!policy.allowed) return { file: input.file, ...location, context: classification.context, reason: policy.message };
    }
    return { file: input.file, ...location, ...classification };
  });
}
