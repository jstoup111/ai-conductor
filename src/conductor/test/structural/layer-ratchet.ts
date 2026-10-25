import { posix } from 'node:path';
import ts from 'typescript';

export interface LayerRatchetEdge {
  file: string;
  imported: string;
  line: number;
}

export type LayerRatchetViolation = UnclassifiableFileViolation | UnresolvedSpecifierViolation;

interface UnclassifiableFileViolation {
  kind: 'unclassifiable-file';
  file: string;
}

interface UnresolvedSpecifierViolation {
  kind: 'unresolved-specifier';
  file: string;
  line: number;
  specifier: string;
}

export interface LayerRatchetResult {
  scannedFileCount: number;
  edges: LayerRatchetEdge[];
  violations: LayerRatchetViolation[];
}

export interface LayerRatchetInput {
  files: ReadonlyMap<string, string>;
  allowlist: readonly string[];
}

const LAYERS = new Set(['types', 'execution', 'engine', 'ui', 'tools']);

export function checkLayerRatchet({ files }: LayerRatchetInput): LayerRatchetResult {
  const edges: LayerRatchetEdge[] = [];
  const violations: LayerRatchetViolation[] = [];

  for (const [file, source] of files) {
    if (!isClassifiable(file)) violations.push({ kind: 'unclassifiable-file', file });

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;

      const imported = resolveSpecifier(file, specifier, files);
      const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      if (imported === undefined) {
        violations.push({ kind: 'unresolved-specifier', file, line, specifier });
      } else {
        edges.push({ file, imported, line });
      }
    }
  }

  return { scannedFileCount: files.size, edges, violations };
}

function isClassifiable(file: string): boolean {
  const [firstSegment, ...remainingSegments] = file.split('/');
  return remainingSegments.length === 0 || LAYERS.has(firstSegment);
}

function resolveSpecifier(
  file: string,
  specifier: string,
  files: ReadonlyMap<string, string>,
): string | undefined {
  const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) return undefined;

  const modulePath = resolved.endsWith('.js') ? `${resolved.slice(0, -3)}.ts` : resolved;
  if (files.has(modulePath)) return modulePath;

  const indexPath = `${modulePath}/index.ts`;
  return files.has(indexPath) ? indexPath : undefined;
}
