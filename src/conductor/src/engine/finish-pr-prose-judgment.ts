import type { PrProseJudgmentResult } from './finish-publication.js';

export interface FinishPrProseJudgmentResponse {
  success: boolean;
  output?: string;
  publicationDisposition?: unknown;
}

function isPrProseJudgmentResult(value: unknown): value is PrProseJudgmentResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  const result = value as { kind?: unknown; reason?: unknown };
  return result.kind === 'accepted' ||
    result.kind === 'timed_out' ||
    result.kind === 'provider_unavailable' ||
    result.kind === 'refused' ||
    (result.kind === 'revision_required' &&
      (result.reason === 'placeholder' || result.reason === 'halt' || result.reason === 'structurally_incomplete'));
}

/**
 * FINISH's sole provider response is a bounded PR-prose verdict. Keep the
 * parser narrow: non-JSON prose remains unstructured and fails closed.
 */
export function parseFinishPrProseJudgment(output: string | undefined): unknown {
  if (!output) return undefined;
  const json = output.match(/\{\s*"kind"[\s\S]*?\}/)?.[0];
  if (!json) return undefined;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/** Decode the bounded provider contract; successful unstructured replies fail closed. */
export function decodePrProseJudgment(
  result: FinishPrProseJudgmentResponse,
): PrProseJudgmentResult {
  if (!result.success) return { kind: 'provider_unavailable' };
  const structured = result.publicationDisposition === undefined
    ? parseFinishPrProseJudgment(result.output)
    : result.publicationDisposition;
  if (isPrProseJudgmentResult(structured)) return structured;
  return { kind: 'revision_required', reason: 'structurally_incomplete' };
}
