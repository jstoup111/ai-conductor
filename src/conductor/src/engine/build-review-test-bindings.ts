import ts from 'typescript';
import { parseCoversMarkers, type CoversReference } from './covers-marker.js';
import {
  analyzeTestDeclarations,
  type SupportedTestDeclaration,
  type TestDeclarationSource,
  type TestDeclarationSpan,
} from './build-review-test-declarations.js';
import { resolvePlanTaskReference } from './plan-task-parse.js';
import { extractStoryCriterionIds } from './story-criteria.js';
import { parsePlanTaskBodies } from './plan-task-parse.js';

export interface BuildReviewTestBindingsInput {
  readonly source: TestDeclarationSource;
  readonly storiesText: string;
  readonly planText: string;
}

export interface CoversMarker {
  readonly span: TestDeclarationSpan;
  readonly reference: CoversReference;
}

export interface CoversMarkerOwner {
  readonly kind: 'suite' | 'test' | 'group';
  readonly association: 'leading-comment' | 'title';
  readonly declaration: SupportedTestDeclaration;
}

export interface BoundCoversMarker {
  readonly kind: 'bound';
  readonly target: SupportedTestDeclaration;
  readonly marker: CoversMarker;
  readonly owner: CoversMarkerOwner;
}

export interface UnresolvedCoversMarker {
  readonly kind: 'unresolved-reference';
  readonly target: SupportedTestDeclaration;
  readonly marker: CoversMarker;
  readonly owner: CoversMarkerOwner;
}

export interface UnboundTestDeclaration {
  readonly kind: 'unbound';
  readonly target: SupportedTestDeclaration;
}

export interface UncertainCoversAssociation {
  readonly kind: 'uncertain-association';
  readonly marker: CoversMarker;
}

export type BuildReviewTestBinding =
  | BoundCoversMarker
  | UnresolvedCoversMarker
  | UnboundTestDeclaration
  | UncertainCoversAssociation;

export interface BuildReviewTestBindings {
  readonly bindings: readonly BuildReviewTestBinding[];
}

/** A base/HEAD association delta retains removed marker evidence without making it HEAD authority. */
export interface CoversMarkerAssociationChange {
  readonly kind: 'added' | 'removed';
  readonly binding: Exclude<BuildReviewTestBinding, UnboundTestDeclaration>;
}

export interface BuildReviewCoversBindingComparisonInput {
  readonly base: BuildReviewTestBindingsInput;
  readonly head: BuildReviewTestBindingsInput;
}

export interface BuildReviewCoversBindingComparison {
  readonly base: BuildReviewTestBindings;
  readonly head: BuildReviewTestBindings;
  readonly changes: readonly CoversMarkerAssociationChange[];
}

interface AssociatedMarker {
  readonly marker: CoversMarker;
  readonly owner: CoversMarkerOwner;
}

const TRIVIA = new Set([
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.ShebangTrivia,
  ts.SyntaxKind.ConflictMarkerTrivia,
]);

function span(start: number, end: number): TestDeclarationSpan {
  return Object.freeze({ start, end });
}

function coversMarkers(text: string, offset: number): readonly CoversMarker[] {
  const markers: CoversMarker[] = [];
  const lines = /\bCovers\s*:\s*[^\r\n]*/g;
  for (const match of text.matchAll(lines)) {
    const markerText = match[0];
    const markerSpan = span(offset + (match.index ?? 0), offset + (match.index ?? 0) + markerText.length);
    for (const reference of parseCoversMarkers(markerText)) {
      markers.push(Object.freeze({ span: markerSpan, reference }));
    }
  }
  return Object.freeze(markers);
}

function comments(text: string): readonly { readonly start: number; readonly end: number; readonly text: string }[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const found: { start: number; end: number; text: string }[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      found.push(Object.freeze({ start: scanner.getTokenPos(), end: scanner.getTextPos(), text: scanner.getTokenText() }));
    }
  }
  return Object.freeze(found);
}

function nextNonTriviaStart(text: string, position: number): number | undefined {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  scanner.setTextPos(position);
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) return undefined;
    if (!TRIVIA.has(kind)) return scanner.getTokenPos();
  }
}

function titleMarkers(text: string, declaration: SupportedTestDeclaration): readonly CoversMarker[] {
  if (declaration.kind !== 'suite') return [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  scanner.setTextPos(declaration.argumentsSpan.start);
  const kind = scanner.scan();
  if (kind !== ts.SyntaxKind.StringLiteral && kind !== ts.SyntaxKind.NoSubstitutionTemplateLiteral) return [];
  const raw = scanner.getTokenText();
  const quote = raw[0];
  if ((quote !== "'" && quote !== '"' && quote !== '`') || raw.length < 2) return [];
  return coversMarkers(raw.slice(1, -1), scanner.getTokenPos() + 1);
}

function isDescendant(test: SupportedTestDeclaration, suite: SupportedTestDeclaration): boolean {
  return test.titleChain.length > suite.titleChain.length
    && suite.titleChain.every((title, index) => test.titleChain[index] === title);
}

function markerResult(
  target: SupportedTestDeclaration,
  marker: AssociatedMarker,
  criteria: ReadonlySet<string>,
  taskIds: ReadonlySet<string>,
): BoundCoversMarker | UnresolvedCoversMarker {
  const { reference } = marker.marker;
  const resolved = reference.kind === 'criterion'
    ? criteria.has(reference.id.toUpperCase())
    : reference.kind === 'task'
      ? resolvePlanTaskReference(reference.id, taskIds).kind === 'resolved'
      : false;
  return Object.freeze(resolved
    ? { kind: 'bound' as const, target, marker: marker.marker, owner: marker.owner }
    : { kind: 'unresolved-reference' as const, target, marker: marker.marker, owner: marker.owner });
}

/**
 * Associates Covers comments with their immediately following declaration and
 * propagates suite-owned markers only to descendant tests. This never executes
 * source or treats a file-level marker as a binding.
 */
export function bindCoversMarkers(input: BuildReviewTestBindingsInput): BuildReviewTestBindings {
  const text = new TextDecoder('utf-8').decode(input.source.bytes);
  const analysis = analyzeTestDeclarations(input.source);
  const declarations = analysis.declarations;
  const byStart = new Map(declarations.map((declaration) => [declaration.span.start, declaration]));
  const attached = new Map<SupportedTestDeclaration, AssociatedMarker[]>();
  const uncertain: UncertainCoversAssociation[] = [];

  const attach = (declaration: SupportedTestDeclaration, marker: CoversMarker, association: CoversMarkerOwner['association']): void => {
    const owner = Object.freeze({
      kind: declaration.kind,
      association,
      declaration,
    });
    const markers = attached.get(declaration) ?? [];
    markers.push(Object.freeze({ marker, owner }));
    attached.set(declaration, markers);
  };

  for (const comment of comments(text)) {
    const markers = coversMarkers(comment.text, comment.start);
    if (markers.length === 0) continue;
    const declaration = byStart.get(nextNonTriviaStart(text, comment.end) ?? -1);
    if (!declaration) {
      for (const marker of markers) uncertain.push(Object.freeze({ kind: 'uncertain-association', marker }));
      continue;
    }
    for (const marker of markers) attach(declaration, marker, 'leading-comment');
  }
  for (const declaration of declarations) {
    for (const marker of titleMarkers(text, declaration)) attach(declaration, marker, 'title');
  }

  const criteria = new Set(extractStoryCriterionIds(input.storiesText).map((id) => id.toUpperCase()));
  const taskIds = new Set(parsePlanTaskBodies(input.planText).keys());
  const bindings: BuildReviewTestBinding[] = [...uncertain];
  for (const test of declarations.filter((entry) => entry.kind === 'test' || entry.kind === 'group')) {
    const applicable = [
      ...(attached.get(test) ?? []),
      ...declarations
        .filter((suite) => suite.kind === 'suite' && isDescendant(test, suite))
        .flatMap((suite) => attached.get(suite) ?? []),
    ];
    if (applicable.length === 0) {
      bindings.push(Object.freeze({ kind: 'unbound', target: test }));
    } else {
      for (const marker of applicable) bindings.push(markerResult(test, marker, criteria, taskIds));
    }
  }
  return Object.freeze({ bindings: Object.freeze(bindings) });
}

function declarationKey(declaration: SupportedTestDeclaration): string {
  return JSON.stringify([declaration.kind, declaration.titleChain, declaration.occurrence]);
}

function associationKey(binding: Exclude<BuildReviewTestBinding, UnboundTestDeclaration>): string {
  if (binding.kind === 'uncertain-association') {
    return JSON.stringify(['uncertain', binding.marker.reference]);
  }
  return JSON.stringify([
    binding.kind,
    declarationKey(binding.target),
    binding.owner.kind,
    binding.owner.association,
    declarationKey(binding.owner.declaration),
    binding.marker.reference,
  ]);
}

/**
 * Compares only association semantics, not source offsets.  A deleted marker
 * is retained as base-side evidence and is deliberately never reintroduced
 * into the HEAD binding set.
 */
export function compareCoversMarkerBindings(input: BuildReviewCoversBindingComparisonInput): BuildReviewCoversBindingComparison {
  const base = bindCoversMarkers(input.base);
  const head = bindCoversMarkers(input.head);
  const baseAssociations = base.bindings.filter((binding): binding is Exclude<BuildReviewTestBinding, UnboundTestDeclaration> => binding.kind !== 'unbound');
  const headAssociations = head.bindings.filter((binding): binding is Exclude<BuildReviewTestBinding, UnboundTestDeclaration> => binding.kind !== 'unbound');
  const remaining = (bindings: readonly Exclude<BuildReviewTestBinding, UnboundTestDeclaration>[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const binding of bindings) {
      const key = associationKey(binding);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const consume = (counts: Map<string, number>, key: string): boolean => {
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1);
    return true;
  };
  const remainingHead = remaining(headAssociations);
  const remainingBase = remaining(baseAssociations);
  const changes: CoversMarkerAssociationChange[] = [
    ...baseAssociations
      .filter((binding) => !consume(remainingHead, associationKey(binding)))
      .map((binding) => Object.freeze({ kind: 'removed' as const, binding })),
    ...headAssociations
      .filter((binding) => !consume(remainingBase, associationKey(binding)))
      .map((binding) => Object.freeze({ kind: 'added' as const, binding })),
  ];
  return Object.freeze({ base, head, changes: Object.freeze(changes) });
}
