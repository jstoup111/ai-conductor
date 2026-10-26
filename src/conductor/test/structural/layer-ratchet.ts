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
  | CycleViolation
  | MalformedEntryViolation
  | StaleEntryViolation;

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
  allowlistEntry?: string;
}

interface CycleViolation {
  kind: 'cycle';
  file: string;
  line: number;
  imported: string;
  cycle: readonly string[];
  allowlistEntry?: string;
}

interface MalformedEntryViolation {
  kind: 'malformed-entry';
  entry: string;
}

interface StaleEntryViolation { kind: 'stale-entry'; entry: string; reason: 'edge-missing' | 'not-a-violation'; }

export interface AllowlistPair {
  from: string;
  to: string;
}

export interface LayerRatchetResult {
  scannedFileCount: number;
  edges: LayerRatchetEdge[];
  violations: LayerRatchetViolation[];
}

export interface LayerRatchetInput {
  files: ReadonlyMap<string, string>;
  /** Allowlist entries, one `from -> to` line each, as returned by `readAllowlistEntries`. */
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

export function checkLayerRatchet({ files, allowlist }: LayerRatchetInput): LayerRatchetResult {
  const edges: LayerRatchetEdge[] = [];
  const valueEdges: LayerRatchetEdge[] = [];
  const violations: LayerRatchetViolation[] = [];

  // Strictly ascending order keeps the file free of duplicates and makes concurrent
  // additions land on different lines.
  let previous: string | undefined;
  for (const entry of allowlist) {
    if (parseAllowlistEntry(entry) === undefined || (previous !== undefined && entry <= previous)) {
      violations.push({ kind: 'malformed-entry', entry });
    } else {
      previous = entry;
    }
  }

  for (const [file, source] of files) {
    if (layerFor(file) === undefined) violations.push({ kind: 'unclassifiable-file', file });

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    // Preserve the original value-only graph for D5's cycle rule.
    for (const statement of sourceFile.statements) {
      const specifier = valueSpecifier(statement);
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const imported = resolveSpecifier(file, specifier, files);
      if (imported !== undefined && !valueEdges.some((edge) => edge.file === file && edge.imported === imported)) {
        valueEdges.push({ file, imported, line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1 });
      }
    }
    for (const reference of moduleReferences(sourceFile)) {
      if (!reference.specifier.startsWith('.')) continue;

      const imported = resolveSpecifier(file, reference.specifier, files);
      const line = sourceFile.getLineAndCharacterOfPosition(reference.node.getStart(sourceFile)).line + 1;
      if (imported === undefined) {
        violations.push({ kind: 'unresolved-specifier', file, line, specifier: reference.specifier });
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

  // D5's cycle rule deliberately remains value-edge-only. Type and dynamic
  // references are nevertheless upward edges and are checked above.
  const cycles = cycleMembership(valueEdges);
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

  const allowedPairs = new Set(allowlist.flatMap((entry) => {
    const pair = parseAllowlistEntry(entry);
    return pair === undefined ? [] : [`${pair.from}\u0000${pair.to}`];
  }));
  const livePairs = new Set(violations.flatMap((violation) => (
    violation.kind === 'upward' || violation.kind === 'cycle' ? [`${violation.file}\u0000${violation.imported}`] : []
  )));
  for (const entry of allowlist) {
    const pair = parseAllowlistEntry(entry);
    if (pair === undefined) continue;
    const key = `${pair.from}\u0000${pair.to}`;
    if (!edges.some((edge) => edge.file === pair.from && edge.imported === pair.to)) {
      violations.push({ kind: 'stale-entry', entry, reason: 'edge-missing' });
    } else if (!livePairs.has(key)) {
      violations.push({ kind: 'stale-entry', entry, reason: 'not-a-violation' });
    }
  }
  const uncovered: LayerRatchetViolation[] = [];
  for (const violation of violations) {
    if (violation.kind !== 'upward' && violation.kind !== 'cycle') {
      uncovered.push(violation);
      continue;
    }
    const allowlistEntry = formatAllowlistEntry(violation.file, violation.imported);
    if (allowedPairs.has(`${violation.file}\u0000${violation.imported}`)) continue;
    const named: UpwardViolation | CycleViolation = { ...violation };
    Object.defineProperty(named, 'allowlistEntry', { value: allowlistEntry, enumerable: false });
    uncovered.push(named);
  }
  return { scannedFileCount: files.size, edges, violations: uncovered };
}

export function formatRatchetViolations(violations: readonly LayerRatchetViolation[]): string {
  return violations.map((violation) => {
    const location = violation.kind === 'malformed-entry' || violation.kind === 'stale-entry'
      ? violation.entry
      : 'line' in violation ? `${violation.file}:${violation.line}` : violation.file;
    const detail = violation.kind === 'upward' ? violation.edge
      : violation.kind === 'cycle' ? violation.cycle.join(' -> ') : violation.kind;
    const name = 'allowlistEntry' in violation && violation.allowlistEntry !== undefined
      ? ` (allowlist entry: ${violation.allowlistEntry})` : '';
    return `${violation.kind} ${location} ${detail}${name}`;
  }).join('\n');
}

const ALLOWLIST_SEPARATOR = ' -> ';

export function formatAllowlistEntry(from: string, to: string): string {
  return `${from}${ALLOWLIST_SEPARATOR}${to}`;
}

/** A canonical `from -> to` line naming two source-relative `.ts` paths, or undefined. */
export function parseAllowlistEntry(entry: string): AllowlistPair | undefined {
  const parts = entry.split(ALLOWLIST_SEPARATOR);
  if (parts.length !== 2) return undefined;
  const [from, to] = parts;
  if (!isAllowlistPath(from) || !isAllowlistPath(to)) return undefined;
  return formatAllowlistEntry(from, to) === entry ? { from, to } : undefined;
}

/** The entry lines of an allowlist file; blank lines and `#` comments are not entries. */
export function readAllowlistEntries(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
}

function isAllowlistPath(path: string): boolean {
  return path.endsWith('.ts')
    && !path.startsWith('/')
    && !/\s/.test(path)
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
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

function moduleReferences(sourceFile: ts.SourceFile): readonly { node: ts.Node; specifier: string }[] {
  const references: { node: ts.Node; specifier: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ node, specifier: node.moduleSpecifier.text });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ node, specifier: node.moduleSpecifier.text });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      references.push({ node, specifier: node.argument.literal.text });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      references.push({ node, specifier: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function valueSpecifier(statement: ts.Statement): string | undefined {
  if (ts.isImportDeclaration(statement)) return isValueImport(statement) && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
  if (ts.isExportDeclaration(statement)) return isValueExport(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
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
