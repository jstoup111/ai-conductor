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
  | { kind: 'refusal'; reason: string };

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
    return { kind: 'refusal', reason: 'shipment evidence inputs are incomplete' };
  }

  const recordPath = `.docs/shipped/${slug}.md`;
  const recordContent = await showAtCommit(repoDir, candidateCommit, recordPath);
  if (recordContent === null) {
    return { kind: 'refusal', reason: `missing committed shipped record: ${recordPath}` };
  }

  const record = parseShippedRecord(recordContent.toString('utf8'));
  if ('malformed' in record || record.slug !== slug || record.pr !== implementationPr) {
    return { kind: 'refusal', reason: 'committed shipped record is invalid' };
  }

  const planPath = `.docs/plans/${slug}.md`;
  const planBytes = await showAtCommit(repoDir, candidateCommit, planPath);
  if (planBytes === null) {
    return { kind: 'refusal', reason: `missing committed plan: ${planPath}` };
  }

  const storiesBytes = await readStoriesBytes(repoDir, candidateCommit, slug, planBytes);
  const hash = specHash(planBytes, storiesBytes).digest;
  if (record.specHash !== hash) {
    return { kind: 'refusal', reason: 'committed shipped record hash does not match the spec' };
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
