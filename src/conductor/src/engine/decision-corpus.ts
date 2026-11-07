import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative } from 'node:path';

import { adrApprovalStatus, stripFencedCodeBlocks } from './artifacts.js';
import { MANIFEST_KIND_LOCATIONS } from './feature-manifest.js';

export type DecisionRecordKind = 'decision' | 'review' | 'assessment' | 'reference' | 'unclassified';

type DecisionRecordShape =
  | { readonly kind: Exclude<DecisionRecordKind, 'unclassified'>; readonly prefix: string }
  | { readonly kind: Exclude<DecisionRecordKind, 'unclassified'>; readonly filename: string };

/**
 * The known decision-corpus filenames, ordered from the most specific
 * convention to the least specific one.
 */
export const DECISION_RECORD_SHAPES: readonly DecisionRecordShape[] = [
  { kind: 'decision', prefix: 'adr-' },
  { kind: 'review', prefix: 'architecture-review-' },
  { kind: 'review', prefix: 'review-' },
  { kind: 'assessment', prefix: 'technical-assessment-' },
  { kind: 'reference', filename: 'api-response-contract.md' },
  { kind: 'reference', filename: 'styleguide.md' },
];

function shapeKind(filename: string): DecisionRecordKind | null {
  for (const shape of DECISION_RECORD_SHAPES) {
    if ('prefix' in shape && filename.startsWith(shape.prefix)) return shape.kind;
    if ('filename' in shape && filename === shape.filename) return shape.kind;
  }
  return null;
}

export function matchesKnownShape(filename: string, content = ''): boolean {
  return classifyKind(filename, content) !== 'unclassified';
}

const VERDICT_DECLARATION_RE =
  /^\s*(?:[-+*]\s+)?(?:\*\*verdict\s*:\s*\*\*\s*(\S.*?)|\*\*verdict\s*:\s*(\S.*?)\*\*|verdict\s*:\s*(\S.*))\s*$/im;

function declaredVerdict(content: string): string | null {
  const verdict = stripFencedCodeBlocks(content).match(VERDICT_DECLARATION_RE);
  if (verdict === null) return null;
  return (verdict[1] ?? verdict[2] ?? verdict[3]).trim();
}

export type DecisionDisposition = 'approved' | 'superseded' | 'other' | 'undeclared';

export interface DecisionCorpusRow {
  readonly path: string;
  readonly kind: DecisionRecordKind;
  readonly disposition: DecisionDisposition;
  readonly declared: string | null;
  readonly date: string;
  readonly title: string;
  readonly summary: string;
}

export interface DecisionCorpusReadError {
  readonly path: string;
  readonly error: string;
}

export interface DecisionCorpus {
  readonly rows: readonly DecisionCorpusRow[];
  readonly errors: readonly DecisionCorpusReadError[];
}

export function deriveDisposition(content: string): {
  disposition: DecisionDisposition;
  declared: string | null;
} {
  const status = adrApprovalStatus(content);
  if (status.found !== null) {
    if (!status.approved) return { disposition: 'other', declared: status.found };
    return {
      disposition: /^superseded\b/i.test(status.found) ? 'superseded' : 'approved',
      declared: status.found,
    };
  }

  const declared = declaredVerdict(content);
  if (declared === null) return { disposition: 'undeclared', declared: null };
  return { disposition: 'other', declared };
}

export function classifyKind(filename: string, content: string): DecisionRecordKind {
  const knownKind = shapeKind(filename);
  if (knownKind !== null) return knownKind;
  if (adrApprovalStatus(content).found !== null) return 'decision';
  if (declaredVerdict(content) !== null) return 'review';
  return 'unclassified';
}

const DATE_LINE_RE = /^\*\*Date:\*\*\s*(.*?)\s*$/im;
const DATE_IN_FILENAME_RE = /\d{4}-\d{2}-\d{2}/;
const TITLE_RE = /^#\s+(.+?)\s*$/m;
const DECISION_SECTION_RE = /^##\s+Decision\s*$/im;
const SECTION_HEADING_RE = /^##\s+/;
const METADATA_LINE_RE = /^\*\*[^*]+:\*\*/;

function truncateSummary(summary: string): string {
  return summary.slice(0, 160);
}

function firstParagraphLine(lines: readonly string[]): string {
  return lines.find((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#') && !METADATA_LINE_RE.test(trimmed);
  })?.trim() ?? '';
}

function deriveSummary(content: string): string {
  const lines = content.split(/\r?\n/);
  const decisionSection = lines.findIndex((line) => DECISION_SECTION_RE.test(line));
  if (decisionSection >= 0) {
    const nextSection = lines.findIndex((line, index) => index > decisionSection && SECTION_HEADING_RE.test(line));
    const summary = firstParagraphLine(
      lines.slice(decisionSection + 1, nextSection >= 0 ? nextSection : lines.length),
    );
    if (summary !== '') return truncateSummary(summary);
  }

  const titleLine = lines.findIndex((line) => TITLE_RE.test(line));
  return truncateSummary(firstParagraphLine(lines.slice(titleLine >= 0 ? titleLine + 1 : 0)));
}

function corpusRow(repoRoot: string, directory: string, filename: string, content: string): DecisionCorpusRow {
  const stem = filename.replace(/\.md$/i, '');
  const date = content.match(DATE_LINE_RE)?.[1]?.trim() || filename.match(DATE_IN_FILENAME_RE)?.[0] || '';
  const title = content.match(TITLE_RE)?.[1]?.trim() || stem;
  const disposition = deriveDisposition(content);
  return {
    path: relative(repoRoot, join(repoRoot, directory, filename)).replaceAll('\\', '/'),
    kind: classifyKind(filename, content),
    ...disposition,
    date,
    title,
    summary: deriveSummary(content),
  };
}

export async function readDecisionCorpus(repoRoot: string): Promise<DecisionCorpus> {
  const directory = MANIFEST_KIND_LOCATIONS.decision.directory;
  const corpusDirectory = join(repoRoot, directory);
  let entries: Dirent<string>[];
  try {
    entries = await readdir(corpusDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], errors: [] };
    throw error;
  }

  const rows: DecisionCorpusRow[] = [];
  const errors: DecisionCorpusReadError[] = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith('.md')).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = relative(repoRoot, join(corpusDirectory, entry.name)).replaceAll('\\', '/');
    try {
      rows.push(corpusRow(repoRoot, directory, entry.name, await readFile(join(corpusDirectory, entry.name), 'utf8')));
    } catch (error) {
      errors.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rows, errors };
}
