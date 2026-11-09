import ts from 'typescript';

import type { BoundaryEntry, BoundaryName } from './boundary-registry.js';
import { isValueExport, isValueImport, layerFor, resolveSpecifier } from './layer-ratchet.js';

export interface BoundaryTouch {
  readonly file: string;
  readonly line: number;
  readonly boundary: BoundaryName;
  readonly kind: 'specifier-import' | 'clock-read' | 'command-literal' | 'adapter-import';
}

export interface UnlistedBoundaryTouchViolation {
  readonly kind: 'unlisted-touch';
  readonly file: string;
  readonly line: number;
  readonly boundary: BoundaryName;
  readonly touchKind?: BoundaryTouch['kind'];
  readonly entry?: never;
}

interface AllowlistEntryViolation {
  readonly file?: never;
  readonly line?: never;
  readonly boundary?: never;
  readonly touchKind?: never;
  readonly entry: string;
}

export interface StaleBoundaryAllowlistViolation extends AllowlistEntryViolation {
  readonly kind: 'stale-entry';
}

export interface MalformedBoundaryAllowlistViolation extends AllowlistEntryViolation {
  readonly kind: 'malformed-entry';
}

export interface UnknownBoundaryAllowlistViolation extends AllowlistEntryViolation {
  readonly kind: 'unknown-boundary';
}

export type BoundaryViolation = UnlistedBoundaryTouchViolation
  | StaleBoundaryAllowlistViolation
  | MalformedBoundaryAllowlistViolation
  | UnknownBoundaryAllowlistViolation;

export interface BoundaryRatchetInput {
  readonly files: ReadonlyMap<string, string>;
  readonly allowlist: readonly string[];
  readonly registry: Readonly<Record<BoundaryName, BoundaryEntry>>;
}

export interface BoundaryRatchetResult {
  readonly touches: readonly BoundaryTouch[];
  readonly violations: readonly BoundaryViolation[];
}

export function checkBoundaryRatchet({ files, allowlist, registry }: BoundaryRatchetInput): BoundaryRatchetResult {
  const touches: BoundaryTouch[] = [];
  const violations: BoundaryViolation[] = [];
  const allowlistEntries = validAllowlistEntries(allowlist, registry, violations);
  const allowed = new Set(allowlistEntries.map(({ entry }) => entry));

  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const processBindings = processBindingsFor(sourceFile, file, files, registry);
    const visit = (node: ts.Node): void => {
      const specifier = valueSpecifier(node);
      if (specifier !== undefined) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        for (const boundary of matchingBoundaries(specifier, registry)) {
          const touch: BoundaryTouch = { file, line, boundary, kind: 'specifier-import' };
          touches.push(touch);
          if (!registry[boundary].adapterModules.includes(file) && !allowed.has(`${file} -> ${boundary}`)) {
            violations.push({ kind: 'unlisted-touch', file, line, boundary });
          }
        }
      }
      const adapterBoundary = adapterImportBoundaryFor(node, file, files, registry);
      if (adapterBoundary !== undefined) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const touch: BoundaryTouch = { file, line, boundary: adapterBoundary, kind: 'adapter-import' };
        touches.push(touch);
        const permitted = registry[adapterBoundary].adapterModules.includes(file)
          || layerFor(file) === 'entry' || allowed.has(`${file} -> ${adapterBoundary}`);
        if (!permitted) {
          violations.push({ kind: 'unlisted-touch', file, line, boundary: adapterBoundary, touchKind: 'adapter-import' });
        }
      }
      const clockPattern = clockPatternFor(node);
      if (clockPattern !== undefined && registry.clock.clockCalls.includes(clockPattern)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const touch: BoundaryTouch = { file, line, boundary: 'clock', kind: 'clock-read' };
        touches.push(touch);
        if (!registry.clock.adapterModules.includes(file) && !allowed.has(`${file} -> clock`)) {
          violations.push({ kind: 'unlisted-touch', file, line, boundary: 'clock' });
        }
      }
      const commandBoundary = commandBoundaryFor(node, processBindings, registry);
      if (commandBoundary !== undefined) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const touch: BoundaryTouch = { file, line, boundary: commandBoundary, kind: 'command-literal' };
        touches.push(touch);
        if (!registry[commandBoundary].adapterModules.includes(file) && !allowed.has(`${file} -> ${commandBoundary}`)) {
          violations.push({ kind: 'unlisted-touch', file, line, boundary: commandBoundary });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  for (const { entry, file, boundary } of allowlistEntries) {
    const matchingTouches = touches.filter((touch) => touch.file === file && touch.boundary === boundary);
    if (matchingTouches.length === 0 || matchingTouches.every((touch) => isOtherwisePermitted(touch, registry))) {
      violations.push({ kind: 'stale-entry', entry });
    }
  }

  return { touches, violations };
}

export function formatBoundaryViolations(
  violations: readonly BoundaryViolation[],
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): string {
  return violations.map((violation) => {
    if (violation.kind !== 'unlisted-touch') return `${violation.kind} ${violation.entry}`;
    const entry = registry[violation.boundary];
    const resolution = entry.status.kind === 'pending'
      ? `pending #${entry.status.issue}`
      : `ported adapters: ${entry.adapterModules.join(', ')}`;
    const rule = violation.touchKind === 'adapter-import' ? '; only composition roots import adapters' : '';
    return `${violation.kind} ${violation.file}:${violation.line} ${violation.boundary} (${resolution}${rule})`;
  }).join('\n');
}

interface BoundaryAllowlistEntry {
  readonly entry: string;
  readonly file: string;
  readonly boundary: BoundaryName;
}

function validAllowlistEntries(
  allowlist: readonly string[],
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
  violations: BoundaryViolation[],
): BoundaryAllowlistEntry[] {
  const entries: BoundaryAllowlistEntry[] = [];
  let previous: string | undefined;
  for (const entry of allowlist) {
    const parsed = parseAllowlistEntry(entry);
    if (parsed === undefined || (previous !== undefined && entry <= previous)) {
      violations.push({ kind: 'malformed-entry', entry });
      continue;
    }
    previous = entry;
    if (!isBoundaryName(parsed.boundary, registry)) {
      violations.push({ kind: 'unknown-boundary', entry });
      continue;
    }
    entries.push({ entry, file: parsed.file, boundary: parsed.boundary });
  }
  return entries;
}

function parseAllowlistEntry(entry: string): { readonly file: string; readonly boundary: string } | undefined {
  const parts = entry.split(' -> ');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return undefined;
  return { file: parts[0], boundary: parts[1] };
}

function isBoundaryName(
  boundary: string,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): boundary is BoundaryName {
  return Object.prototype.hasOwnProperty.call(registry, boundary);
}

function isOtherwisePermitted(
  touch: BoundaryTouch,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): boolean {
  return registry[touch.boundary].adapterModules.includes(touch.file)
    || (touch.kind === 'adapter-import' && layerFor(touch.file) === 'entry');
}

function matchingBoundaries(
  specifier: string,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): BoundaryName[] {
  const normalized = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return (Object.keys(registry) as BoundaryName[]).filter((boundary) => registry[boundary].specifiers.some(
    (registeredSpecifier) => registeredSpecifier.endsWith('/')
      ? normalized.startsWith(registeredSpecifier)
      : normalized === registeredSpecifier,
  ));
}

function adapterImportBoundaryFor(
  node: ts.Node,
  file: string,
  files: ReadonlyMap<string, string>,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): BoundaryName | undefined {
  if (!ts.isImportDeclaration(node) || !isValueImport(node) || !ts.isStringLiteral(node.moduleSpecifier)) return undefined;
  const imported = resolveSpecifier(file, node.moduleSpecifier.text, files);
  if (imported === undefined) return undefined;
  return (Object.keys(registry) as BoundaryName[]).find(
    (boundary) => registry[boundary].adapterModules.includes(imported),
  );
}

function clockPatternFor(node: ts.Node): string | undefined {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const { expression, name } = node.expression;
    if (ts.isIdentifier(expression) && ts.isIdentifier(name)
      && ((expression.text === 'Date' && name.text === 'now') || (expression.text === 'performance' && name.text === 'now'))) {
      return `${expression.text}.${name.text}`;
    }
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date'
    && (node.arguments === undefined || node.arguments.length === 0)) {
    return 'new Date';
  }
  return undefined;
}

interface ProcessBindings {
  readonly calls: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

function processBindingsFor(
  sourceFile: ts.SourceFile,
  file: string,
  files: ReadonlyMap<string, string>,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): ProcessBindings {
  const calls = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !isValueImport(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier) || !isProcessBindingSource(statement.moduleSpecifier.text, file, files, registry)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) calls.add(clause.name.text);
    if (clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      namespaces.add(clause.namedBindings.name.text);
    } else {
      for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly) calls.add(binding.name.text);
      }
    }
  }
  return { calls, namespaces };
}

function isProcessBindingSource(
  specifier: string,
  file: string,
  files: ReadonlyMap<string, string>,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): boolean {
  if (matchingBoundaries(specifier, registry).includes('process')) return true;
  return specifier.startsWith('.') && registry.process.adapterModules.includes(resolveSpecifier(file, specifier, files) ?? '');
}

function commandBoundaryFor(
  node: ts.Node,
  bindings: ProcessBindings,
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): BoundaryName | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
  const command = node.arguments[0];
  if (!ts.isStringLiteral(command)) return undefined;
  const isBoundCall = ts.isIdentifier(node.expression) && bindings.calls.has(node.expression.text);
  const isBoundNamespaceCall = ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && bindings.namespaces.has(node.expression.expression.text);
  if (!isBoundCall && !isBoundNamespaceCall) return undefined;
  return (Object.keys(registry) as BoundaryName[]).find(
    (boundary) => registry[boundary].commandLiterals.includes(command.text),
  );
}

function valueSpecifier(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node)) {
    return isValueImport(node) && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (ts.isExportDeclaration(node)) {
    return isValueExport(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
    return node.arguments[0].text;
  }
  return undefined;
}
