// engineer/outcome-staging.ts — stage the intake issue's Desired-outcome bullets
// into the worktree's gitignored .pipeline/ at worktree creation, BEFORE any
// DECIDE artifact is authored (Story 1 happy path).
//
// Conflict resolution 2026-07-22: early persistence is a gitignored staging file,
// NOT a committed `.docs/intake/<slug>.md` — the committed marker stays
// land-written and plan-stem-keyed (2026-07-03-intake-marker-plan-stem-keying,
// multi-operator-ownership-slice-b). This module only ever writes inside
// `.pipeline/`, never `.docs/`.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Relative path (from the worktree root) of the staged outcomes file. */
export const INTAKE_OUTCOMES_RELATIVE_PATH = join('.pipeline', 'intake-outcomes.md');

/**
 * Extract the verbatim `## Desired outcome` section — heading line through the
 * bullets that follow it, up to (but not including) the next `## ` heading or
 * end of body. Returns null when no such section is present.
 */
export function extractDesiredOutcomeSection(intakeBody: string): string | null {
  const headingIdx = intakeBody.search(/^## Desired outcome\s*$/m);
  if (headingIdx === -1) return null;

  const afterHeading = intakeBody.slice(headingIdx).replace(/^## Desired outcome\s*\n?/, '');
  const nextHeadingMatch = afterHeading.match(/\n## /);
  const sectionBody = nextHeadingMatch
    ? afterHeading.slice(0, nextHeadingMatch.index)
    : afterHeading;

  const heading = '## Desired outcome';
  const bulletLines = sectionBody
    .split('\n')
    .filter((line) => /^\s*-\s/.test(line))
    .map((line) => line.trim());

  if (bulletLines.length === 0) return `${heading}\n`;
  return `${heading}\n\n${bulletLines.join('\n')}`;
}

/**
 * Write `.pipeline/intake-outcomes.md` in the given worktree, carrying the
 * `Source-Ref:` line and the verbatim `## Desired outcome` bullet block.
 *
 * No-op (returns null) when there is no sourceRef or no intakeBody — a
 * chat/CLI-originated idea stages nothing, and no error is raised (Story 1
 * negative path: downstream checks treat the outcome layer as not-required).
 */
export async function stageIntakeOutcomes(
  worktreePath: string,
  sourceRef: string | undefined | null,
  intakeBody: string | undefined | null,
): Promise<string | null> {
  const ref = sourceRef == null ? '' : sourceRef.trim();
  const body = intakeBody == null ? '' : intakeBody;
  if (ref === '' || body === '') return null;

  const pipelineDir = join(worktreePath, '.pipeline');
  const stagedPath = join(pipelineDir, 'intake-outcomes.md');

  const outcomeSection = extractDesiredOutcomeSection(body) ?? '## Desired outcome\n';

  const contents = `Source-Ref: ${ref}\n\n${outcomeSection}\n`;

  await mkdir(pipelineDir, { recursive: true });
  await writeFile(stagedPath, contents, 'utf8');
  return stagedPath;
}
