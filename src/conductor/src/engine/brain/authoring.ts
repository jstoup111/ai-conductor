// authoring.ts — Prompt builder for the brain's planning/authoring step (Task 14, FR-5).
//
// `buildAuthoringPrompt` embeds the LessonDigest into the prompt text so that
// a downstream reader (LLM or evaluator) can observe prior lessons directly in
// the prompt context without requiring a separate retrieval step.
//
// Design decisions:
//   • Returns a plain `string` for simplicity; callers can wrap in {prompt} if
//     needed — the shape is forward-compatible because the test accepts either.
//   • Digest is rendered section-by-section (kickbacks, halts, retryHotspots,
//     narrativeRefs). Each section lists lesson texts as numbered bullets.
//   • When ALL groups are empty the lessons block says "No prior lessons for
//     this project." explicitly — the absence is observable (FR-5 requirement).
//   • Lesson texts are embedded verbatim; no escaping — special characters
//     must survive intact for downstream consumers.

import type { LessonDigest, RetrievedLesson } from './lesson-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for buildAuthoringPrompt.
 * Reserved for future extension (e.g. custom section titles).
 */
export interface AuthoringPromptOpts {
  /** Override the section header label. Defaults to "Prior Lessons". */
  lessonsSectionTitle?: string;
}

/**
 * The return shape of buildAuthoringPrompt.
 * Returning an object keeps the door open for structured callers (Task 19).
 */
export interface AuthoringPromptResult {
  prompt: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Render a group of lessons as a numbered bullet list.
 * Returns an empty string when the group is empty (callers decide what to show).
 */
function renderLessonGroup(title: string, lessons: RetrievedLesson[]): string {
  if (lessons.length === 0) return '';
  const bullets = lessons
    .map((l, i) => `  ${i + 1}. ${l.text}`)
    .join('\n');
  return `### ${title}\n${bullets}`;
}

/**
 * Determine whether ALL groups in the digest are empty.
 */
function isEmptyDigest(digest: LessonDigest): boolean {
  return (
    digest.kickbacks.length === 0 &&
    digest.halts.length === 0 &&
    digest.retryHotspots.length === 0 &&
    digest.narrativeRefs.length === 0
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the authoring/planning prompt for the brain.
 *
 * The prompt contains:
 *   1. The idea to be planned.
 *   2. The target project name.
 *   3. A "Prior Lessons" section that embeds all lesson texts from the digest.
 *      - When the digest is empty the section explicitly states
 *        "No prior lessons for this project." so the absence is observable.
 *
 * @param idea    The feature idea / planning request.
 * @param project The target project name.
 * @param digest  The LessonDigest assembled by selectLessons (FR-5).
 * @param opts    Optional overrides (e.g. custom section title).
 * @returns       An AuthoringPromptResult whose `.prompt` field is the full prompt string.
 */
export function buildAuthoringPrompt(
  idea: string,
  project: string,
  digest: LessonDigest,
  opts: AuthoringPromptOpts = {},
): AuthoringPromptResult {
  const sectionTitle = opts.lessonsSectionTitle ?? 'Prior Lessons';

  // Build the lessons block
  let lessonsBlock: string;
  if (isEmptyDigest(digest)) {
    lessonsBlock = `## ${sectionTitle}\n\nNo prior lessons for this project.`;
  } else {
    const sections: string[] = [];

    const kickbacksSection = renderLessonGroup('Kickbacks', digest.kickbacks);
    if (kickbacksSection) sections.push(kickbacksSection);

    const haltsSection = renderLessonGroup('Halts', digest.halts);
    if (haltsSection) sections.push(haltsSection);

    const retrySection = renderLessonGroup('Retry Hotspots', digest.retryHotspots);
    if (retrySection) sections.push(retrySection);

    const narrativeSection = renderLessonGroup('Narrative References', digest.narrativeRefs);
    if (narrativeSection) sections.push(narrativeSection);

    lessonsBlock = `## ${sectionTitle}\n\n${sections.join('\n\n')}`;
  }

  const prompt = [
    `# Authoring Prompt`,
    ``,
    `## Idea`,
    ``,
    idea,
    ``,
    `## Target Project`,
    ``,
    project,
    ``,
    lessonsBlock,
  ].join('\n');

  return { prompt };
}
