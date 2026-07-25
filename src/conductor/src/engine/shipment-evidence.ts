import { isAbsolute } from 'node:path';
import { execa } from 'execa';
import { parseShippedRecord, specHash } from './shipped-record.js';

export type ShipmentEvidenceResult =
  | {
      kind: 'valid';
      slug: string;
      pr: string;
      recordPath: string;
      hash: string;
      commit: string;
    }
  | { kind: 'not-applicable'; reason: string }
  | ShipmentEvidenceRefusal;

export type ShipmentEvidenceRefusal = {
  kind: 'refusal';
  code:
    | 'shipment-evidence-inputs-incomplete'
    | 'shipped-record-missing'
    | 'shipped-record-malformed'
    | 'shipped-record-incomplete'
    | 'shipped-record-slug-mismatch'
    | 'shipped-record-pr-mismatch'
    | 'shipped-record-hash-mismatch'
    | 'shipment-plan-missing';
  expected: string;
  observed: string | null;
};

export interface ShipmentEvidenceInput {
  repoDir: string;
  slug: string;
  implementationPr: string;
  candidateCommit: string;
  implementationHead: string;
}

/**
 * Validate the durable shipment record and the spec bytes it attests to from
 * one committed tree. Working-tree files are deliberately never considered.
 */
export async function evaluateShipmentEvidence(
  input: ShipmentEvidenceInput,
): Promise<ShipmentEvidenceResult> {
  const { repoDir, slug, implementationPr, candidateCommit, implementationHead } = input;
  if (!repoDir || !slug || !implementationPr || !candidateCommit || !implementationHead) {
    return refusal(
      'shipment-evidence-inputs-incomplete',
      'complete shipment evidence inputs',
      null,
    );
  }

  const recordPath = `.docs/shipped/${slug}.md`;
  const recordContent = await showAtCommit(repoDir, candidateCommit, recordPath);
  if (recordContent === null) {
    return refusal(
      'shipped-record-missing',
      recordPath,
      null,
    );
  }

  const recordText = recordContent.toString('utf8');
  const rawFields = readFrontmatterFields(recordText);
  if (rawFields === null) {
    return refusal(
      'shipped-record-malformed',
      'parseable shipped record',
      'malformed',
    );
  }
  for (const field of ['slug', 'spec_hash', 'pr', 'shipped'] as const) {
    if (!rawFields[field]) {
      return refusal(
        'shipped-record-incomplete',
        field,
        null,
      );
    }
  }

  const record = parseShippedRecord(recordText);
  if ('malformed' in record) {
    return refusal(
      'shipped-record-malformed',
      'parseable shipped record',
      'malformed',
    );
  }
  if (record.slug !== slug) {
    return refusal(
      'shipped-record-slug-mismatch',
      slug,
      record.slug,
    );
  }
  if (record.pr !== implementationPr) {
    return refusal(
      'shipped-record-pr-mismatch',
      implementationPr,
      record.pr,
    );
  }

  const planPath = `.docs/plans/${slug}.md`;
  const planBytes = await showAtCommit(repoDir, candidateCommit, planPath);
  if (planBytes === null) {
    return refusal(
      'shipment-plan-missing',
      planPath,
      null,
    );
  }

  const storiesBytes = await readStoriesBytes(repoDir, candidateCommit, slug, planBytes);
  const hash = specHash(planBytes, storiesBytes).digest;
  if (record.specHash !== hash) {
    return refusal(
      'shipped-record-hash-mismatch',
      hash,
      record.specHash,
    );
  }

  return {
    kind: 'valid',
    slug,
    pr: record.pr,
    recordPath,
    hash,
    commit: candidateCommit,
  };
}

function refusal(
  code: ShipmentEvidenceRefusal['code'],
  expected: string,
  observed: string | null,
): ShipmentEvidenceRefusal {
  return { kind: 'refusal', code, expected, observed };
}

function readFrontmatterFields(content: string): Record<string, string> | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const fields: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '---') return fields;
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  return null;
}

async function readStoriesBytes(
  repoDir: string,
  commit: string,
  slug: string,
  planBytes: Buffer,
): Promise<Buffer | null> {
  const planContent = planBytes.toString('utf8');
  const reference = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im)?.[1];
  if (reference && !isAbsolute(reference)) {
    const stories = await showAtCommit(repoDir, commit, reference);
    if (stories !== null) return stories;
  }
  return showAtCommit(repoDir, commit, `.docs/stories/${slug}.md`);
}

async function showAtCommit(
  repoDir: string,
  commit: string,
  path: string,
): Promise<Buffer | null> {
  try {
    const result = await execa('git', ['show', `${commit}:${path}`], {
      cwd: repoDir,
      reject: false,
      stripFinalNewline: false,
    });
    return result.exitCode === 0 ? Buffer.from(result.stdout, 'utf8') : null;
  } catch {
    return null;
  }
}
