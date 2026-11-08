import ts from 'typescript';

import type { BoundaryEntry, BoundaryName } from './boundary-registry.js';

export interface BoundaryTouch {
  readonly file: string;
  readonly line: number;
  readonly boundary: BoundaryName;
  readonly kind: 'specifier-import' | 'clock-read';
}

export interface UnlistedBoundaryTouchViolation {
  readonly kind: 'unlisted-touch';
  readonly file: string;
  readonly line: number;
  readonly boundary: BoundaryName;
}

export interface BoundaryRatchetInput {
  readonly files: ReadonlyMap<string, string>;
  readonly allowlist: readonly string[];
  readonly registry: Readonly<Record<BoundaryName, BoundaryEntry>>;
}

export interface BoundaryRatchetResult {
  readonly touches: readonly BoundaryTouch[];
  readonly violations: readonly UnlistedBoundaryTouchViolation[];
}

export function checkBoundaryRatchet({ files, allowlist, registry }: BoundaryRatchetInput): BoundaryRatchetResult {
  const touches: BoundaryTouch[] = [];
  const violations: UnlistedBoundaryTouchViolation[] = [];
  const allowed = new Set(allowlist);

  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
      const clockPattern = clockPatternFor(node);
      if (clockPattern !== undefined && registry.clock.clockCalls.includes(clockPattern)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const touch: BoundaryTouch = { file, line, boundary: 'clock', kind: 'clock-read' };
        touches.push(touch);
        if (!registry.clock.adapterModules.includes(file) && !allowed.has(`${file} -> clock`)) {
          violations.push({ kind: 'unlisted-touch', file, line, boundary: 'clock' });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { touches, violations };
}

export function formatBoundaryViolations(
  violations: readonly UnlistedBoundaryTouchViolation[],
  registry: Readonly<Record<BoundaryName, BoundaryEntry>>,
): string {
  return violations.map((violation) => {
    const entry = registry[violation.boundary];
    const resolution = entry.status.kind === 'pending'
      ? `pending #${entry.status.issue}`
      : `ported adapters: ${entry.adapterModules.join(', ')}`;
    return `${violation.kind} ${violation.file}:${violation.line} ${violation.boundary} (${resolution})`;
  }).join('\n');
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

function isValueImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly || clause.name !== undefined) return !clause.isTypeOnly;
  if (clause.namedBindings === undefined || ts.isNamespaceImport(clause.namedBindings)) return true;
  const bindings = clause.namedBindings.elements;
  return bindings.length === 0 || bindings.some((binding) => !binding.isTypeOnly);
}

function isValueExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly || statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)) {
    return !statement.isTypeOnly;
  }
  const bindings = statement.exportClause.elements;
  return bindings.length === 0 || bindings.some((binding) => !binding.isTypeOnly);
}
