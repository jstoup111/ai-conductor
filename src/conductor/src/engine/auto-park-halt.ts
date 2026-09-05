import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HALT_MARKER, writeHaltMarker } from './halt-marker.js';

export type DeferredAutoParkHaltState = 'pending' | 'write-failed';

export interface DeferredAutoParkHaltPresentation {
  heading: string;
  resumeProcedure: string;
}

/**
 * The executor writes a provisional HALT before the dispatcher owns the root
 * marker write. Keep both states' operator vocabulary here so collection can
 * correct that provisional note if the root write fails.
 */
export function deferredAutoParkHaltPresentation(
  slug: string,
  state: DeferredAutoParkHaltState,
): DeferredAutoParkHaltPresentation {
  if (state === 'write-failed') {
    return {
      heading: 'feature errored — automatic park failed',
      resumeProcedure:
        `  1. Fix the cause of the error above (project setup / config / environment / a crashed step).\n` +
        `  2. rm .pipeline/HALT\n` +
        `  3. ai-conductor daemon park ${slug}\n` +
        `  4. Re-queue the feature (restart the daemon if it was excluded this run).\n`,
    };
  }

  return {
    heading: 'feature parked — will not re-dispatch on the next scan',
    resumeProcedure:
      `  1. Fix the cause of the error above (project setup / config / environment / a crashed step).\n` +
      `  2. rm .pipeline/HALT\n` +
      `  3. ai-conductor daemon unpark ${slug}\n` +
      `  4. Re-queue the feature (restart the daemon if it was excluded this run).\n`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Replace the provisional deferred-auto-park presentation after its root write fails. */
export function amendDeferredAutoParkHaltForWriteFailure(
  note: string,
  slug: string,
  error: unknown,
): string {
  const presentation = deferredAutoParkHaltPresentation(slug, 'write-failed');
  const headingRewritten = note.replace(/^[^\n]*/, presentation.heading);
  const resumeMarker = '\nResume procedure:\n';
  const resumeIndex = headingRewritten.indexOf(resumeMarker);
  const failureDetail = `\nAutomatic park write failed: ${errorMessage(error)}\n`;

  if (resumeIndex === -1) {
    return `${headingRewritten.trimEnd()}${failureDetail}\nResume procedure:\n${presentation.resumeProcedure}`;
  }

  return (
    headingRewritten.slice(0, resumeIndex)
    + failureDetail
    + `\nResume procedure:\n${presentation.resumeProcedure}`
  );
}

/** Amend the feature-worktree HALT once the dispatcher knows its root park write failed. */
export async function amendDeferredAutoParkHaltAtWorktree(
  worktreePath: string,
  slug: string,
  error: unknown,
): Promise<void> {
  const note = await readFile(join(worktreePath, HALT_MARKER), 'utf-8');
  const result = await writeHaltMarker(
    worktreePath,
    amendDeferredAutoParkHaltForWriteFailure(note, slug, error),
    'needs-human',
  );
  if (result.status === 'failed') throw new Error(result.reason);
}
