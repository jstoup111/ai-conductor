import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GhRunner } from './tracker-client.js';

const DELIVERY_FILE = '.pipeline/documentation-delivery.json';
const SOURCE_REF = /^[^/\s]+\/[^/#\s]+#[1-9]\d*$/;
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;

export interface DocumentationDelivery {
  version: 1;
  branch: string;
  prUrl: string;
  sourceRef: string;
}

export interface ReadDocumentationDeliveryOptions {
  projectRoot: string;
  gh: GhRunner;
  /** Reject a marker written before this conductor invocation began. */
  notBeforeMs?: number;
}

function isDelivery(value: unknown): value is DocumentationDelivery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.branch === 'string' &&
    candidate.branch.trim() !== '' &&
    typeof candidate.prUrl === 'string' &&
    PR_URL.test(candidate.prUrl) &&
    typeof candidate.sourceRef === 'string' &&
    SOURCE_REF.test(candidate.sourceRef)
  );
}

function closesSourceRef(body: string, sourceRef: string): boolean {
  const escaped = sourceRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)Closes\\s+${escaped}(?![A-Za-z0-9_/-])`, 'i').test(body);
}

/**
 * Read the terminal result written by a documentation-only explore run and verify
 * that its pull request can close the reported source issue.
 */
export async function readDocumentationDelivery(
  options: ReadDocumentationDeliveryOptions,
): Promise<DocumentationDelivery> {
  const path = join(options.projectRoot, DELIVERY_FILE);
  const metadata = await stat(path);
  // Some filesystems round mtimes to whole seconds. Allow that precision loss
  // so a marker written during explore is not misclassified as stale.
  if (options.notBeforeMs !== undefined && metadata.mtimeMs + 1_000 < options.notBeforeMs) {
    throw new Error(`Documentation delivery result is stale: ${DELIVERY_FILE}`);
  }
  const raw = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Documentation delivery result is not valid JSON: ${DELIVERY_FILE}`);
  }

  if (!isDelivery(value)) {
    throw new Error(`Documentation delivery result is invalid: ${DELIVERY_FILE}`);
  }

  const { stdout } = await options.gh(
    ['pr', 'view', value.prUrl, '--json', 'headRefName,body'],
    { cwd: options.projectRoot },
  );
  let pr: unknown;
  try {
    pr = JSON.parse(stdout);
  } catch {
    throw new Error(`Documentation delivery PR response is not valid JSON: ${value.prUrl}`);
  }
  if (typeof pr !== 'object' || pr === null) {
    throw new Error(`Documentation delivery PR response is invalid: ${value.prUrl}`);
  }

  const { headRefName, body } = pr as Record<string, unknown>;
  if (headRefName !== value.branch) {
    throw new Error(`Documentation delivery branch does not match PR: ${value.prUrl}`);
  }
  if (typeof body !== 'string' || !closesSourceRef(body, value.sourceRef)) {
    throw new Error(`Documentation delivery PR does not close ${value.sourceRef}: ${value.prUrl}`);
  }

  return value;
}

/**
 * Return no result when explore did not take the documentation-only route.
 * Any present but invalid result remains an error so callers fail closed.
 */
export async function findDocumentationDelivery(
  options: ReadDocumentationDeliveryOptions,
): Promise<DocumentationDelivery | null> {
  try {
    return await readDocumentationDelivery(options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
