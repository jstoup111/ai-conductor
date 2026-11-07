import { adrApprovalStatus, stripFencedCodeBlocks } from './artifacts.js';

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

export function matchesKnownShape(filename: string): boolean {
  return shapeKind(filename) !== null;
}

const FENCED_CODE_BLOCK_RE =
  /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|\r)[\s\S]*?^ {0,3}\1[^\r\n]*(?:\r?\n|\r|$)/gm;
const VERDICT_LINE_RE =
  /^\s*(?:[-+*]\s+)?(?:(?:\*\*verdict\s*:\s*\*\*|\*\*verdict\*\*\s*:|verdict\s*:))\s*\S.*$/im;
const VERDICT_VALUE_RE =
  /^\s*(?:[-+*]\s+)?(?:(?:\*\*verdict\s*:\s*\*\*|\*\*verdict\*\*\s*:|verdict\s*:)\s*(.*?)|\*\*verdict\s*:\s*(.*?)\*\*)\s*$/im;

export type DecisionDisposition = 'approved' | 'superseded' | 'other' | 'undeclared';

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

  const verdict = stripFencedCodeBlocks(content).match(VERDICT_VALUE_RE);
  if (verdict === null) return { disposition: 'undeclared', declared: null };

  const declared = (verdict[1] ?? verdict[2]).trim();
  return { disposition: 'other', declared };
}

export function classifyKind(filename: string, content: string): DecisionRecordKind {
  const knownKind = shapeKind(filename);
  if (knownKind !== null) return knownKind;
  if (adrApprovalStatus(content).found !== null) return 'decision';
  if (VERDICT_LINE_RE.test(content.replace(FENCED_CODE_BLOCK_RE, ''))) return 'review';
  return 'unclassified';
}
