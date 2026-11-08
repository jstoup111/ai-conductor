import { RUN_STEP_ORDER, type RunRecord, type RunStepId } from './run-record.js';

/** Delimiters make the presentation disposable: the record remains authoritative. */
export const RUN_BLOCK_START = '<!-- ai-conductor:composer-run:start -->';
export const RUN_BLOCK_END = '<!-- ai-conductor:composer-run:end -->';

function nextStep(record: RunRecord): RunStepId | 'delivery' {
  return RUN_STEP_ORDER.find((step) => record.steps[step]?.state !== 'accepted' || record.needsReconfirm.includes(step)) ?? 'delivery';
}

/** Render an operator-facing summary.  No counterpart parses this text. */
export function renderRunBlock(record: RunRecord): string {
  const accepted = RUN_STEP_ORDER.flatMap((step) => {
    const value = record.steps[step];
    return value?.state === 'accepted' ? [`- ${step}: accepted by ${value.actor} via ${value.provider} at ${value.at}`] : [];
  });
  const current = nextStep(record);
  const active = current === 'delivery' ? undefined : record.steps[current];
  const last = [...RUN_STEP_ORDER].reverse().map((step) => record.steps[step]).find((step) => step?.state === 'accepted');
  const questions = RUN_STEP_ORDER.flatMap((step) => (record.notes[step]?.openQuestions ?? []).map((question) => `- ${question}`));
  return [
    RUN_BLOCK_START,
    '## Composer run',
    `Current step: ${current}`,
    `Active provider: ${active?.state === 'accepted' ? active.provider : last?.state === 'accepted' ? last.provider : 'unrecorded'}`,
    `Last actor: ${last?.state === 'accepted' ? `${last.actor} at ${last.at}` : 'none'}`,
    'Accepted steps:',
    ...(accepted.length === 0 ? ['- none'] : accepted),
    'Open questions:',
    ...(questions.length === 0 ? ['- none'] : questions),
    `Next step: ${current}`,
    RUN_BLOCK_END,
  ].join('\n');
}

/** Replace only our marker-delimited fragment, retaining human-authored PR prose byte-for-byte. */
export function upsertRunBlock(body: string, block: string): string {
  const start = body.indexOf(RUN_BLOCK_START);
  if (start < 0) return body.length === 0 ? block : `${body}\n\n${block}`;
  const end = body.indexOf(RUN_BLOCK_END, start);
  if (end < 0) return `${body.slice(0, start)}${block}`;
  return `${body.slice(0, start)}${block}${body.slice(end + RUN_BLOCK_END.length)}`;
}
