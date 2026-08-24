import type { HaltClass } from './halt-marker.js';

/** Git-tracked records that let an operator inspect a feature halt from its branch. */
export const HALT_RECORD_DIR = '.docs/halted';

export interface HaltRecordInput {
  slug: string;
  haltClass: HaltClass;
  step: string;
  phase: string;
  branch: string;
  headSha: string;
  haltedAt: string;
  haltBody: string;
}

/** Resolve a halt record's repository-relative path. */
export function haltRecordPath(slug: string): string {
  return `${HALT_RECORD_DIR}/${slug}.md`;
}

/** Render the operator-readable, git-tracked record for a raised halt. */
export function renderHaltRecord(input: HaltRecordInput): string {
  const fence = haltBodyFence(input.haltBody);
  const bodySuffix = input.haltBody.endsWith('\n') ? '' : '\n';

  return (
    `# Halt record\n\n` +
    `Status: halted\n` +
    `Slug: ${input.slug}\n` +
    `Class: ${input.haltClass}\n` +
    `Halting step: ${input.step}\n` +
    `Phase: ${input.phase}\n` +
    `Branch: ${input.branch}\n` +
    `Head SHA: ${input.headSha}\n` +
    `Halted at: ${input.haltedAt}\n\n` +
    `## HALT\n\n` +
    `${fence}text\n${input.haltBody}${bodySuffix}${fence}\n`
  );
}

function haltBodyFence(body: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(body.matchAll(/`+/g), (match) => match[0].length),
  );
  return '`'.repeat(Math.max(3, longestRun + 1));
}
