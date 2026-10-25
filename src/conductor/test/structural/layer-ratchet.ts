import { posix } from 'node:path';
import ts from 'typescript';

export interface LayerRatchetEdge {
  file: string;
  imported: string;
  line: number;
}

export type LayerRatchetViolation =
  | UnclassifiableFileViolation
  | UnresolvedSpecifierViolation
  | UpwardViolation;

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

interface UpwardViolation {
  kind: 'upward';
  file: string;
  line: number;
  imported: string;
  edge: string;
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

type Layer = 'types' | 'execution' | 'engine' | 'ui' | 'tools' | 'entry';

const LAYERS = new Set<Layer>(['types', 'execution', 'engine', 'ui', 'tools']);
const LAYER_RANK: Readonly<Record<Exclude<Layer, 'tools'>, number>> = {
  types: 0,
  execution: 1,
  engine: 2,
  ui: 3,
  entry: 4,
};

export function checkLayerRatchet({ files }: LayerRatchetInput): LayerRatchetResult {
  const edges: LayerRatchetEdge[] = [];
  const violations: LayerRatchetViolation[] = [];

  for (const [file, source] of files) {
    if (layerFor(file) === undefined) violations.push({ kind: 'unclassifiable-file', file });

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;

      const imported = resolveSpecifier(file, specifier, files);
      const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      if (imported === undefined) {
        violations.push({ kind: 'unresolved-specifier', file, line, specifier });
      } else if (!edges.some((edge) => edge.file === file && edge.imported === imported)) {
        edges.push({ file, imported, line });
      }
    }
  }

  for (const edge of edges) {
    const from = layerFor(edge.file);
    const to = layerFor(edge.imported);
    if (from !== undefined && to !== undefined && isForbiddenEdge(from, to)) {
      violations.push({
        kind: 'upward',
        file: edge.file,
        line: edge.line,
        imported: edge.imported,
        edge: `${from} -> ${to}`,
      });
    }
  }

  return { scannedFileCount: files.size, edges, violations };
}

function layerFor(file: string): Layer | undefined {
  const [firstSegment, ...remainingSegments] = file.split('/');
  if (remainingSegments.length === 0) return 'entry';
  return LAYERS.has(firstSegment as Layer) ? firstSegment as Layer : undefined;
}

function isForbiddenEdge(from: Layer, to: Layer): boolean {
  if (to === 'tools') return from !== 'tools';
  if (from === 'tools') return to !== 'engine' && to !== 'types';
  if (to === 'entry') return from !== 'entry';
  return LAYER_RANK[to] > LAYER_RANK[from];
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
