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
  | UpwardViolation
  | CycleViolation;

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

interface CycleViolation {
  kind: 'cycle';
  file: string;
  line: number;
  imported: string;
  cycle: readonly string[];
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
      const specifier = valueSpecifier(statement);
      if (specifier === undefined) continue;
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

  const cycles = cycleMembership(edges);
  for (const edge of edges) {
    const cycle = cycles.get(edge.file);
    if (cycle !== undefined && cycles.get(edge.imported) === cycle) {
      violations.push({
        kind: 'cycle',
        file: edge.file,
        line: edge.line,
        imported: edge.imported,
        cycle,
      });
    }
  }

  return { scannedFileCount: files.size, edges, violations };
}

interface TarjanFrame {
  file: string;
  neighbors: readonly string[];
  nextNeighbor: number;
}

function cycleMembership(edges: readonly LayerRatchetEdge[]): ReadonlyMap<string, readonly string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const neighbors = outgoing.get(edge.file) ?? [];
    neighbors.push(edge.imported);
    outgoing.set(edge.file, neighbors);
    if (!outgoing.has(edge.imported)) outgoing.set(edge.imported, []);
  }

  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const membership = new Map<string, readonly string[]>();
  let index = 0;

  for (const root of outgoing.keys()) {
    if (indices.has(root)) continue;

    indices.set(root, index);
    lowlinks.set(root, index++);
    stack.push(root);
    onStack.add(root);
    const frames: TarjanFrame[] = [{ file: root, neighbors: outgoing.get(root) ?? [], nextNeighbor: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.nextNeighbor < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.nextNeighbor++];
        if (!indices.has(neighbor)) {
          indices.set(neighbor, index);
          lowlinks.set(neighbor, index++);
          stack.push(neighbor);
          onStack.add(neighbor);
          frames.push({ file: neighbor, neighbors: outgoing.get(neighbor) ?? [], nextNeighbor: 0 });
        } else if (onStack.has(neighbor)) {
          lowlinks.set(frame.file, Math.min(lowlinks.get(frame.file)!, indices.get(neighbor)!));
        }
        continue;
      }

      frames.pop();
      if (lowlinks.get(frame.file) === indices.get(frame.file)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.file);
        if (component.length > 1) {
          const cycle = component.sort();
          for (const member of cycle) membership.set(member, cycle);
        }
      }

      const parent = frames.at(-1);
      if (parent !== undefined) {
        lowlinks.set(parent.file, Math.min(lowlinks.get(parent.file)!, lowlinks.get(frame.file)!));
      }
    }
  }

  return membership;
}

function valueSpecifier(statement: ts.Statement): string | undefined {
  if (ts.isImportDeclaration(statement)) {
    if (!isValueImport(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
    return statement.moduleSpecifier.text;
  }
  if (ts.isExportDeclaration(statement)) {
    if (
      !isValueExport(statement)
      || statement.moduleSpecifier === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)
    ) return undefined;
    return statement.moduleSpecifier.text;
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
