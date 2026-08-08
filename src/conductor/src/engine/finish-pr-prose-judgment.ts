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
    result.kind === 'malformed_response' ||
    (result.kind === 'revision_required' &&
      (result.reason === 'placeholder' || result.reason === 'halt' || result.reason === 'structurally_incomplete'));
}

function normalizeDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const detail = value.trim();
  return detail.length > 0 ? detail : undefined;
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

/**
 * Decode the bounded provider contract; successful unstructured replies fail
 * closed.
 *
 * An unparsable reply resolves to `malformed_response` — its own kind. It used
 * to be reported as `revision_required: structurally_incomplete`, which
 * collapsed "the provider judged the prose incomplete" and "the provider said
 * something we could not read" into one reason and halted a feature for a
 * human on either. They are now routed separately by the coordinator.
 */
export function decodePrProseJudgment(
  result: FinishPrProseJudgmentResponse,
): PrProseJudgmentResult {
  if (!result.success) return { kind: 'provider_unavailable' };
  const structured = result.publicationDisposition === undefined
    ? parseFinishPrProseJudgment(result.output)
    : result.publicationDisposition;
  if (!isPrProseJudgmentResult(structured)) return { kind: 'malformed_response' };

  const detail = normalizeDetail((structured as { detail?: unknown }).detail);
  if (structured.kind === 'refused') {
    return detail === undefined ? { kind: 'refused' } : { kind: 'refused', detail };
  }
  if (structured.kind === 'revision_required') {
    return detail === undefined
      ? { kind: 'revision_required', reason: structured.reason }
      : { kind: 'revision_required', reason: structured.reason, detail };
  }
  return structured;
}
