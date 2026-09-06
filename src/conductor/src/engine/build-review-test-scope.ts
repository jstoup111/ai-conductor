import {
  compareCoversMarkerBindings,
  type BoundCoversMarker,
  type BuildReviewTestBinding,
  type BuildReviewTestBindingsInput,
  type CoversMarker,
  type CoversMarkerAssociationChange,
  type UnresolvedCoversMarker,
} from './build-review-test-bindings.js';
import {
  analyzeTestDeclarations,
  compareTestDeclarations,
  type SupportedTestDeclaration,
  type TestDeclarationDiagnostic,
  type TestDeclarationSpan,
} from './build-review-test-declarations.js';
import ts from 'typescript';

export interface BuildReviewTestScopeInput {
  readonly base: BuildReviewTestBindingsInput;
  readonly head: BuildReviewTestBindingsInput;
  /** Supplied by later setup/dependency analysis; marker evidence remains mandatory. */
  readonly affectedOptedInGroups?: readonly BuildReviewConcreteAffectedGroup[];
}

export interface BuildReviewConcreteAffectedGroup {
  readonly declaration: SupportedTestDeclaration;
  readonly markers: readonly CoversMarker[];
}

/** A pinned source region retained as compact shared or unchanged-body evidence. */
export interface BuildReviewTestSourceReference {
  readonly source: { readonly fileName: string; readonly side: 'base' | 'head' };
  readonly region: TestDeclarationSpan;
}

export interface BuildReviewAffectedOptedInGroup {
  readonly suite: SupportedTestDeclaration;
  /** The first changed setup region, retained for consumers that need one primary anchor. */
  readonly setup: BuildReviewTestSourceReference & { readonly kind: 'hook' | 'fixture' | 'unresolved-setup' };
  /** Every changed setup region for this suite, deduplicated by source identity and range. */
  readonly sharedSources: readonly (BuildReviewTestSourceReference & { readonly kind: 'hook' | 'fixture' | 'unresolved-setup' })[];
  /** Opted-in descendant bodies are evidence, not directly changed declarations. */
  readonly unchangedDescendantBodies: readonly BuildReviewTestSourceReference[];
}

export interface EstablishedBuildReviewTestTarget {
  readonly declaration: SupportedTestDeclaration;
  readonly bindings: readonly BoundCoversMarker[];
  readonly associationChanges: readonly CoversMarkerAssociationChange[];
}

export type BuildReviewTestScopeCandidateReason =
  | 'binding-removed'
  | 'uncertain-association'
  | 'file-header-marker'
  | 'conflicting-associations'
  | 'declaration-group'
  | 'unsupported-declaration'
  | 'affected-opted-in-group';

export interface UncertainBuildReviewTestScopeCandidate {
  /** Present for parsed declarations/groups; absent for a source-bound parser diagnostic. */
  readonly declaration?: SupportedTestDeclaration;
  readonly diagnostic?: TestDeclarationDiagnostic;
  readonly markers: readonly CoversMarker[];
  readonly associationChanges: readonly CoversMarkerAssociationChange[];
  readonly reasons: readonly BuildReviewTestScopeCandidateReason[];
  readonly affectedGroup?: BuildReviewAffectedOptedInGroup;
}

export type BuildReviewTestScopeNote =
  | { readonly kind: 'unbound'; readonly declaration: SupportedTestDeclaration }
  | { readonly kind: 'unresolved-reference'; readonly declaration: SupportedTestDeclaration; readonly marker: CoversMarker }
  | { readonly kind: 'declaration-uncertainty'; readonly diagnostic: TestDeclarationDiagnostic };

export interface BuildReviewTestScope {
  readonly changedDeclarations: readonly SupportedTestDeclaration[];
  readonly targets: readonly EstablishedBuildReviewTestTarget[];
  readonly candidates: readonly UncertainBuildReviewTestScopeCandidate[];
  readonly notes: readonly BuildReviewTestScopeNote[];
  readonly affectedGroups: readonly BuildReviewAffectedOptedInGroup[];
  readonly sharedSources: readonly BuildReviewTestSourceReference[];
}

type TargetBinding = BoundCoversMarker | UnresolvedCoversMarker;

function declarationKey(declaration: SupportedTestDeclaration): string {
  return JSON.stringify([declaration.kind, declaration.titleChain, declaration.occurrence]);
}

function markerKey(marker: CoversMarker): string {
  return JSON.stringify(marker.reference);
}

function targetBindings(
  bindings: readonly BuildReviewTestBinding[],
  declaration: SupportedTestDeclaration,
): readonly TargetBinding[] {
  const key = declarationKey(declaration);
  return bindings.filter((binding): binding is TargetBinding =>
    (binding.kind === 'bound' || binding.kind === 'unresolved-reference') && declarationKey(binding.target) === key,
  );
}

function changedAssociationFor(
  changes: readonly CoversMarkerAssociationChange[],
  declaration: SupportedTestDeclaration,
): readonly CoversMarkerAssociationChange[] {
  const key = declarationKey(declaration);
  return changes.filter((change) =>
    change.binding.kind !== 'uncertain-association' && declarationKey(change.binding.target) === key,
  );
}

function isFileHeader(marker: CoversMarker, declarations: readonly SupportedTestDeclaration[]): boolean {
  const firstDeclaration = declarations.reduce<number | undefined>(
    (first, declaration) => first === undefined || declaration.span.start < first ? declaration.span.start : first,
    undefined,
  );
  return firstDeclaration !== undefined && marker.span.start < firstDeclaration;
}

/** An unattached marker can be ambiguous only for the next changed declaration, never its predecessors or siblings. */
function potentiallyApplicableUncertainMarkers(
  markers: readonly CoversMarker[],
  declaration: SupportedTestDeclaration,
  changedDeclarations: readonly SupportedTestDeclaration[],
  diagnostics: readonly TestDeclarationDiagnostic[],
): readonly CoversMarker[] {
  return markers.filter((marker) => {
    if (diagnostics.some((diagnostic) => diagnostic.span.start >= marker.span.end && diagnostic.span.start < declaration.span.start)) {
      return false;
    }
    const nextChanged = changedDeclarations
      .filter((candidate) => candidate.span.start >= marker.span.end)
      .sort((left, right) => left.span.start - right.span.start)[0];
    return nextChanged !== undefined && declarationKey(nextChanged) === declarationKey(declaration);
  });
}

function uniqueMarkers(markers: readonly CoversMarker[]): readonly CoversMarker[] {
  const seen = new Set<string>();
  return Object.freeze(markers.filter((marker) => {
    const key = `${marker.span.start}:${marker.span.end}:${markerKey(marker)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function sourceReference(
  fileName: string,
  region: TestDeclarationSpan,
  side: 'base' | 'head' = 'head',
): BuildReviewTestSourceReference {
  return Object.freeze({
    source: Object.freeze({ fileName, side }),
    region: Object.freeze({ ...region }),
  });
}

function sourceReferenceKey(reference: BuildReviewTestSourceReference): string {
  return JSON.stringify([reference.source.fileName, reference.source.side, reference.region.start, reference.region.end]);
}

function uniqueSourceReferences<T extends BuildReviewTestSourceReference>(references: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return Object.freeze(references.filter((reference) => {
    const key = sourceReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function candidate(
  declaration: SupportedTestDeclaration | undefined,
  markers: readonly CoversMarker[],
  associationChanges: readonly CoversMarkerAssociationChange[],
  reasons: readonly BuildReviewTestScopeCandidateReason[],
  diagnostic?: TestDeclarationDiagnostic,
  affectedGroup?: BuildReviewAffectedOptedInGroup,
): UncertainBuildReviewTestScopeCandidate {
  return Object.freeze({
    ...(declaration ? { declaration } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(affectedGroup ? { affectedGroup } : {}),
    markers: uniqueMarkers(markers),
    associationChanges: Object.freeze([...associationChanges]),
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

const SETUP_HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

interface SetupRegion {
  readonly kind: 'hook' | 'fixture' | 'unresolved-setup';
  readonly suite: SupportedTestDeclaration;
  readonly reference: BuildReviewAffectedOptedInGroup['setup'];
  readonly correspondenceKey: string;
  readonly fingerprint: string;
}

function sourceSupportsSetupAnalysis(fileName: string): boolean {
  return SCRIPT_EXTENSIONS.has(fileName.slice(fileName.lastIndexOf('.')).toLowerCase());
}

function sourceText(source: BuildReviewTestBindingsInput['source']): string {
  return new TextDecoder('utf-8').decode(source.bytes);
}

function normalizedSource(text: string, start: number, end: number): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  scanner.setTextPos(start);
  const tokens: string[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken || scanner.getTokenPos() >= end) break;
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia && kind !== ts.SyntaxKind.SemicolonToken) {
      tokens.push(`${kind}:${scanner.getTokenText()}`);
    }
  }
  return tokens.join('|');
}

function innermostSuite(
  declaration: TestDeclarationSpan,
  suites: readonly SupportedTestDeclaration[],
): SupportedTestDeclaration | undefined {
  return suites
    .filter((suite) => suite.bodySpan
      && suite.bodySpan.start <= declaration.start
      && declaration.end <= suite.bodySpan.end)
    .sort((left, right) => (left.bodySpan!.end - left.bodySpan!.start) - (right.bodySpan!.end - right.bodySpan!.start))[0];
}

function isInsideTestBody(
  declaration: TestDeclarationSpan,
  declarations: readonly SupportedTestDeclaration[],
): boolean {
  return declarations.some((entry) => (entry.kind === 'test' || entry.kind === 'group')
    && entry.bodySpan
    && entry.bodySpan.start <= declaration.start
    && declaration.end <= entry.bodySpan.end);
}

function hookName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && SETUP_HOOKS.has(expression.text)) return expression.text;
  return undefined;
}

function mentionsSetupHook(node: ts.Node): boolean {
  let mentioned = false;
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && SETUP_HOOKS.has(child.text)) mentioned = true;
    if (!mentioned) ts.forEachChild(child, visit);
  };
  visit(node);
  return mentioned;
}

function fixtureName(node: ts.VariableDeclaration): string | undefined {
  if (!ts.isIdentifier(node.name)) return undefined;
  if (/fixture/i.test(node.name.text)) return node.name.text;
  const initializer = node.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return undefined;
  const callee = initializer.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name && /fixture/i.test(name) ? node.name.text : undefined;
}

/**
 * Setup is deliberately a compact syntax-only analysis: hooks and fixture
 * declarations are separate from parsed test bodies, and unfamiliar hook
 * wrappers remain explicit uncertainty instead of inferred test changes.
 */
function analyzeSetupRegions(
  source: BuildReviewTestBindingsInput['source'],
  declarations: readonly SupportedTestDeclaration[],
  suites: readonly SupportedTestDeclaration[],
  side: 'base' | 'head',
): readonly SetupRegion[] {
  if (!sourceSupportsSetupAnalysis(source.fileName)) return [];
  const text = sourceText(source);
  const sourceFile = ts.createSourceFile(source.fileName, text, ts.ScriptTarget.Latest, true);
  const regions: Array<Omit<SetupRegion, 'correspondenceKey'> & { readonly label: string }> = [];
  const add = (kind: SetupRegion['kind'], node: ts.Node, label: string): void => {
    const region = { start: node.getStart(sourceFile), end: node.getEnd() };
    const suite = innermostSuite(region, suites);
    if (!suite || isInsideTestBody(region, declarations)) return;
    const reference = Object.freeze({
      ...sourceReference(source.fileName, region, side),
      kind,
    });
    regions.push({
      kind,
      suite,
      reference,
      label,
      fingerprint: normalizedSource(text, region.start, region.end),
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const knownHook = hookName(node.expression);
      if (knownHook) {
        add('hook', node, knownHook);
      } else if (mentionsSetupHook(node.expression)
        && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        add('unresolved-setup', node, 'unresolved-setup');
      }
    }
    if (ts.isVariableDeclaration(node)) {
      const name = fixtureName(node);
      if (name) add('fixture', node, name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const occurrences = new Map<string, number>();
  return Object.freeze(regions.map((region) => {
    const suiteKey = declarationKey(region.suite);
    const baseKey = JSON.stringify([suiteKey, region.kind, region.label]);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return Object.freeze({
      kind: region.kind,
      suite: region.suite,
      reference: region.reference,
      fingerprint: region.fingerprint,
      correspondenceKey: JSON.stringify([baseKey, occurrence]),
    });
  }));
}

function declarationInsideSuite(declaration: SupportedTestDeclaration, suite: SupportedTestDeclaration): boolean {
  return Boolean(suite.bodySpan
    && suite.bodySpan.start <= declaration.span.start
    && declaration.span.end <= suite.bodySpan.end);
}

function derivedAffectedGroups(
  base: BuildReviewTestBindingsInput,
  head: BuildReviewTestBindingsInput,
  baseAnalysis: ReturnType<typeof analyzeTestDeclarations>,
  headAnalysis: ReturnType<typeof analyzeTestDeclarations>,
  bindings: readonly BuildReviewTestBinding[],
  changedDeclarations: readonly SupportedTestDeclaration[],
): readonly BuildReviewAffectedOptedInGroup[] {
  const baseRegions = new Map(analyzeSetupRegions(base.source, baseAnalysis.declarations, baseAnalysis.suites, 'base')
    .map((region) => [region.correspondenceKey, region]));
  const headRegions = analyzeSetupRegions(head.source, headAnalysis.declarations, headAnalysis.suites, 'head');
  const headByKey = new Map(headRegions.map((region) => [region.correspondenceKey, region]));
  const headSuites = new Map(headAnalysis.suites.map((suite) => [declarationKey(suite), suite]));
  const changedRegions = [
    ...headRegions.filter((region) => baseRegions.get(region.correspondenceKey)?.fingerprint !== region.fingerprint),
    ...[...baseRegions.values()]
      .filter((region) => !headByKey.has(region.correspondenceKey))
      .flatMap((region) => {
        const suite = headSuites.get(declarationKey(region.suite));
        return suite ? [Object.freeze({ ...region, suite })] : [];
      }),
  ];
  const changedBySuite = new Map<string, SetupRegion[]>();
  for (const region of changedRegions) {
    const key = declarationKey(region.suite);
    const existing = changedBySuite.get(key) ?? [];
    existing.push(region);
    changedBySuite.set(key, existing);
  }
  const changedKeys = new Set(changedDeclarations.map(declarationKey));
  const groups: BuildReviewAffectedOptedInGroup[] = [];
  for (const regions of changedBySuite.values()) {
    const suite = regions[0]!.suite;
    const descendants = bindings
      .filter((binding): binding is BoundCoversMarker => binding.kind === 'bound')
      .filter((binding) => declarationInsideSuite(binding.target, suite) && !changedKeys.has(declarationKey(binding.target)));
    if (descendants.length === 0) continue;
    const sharedSources = uniqueSourceReferences(regions.map((region) => region.reference));
    const unchangedDescendantBodies = uniqueSourceReferences(descendants
      .flatMap((binding) => binding.target.bodySpan ? [sourceReference(head.source.fileName, binding.target.bodySpan)] : []));
    if (unchangedDescendantBodies.length === 0) continue;
    groups.push(Object.freeze({
      suite,
      setup: sharedSources[0]!,
      sharedSources,
      unchangedDescendantBodies,
    }));
  }
  return Object.freeze(groups);
}

function diagnosticChanged(
  diagnostic: TestDeclarationDiagnostic,
  baseDiagnostics: readonly TestDeclarationDiagnostic[],
  baseText: string,
  headText: string,
): boolean {
  const headSource = headText.slice(diagnostic.span.start, diagnostic.span.end);
  return !baseDiagnostics.some((base) =>
    base.reason === diagnostic.reason && baseText.slice(base.span.start, base.span.end) === headSource,
  );
}

/**
 * Builds the local, source-only portion of test-quality scope.  It treats
 * malformed associations as evidence about one changed declaration, never as
 * permission to admit the whole file or to reuse base-side authority.
 */
export function analyzeBuildReviewTestScope(input: BuildReviewTestScopeInput): BuildReviewTestScope {
  const compared = compareTestDeclarations(input.base.source, input.head.source);
  const associations = compareCoversMarkerBindings(input);
  const baseAnalysis = analyzeTestDeclarations(input.base.source);
  const headAnalysis = analyzeTestDeclarations(input.head.source);
  const changedDeclarations = compared.changed;
  const targets: EstablishedBuildReviewTestTarget[] = [];
  const candidates: UncertainBuildReviewTestScopeCandidate[] = [];
  const notes: BuildReviewTestScopeNote[] = [];
  const headUncertainMarkers = associations.head.bindings
    .filter((binding): binding is Extract<BuildReviewTestBinding, { kind: 'uncertain-association' }> => binding.kind === 'uncertain-association');
  const affectedGroups = derivedAffectedGroups(
    input.base,
    input.head,
    baseAnalysis,
    headAnalysis,
    associations.head.bindings,
    changedDeclarations,
  );

  for (const declaration of changedDeclarations) {
    const headBindings = targetBindings(associations.head.bindings, declaration);
    const bound = headBindings.filter((binding): binding is BoundCoversMarker => binding.kind === 'bound');
    const unresolved = headBindings.filter((binding): binding is UnresolvedCoversMarker => binding.kind === 'unresolved-reference');
    const associationChanges = changedAssociationFor(associations.changes, declaration);
    const localUncertainMarkers = potentiallyApplicableUncertainMarkers(
      headUncertainMarkers.map((binding) => binding.marker),
      declaration,
      changedDeclarations,
      headAnalysis.diagnostics,
    );
    const distinctBoundReferences = new Set(bound.map((binding) => markerKey(binding.marker)));
    const removedBound = associationChanges.filter((change) => change.kind === 'removed' && change.binding.kind === 'bound');

    for (const binding of unresolved) {
      notes.push(Object.freeze({ kind: 'unresolved-reference', declaration, marker: binding.marker }));
    }
    if (headBindings.length === 0) notes.push(Object.freeze({ kind: 'unbound', declaration }));

    if (declaration.kind === 'group' && bound.length > 0) {
      candidates.push(candidate(declaration, bound.map((binding) => binding.marker), associationChanges, ['declaration-group']));
      continue;
    }

    if (distinctBoundReferences.size > 1) {
      candidates.push(candidate(declaration, bound.map((binding) => binding.marker), associationChanges, ['conflicting-associations']));
      continue;
    }

    if (localUncertainMarkers.length > 0) {
      candidates.push(candidate(
        declaration,
        localUncertainMarkers,
        associationChanges,
        [localUncertainMarkers.some((marker) => isFileHeader(marker, headAnalysis.declarations)) ? 'file-header-marker' : 'uncertain-association'],
      ));
      continue;
    }

    if (removedBound.length > 0 && bound.length === 0) {
      candidates.push(candidate(
        declaration,
        removedBound.map((change) => change.binding.marker),
        associationChanges,
        ['binding-removed'],
      ));
      continue;
    }

    if (bound.length === 1) {
      targets.push(Object.freeze({ declaration, bindings: Object.freeze(bound), associationChanges: Object.freeze([...associationChanges]) }));
    }
  }

  for (const group of input.affectedOptedInGroups ?? []) {
    if (group.markers.length === 0) continue;
    candidates.push(candidate(group.declaration, group.markers, [], ['affected-opted-in-group']));
  }

  for (const group of affectedGroups) {
    const unchangedBodyKeys = new Set(group.unchangedDescendantBodies.map(sourceReferenceKey));
    const groupMarkers = associations.head.bindings
      .filter((binding): binding is BoundCoversMarker => binding.kind === 'bound')
      .filter((binding) => binding.target.bodySpan
        && declarationInsideSuite(binding.target, group.suite)
        && unchangedBodyKeys.has(sourceReferenceKey(sourceReference(input.head.source.fileName, binding.target.bodySpan))))
      .map((binding) => binding.marker);
    candidates.push(candidate(
      group.suite,
      groupMarkers,
      [],
      ['affected-opted-in-group'],
      undefined,
      group,
    ));
  }

  // A parser diagnostic becomes a candidate only with both pinned source
  // change and concrete marker evidence.  It remains source-bound rather than
  // fabricating an executable declaration or admitting sibling tests.
  if (headUncertainMarkers.length > 0) {
    const baseText = new TextDecoder('utf-8').decode(input.base.source.bytes);
    const headText = new TextDecoder('utf-8').decode(input.head.source.bytes);
    for (const diagnostic of headAnalysis.diagnostics) {
      if (!diagnosticChanged(diagnostic, baseAnalysis.diagnostics, baseText, headText)) continue;
      const applicableMarkers = headUncertainMarkers
        .map((binding) => binding.marker)
        .filter((marker) => marker.span.end <= diagnostic.span.start);
      if (applicableMarkers.length === 0) continue;
      candidates.push(candidate(
        undefined,
        applicableMarkers,
        [],
        ['unsupported-declaration'],
        diagnostic,
      ));
    }
  }

  for (const diagnostic of headAnalysis.diagnostics) {
    notes.push(Object.freeze({ kind: 'declaration-uncertainty', diagnostic }));
  }

  return Object.freeze({
    changedDeclarations: Object.freeze([...changedDeclarations]),
    targets: Object.freeze(targets),
    candidates: Object.freeze(candidates),
    notes: Object.freeze(notes),
    affectedGroups,
    sharedSources: uniqueSourceReferences(affectedGroups.flatMap((group) => group.sharedSources)),
  });
}
