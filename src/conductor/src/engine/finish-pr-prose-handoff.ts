import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { extractRegionBytes, listRegionKeys, restoreRegion } from './pr-body-regions.js';

export const PR_PROSE_HANDOFF_PATH = '.pipeline/finish-pr-prose.json';

declare const authoredPrProse: unique symbol;

/** Validated reader-facing prose returned by a FINISH authoring pass. */
export interface AuthoredPrProse {
  readonly title: string;
  readonly body: string;
  readonly [authoredPrProse]: true;
}

export type ReadPrProseHandoffResult =
  | { kind: 'returned'; prose: AuthoredPrProse }
  | { kind: 'not_returned' }
  | { kind: 'invalid'; detail: string };

export type ApplyAuthoredPrProseResult =
  | { readonly kind: 'apply'; readonly title: string; readonly body: string }
  | { readonly kind: 'invalid'; readonly detail: string };

export type ApplyAuthoredPrProseInput = {
  readonly currentBody: string;
  readonly prose: AuthoredPrProse;
  readonly isPlaceholder: (title: string, body: string) => boolean;
};

const CLOSES_REFERENCE = /\bCloses\s+([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*#\d+)\b/g;

function handoffPath(pipelineDir: string): string {
  return join(pipelineDir, 'finish-pr-prose.json');
}

function invalid(detail: string): ReadPrProseHandoffResult {
  return { kind: 'invalid', detail };
}

/**
 * Decode the handoff written by the FINISH prose author. Present malformed
 * handoffs fail closed; only a missing handoff means no prose was returned.
 */
export async function readPrProseHandoff(pipelineDir: string): Promise<ReadPrProseHandoffResult> {
  let raw: string;
  try {
    raw = await readFile(handoffPath(pipelineDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'not_returned' };
    }
    throw error;
  }

  let handoff: unknown;
  try {
    handoff = JSON.parse(raw);
  } catch {
    return invalid('PR-prose handoff could not be parsed.');
  }

  if (typeof handoff !== 'object' || handoff === null || Array.isArray(handoff)) {
    return invalid('PR-prose handoff version must be 1.');
  }

  const candidate = handoff as Record<string, unknown>;
  if (candidate.version !== 1) {
    return invalid('PR-prose handoff version must be 1.');
  }
  if (typeof candidate.title !== 'string') {
    return invalid('PR-prose handoff title must be a string.');
  }
  if (typeof candidate.body !== 'string') {
    return invalid('PR-prose handoff body must be a string.');
  }

  const title = candidate.title.trim();
  if (title === '') {
    return invalid('PR-prose handoff title must not be empty.');
  }
  if (candidate.body.trim() === '') {
    return invalid('PR-prose handoff body must not be empty.');
  }

  return {
    kind: 'returned',
    prose: { title, body: candidate.body } as AuthoredPrProse,
  };
}

/** Remove the previous authoring pass's handoff before dispatching a new pass. */
export async function clearPrProseHandoff(pipelineDir: string): Promise<void> {
  try {
    await unlink(handoffPath(pipelineDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function closesReferences(body: string): readonly string[] {
  return [...body.matchAll(CLOSES_REFERENCE)].map((match) => `Closes ${match[1]}`);
}

/**
 * Applies returned prose while retaining project-owned step regions and closing
 * references already present on the retained PR.
 */
export function applyAuthoredPrProse(input: ApplyAuthoredPrProseInput): ApplyAuthoredPrProseResult {
  let body = input.prose.body;
  for (const key of listRegionKeys(input.currentBody)) {
    const bytes = extractRegionBytes(input.currentBody, key);
    if (bytes !== undefined) body = restoreRegion(body, { key, bytes });
  }

  if (input.isPlaceholder(input.prose.title, body)) {
    return { kind: 'invalid', detail: 'PR-prose handoff body is still placeholder.' };
  }

  const missingReference = closesReferences(input.currentBody)
    .find((reference) => !body.includes(reference));
  if (missingReference !== undefined) {
    return { kind: 'invalid', detail: `PR-prose handoff body must retain ${missingReference}.` };
  }

  return { kind: 'apply', title: input.prose.title, body };
}
