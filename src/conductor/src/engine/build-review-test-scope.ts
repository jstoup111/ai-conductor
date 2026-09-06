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
} from './build-review-test-declarations.js';

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

function candidate(
  declaration: SupportedTestDeclaration | undefined,
  markers: readonly CoversMarker[],
  associationChanges: readonly CoversMarkerAssociationChange[],
  reasons: readonly BuildReviewTestScopeCandidateReason[],
  diagnostic?: TestDeclarationDiagnostic,
): UncertainBuildReviewTestScopeCandidate {
  return Object.freeze({
    ...(declaration ? { declaration } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    markers: uniqueMarkers(markers),
    associationChanges: Object.freeze([...associationChanges]),
    reasons: Object.freeze([...new Set(reasons)]),
  });
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
  });
}
