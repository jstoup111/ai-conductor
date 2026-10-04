import { parseCoversMarkers } from './covers-marker.js';
import { parsePlanTaskStoryIds } from './plan-task-parse.js';
import { extractStoryCriterionIds } from './story-criteria.js';

export type DoneWhenTestReferenceRefusalPart =
  | 'not-a-test-reference'
  | 'missing-file'
  | 'missing-title'
  | 'missing-covers-marker';

export interface DoneWhenTestReferenceInput {
  readonly evidence: string;
  readonly taskId: string;
  readonly taskText: string;
  readonly storiesText: string;
  /** Committed file contents, keyed by the repository-relative test path. */
  readonly blobs: ReadonlyMap<string, string | Uint8Array>;
}

export interface DoneWhenTestReference {
  readonly path: string;
  readonly title: string;
}

export type DoneWhenTestReferenceVerification =
  | { readonly kind: 'verified'; readonly path: string; readonly title: string }
  | {
    readonly kind: 'refused';
    readonly part: DoneWhenTestReferenceRefusalPart;
    readonly path?: string;
    readonly title?: string;
  };

/** Parses the user-facing `test:<path>::<title>` evidence form. */
export function parseDoneWhenTestReference(evidence: string): DoneWhenTestReference | undefined {
  const match = evidence.trim().match(/^test:([^\r\n]+?)::([\s\S]+)$/);
  if (!match) return undefined;

  const path = match[1].trim();
  const title = match[2].trim();
  return path && title ? { path, title } : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function citedCriterionIds(taskText: string, storiesText: string): Set<string> {
  const storyIds = parsePlanTaskStoryIds(taskText);
  const criteria = extractStoryCriterionIds(storiesText);
  return new Set(criteria.filter((criterion) => storyIds.some((storyId) =>
    criterion.toUpperCase().startsWith(`S${storyId}.`.toUpperCase()),
  )).map((criterion) => criterion.toUpperCase()));
}

/**
 * Verifies only text supplied from a committed blob. Reading HEAD is owned by
 * the task-close boundary, keeping this language- and filesystem-agnostic.
 */
export function verifyDoneWhenTestReference(
  input: DoneWhenTestReferenceInput,
): DoneWhenTestReferenceVerification {
  const reference = parseDoneWhenTestReference(input.evidence);
  if (!reference) return { kind: 'refused', part: 'not-a-test-reference' };

  const blob = input.blobs.get(reference.path);
  if (blob === undefined) {
    return { kind: 'refused', part: 'missing-file', path: reference.path, title: reference.title };
  }

  const text = typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8');
  if (!normalizeWhitespace(text).includes(normalizeWhitespace(reference.title))) {
    return { kind: 'refused', part: 'missing-title', path: reference.path, title: reference.title };
  }

  const criteria = citedCriterionIds(input.taskText, input.storiesText);
  const hasMarker = parseCoversMarkers(text).some((marker) =>
    (marker.kind === 'task' && marker.id === input.taskId)
    || (marker.kind === 'criterion' && criteria.has(marker.id.toUpperCase())),
  );
  if (!hasMarker) {
    return { kind: 'refused', part: 'missing-covers-marker', path: reference.path, title: reference.title };
  }

  return { kind: 'verified', path: reference.path, title: reference.title };
}
