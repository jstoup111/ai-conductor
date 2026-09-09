import { posix } from 'node:path';

import ts from 'typescript';

import { parsePlanTaskPaths } from './plan-task-parse.js';

export type BuildReviewDependencySourceSide = 'base' | 'head';

/** Pinned source identity; callers provide its bytes through the injected reader. */
export interface BuildReviewDependencySourceReference {
  readonly source: { readonly fileName: string; readonly side: BuildReviewDependencySourceSide };
}

/** A syntactically proved local chain from one test seed to changed source. */
export interface BuildReviewScopeDependencyEffect {
  readonly seed: BuildReviewDependencySourceReference;
  readonly chain: readonly BuildReviewDependencySourceReference[];
  readonly changedSources: readonly BuildReviewDependencySourceReference[];
}

export type BuildReviewDependencyUncertaintyKind = 'dynamic-import' | 'unsupported-resolution' | 'ambiguous-resolution';

/** A non-executed graph edge whose target could not be established from syntax. */
export interface BuildReviewScopeDependencyUncertainty {
  readonly kind: BuildReviewDependencyUncertaintyKind;
  readonly source: BuildReviewDependencySourceReference;
  readonly chain: readonly BuildReviewDependencySourceReference[];
}

export interface BuildReviewScopeDependencyReader {
  /** Reads only a frozen blob for the requested side; undefined means that side is absent. */
  read(side: BuildReviewDependencySourceSide, path: string): Promise<string | undefined>;
}

export interface BuildReviewScopeDependenciesInput {
  readonly reader: BuildReviewScopeDependencyReader;
  /** Changed test paths are already identified by declaration comparison. */
  readonly changedTestPaths: readonly string[];
  /** Existing test paths named by explicit plan Files entries are discovery seeds only. */
  readonly planText: string;
}

export interface BuildReviewScopeDependencies {
  readonly effects: readonly BuildReviewScopeDependencyEffect[];
  readonly uncertainties: readonly BuildReviewScopeDependencyUncertainty[];
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function reference(fileName: string, side: BuildReviewDependencySourceSide = 'head'): BuildReviewDependencySourceReference {
  return Object.freeze({ source: Object.freeze({ fileName, side }) });
}

function referenceKey(value: BuildReviewDependencySourceReference): string {
  return `${value.source.side}\0${value.source.fileName}`;
}

function isPlanTestPath(path: string): boolean {
  return /(?:^|\/)(?:test|tests)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path);
}

function localSpecifier(value: ts.Expression): string | undefined {
  return ts.isStringLiteral(value) && value.text.startsWith('.') ? value.text : undefined;
}

interface ImportEdge {
  readonly kind: 'relative' | BuildReviewDependencyUncertaintyKind;
  readonly specifier?: string;
}

function importsFrom(path: string, text: string): readonly ImportEdge[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edges: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && localSpecifier(node.moduleSpecifier);
      if (specifier) edges.push(Object.freeze({ kind: 'relative', specifier }));
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        edges.push(Object.freeze({ kind: 'dynamic-import' }));
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const specifier = localSpecifier(node.arguments[0] ?? node.expression);
        edges.push(Object.freeze(specifier
          ? { kind: 'relative', specifier }
          : { kind: 'unsupported-resolution' }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.freeze(edges);
}

function candidatePaths(from: string, specifier: string): readonly string[] {
  const raw = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (!raw || raw === '.' || raw === '..' || raw.startsWith('../') || posix.isAbsolute(raw)) return [];
  const extension = posix.extname(raw);
  if (extension) return [raw];
  return Object.freeze([...EXTENSIONS.map((suffix) => `${raw}${suffix}`), ...EXTENSIONS.map((suffix) => `${raw}/index${suffix}`)]);
}

function unique<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  const seen = new Set<string>();
  return Object.freeze(values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  }));
}

/**
 * Discovers only syntax-resolved project-local dependencies. It never loads a
 * consumer module; the reader is normally backed by the assembly blob cache.
 */
export async function discoverBuildReviewScopeDependencies(
  input: BuildReviewScopeDependenciesInput,
): Promise<BuildReviewScopeDependencies> {
  const reads = new Map<string, Promise<string | undefined>>();
  const read = (side: BuildReviewDependencySourceSide, path: string): Promise<string | undefined> => {
    const key = `${side}\0${path}`;
    let pending = reads.get(key);
    if (!pending) {
      pending = input.reader.read(side, path);
      reads.set(key, pending);
    }
    return pending;
  };
  const seeds = unique([
    ...input.changedTestPaths,
    ...[...parsePlanTaskPaths(input.planText).values()].flatMap((paths) => [...paths].filter(isPlanTestPath)),
  ].filter(isPlanTestPath), (path) => path);
  const effects: BuildReviewScopeDependencyEffect[] = [];
  const uncertainties: BuildReviewScopeDependencyUncertainty[] = [];

  for (const seedPath of seeds) {
    const visited = new Set<string>();
    const walk = async (path: string, chain: readonly BuildReviewDependencySourceReference[]): Promise<void> => {
      if (visited.has(path)) return;
      visited.add(path);
      const head = await read('head', path);
      if (head === undefined) return;
      const base = await read('base', path);
      if (chain.length > 1 && head !== base) {
        effects.push(Object.freeze({
          seed: reference(seedPath),
          chain: Object.freeze([...chain]),
          changedSources: Object.freeze([reference(path, 'base'), reference(path)]),
        }));
      }
      for (const edge of importsFrom(path, head)) {
        if (edge.kind !== 'relative') {
          uncertainties.push(Object.freeze({ kind: edge.kind, source: reference(path), chain: Object.freeze([...chain]) }));
          continue;
        }
        const candidates = candidatePaths(path, edge.specifier!);
        const resolved = (await Promise.all(candidates.map(async (candidate) =>
          (await read('head', candidate)) === undefined ? undefined : candidate,
        ))).filter((candidate): candidate is string => candidate !== undefined);
        if (resolved.length !== 1) {
          uncertainties.push(Object.freeze({
            kind: resolved.length === 0 ? 'unsupported-resolution' : 'ambiguous-resolution',
            source: reference(path),
            chain: Object.freeze([...chain]),
          }));
          continue;
        }
        const next = resolved[0]!;
        await walk(next, Object.freeze([...chain, reference(next)]));
      }
    };
    await walk(seedPath, Object.freeze([reference(seedPath)]));
  }

  return Object.freeze({
    effects: unique(effects, (effect) => JSON.stringify([referenceKey(effect.seed), effect.chain.map(referenceKey), effect.changedSources.map(referenceKey)])),
    uncertainties: unique(uncertainties, (uncertainty) => JSON.stringify([uncertainty.kind, referenceKey(uncertainty.source), uncertainty.chain.map(referenceKey)])),
  });
}
