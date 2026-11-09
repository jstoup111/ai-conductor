import { summarizeRun, type RunRecord } from './run-record.js';

/** Delimiters make the presentation disposable: the record remains authoritative. */
export const RUN_BLOCK_START = '<!-- ai-conductor:composer-run:start -->';
export const RUN_BLOCK_END = '<!-- ai-conductor:composer-run:end -->';

/** Render an operator-facing summary.  No counterpart parses this text. */
export function renderRunBlock(record: RunRecord): string {
  const summary = summarizeRun(record);
  const active = summary.nextStep === 'delivery'
    ? undefined
    : summary.acceptedSteps.find((step) => step.step === summary.nextStep);
  return [
    RUN_BLOCK_START,
    '## Composer run',
    `Current step: ${summary.nextStep}`,
    `Active provider: ${active?.provider ?? summary.lastAcceptedStep?.provider ?? 'unrecorded'}`,
    `Last actor: ${summary.lastActor ? `${summary.lastActor} at ${summary.lastAt}` : 'none'}`,
    'Accepted steps:',
    ...(summary.acceptedSteps.length === 0 ? ['- none'] : summary.acceptedSteps.map((step) => `- ${step.step}: accepted by ${step.actor} via ${step.provider} at ${step.at}`)),
    'Open questions:',
    ...(summary.openQuestions.length === 0 ? ['- none'] : summary.openQuestions.map((question) => `- ${question}`)),
    `Next step: ${summary.nextStep}`,
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
