import type { FileIntakeIssueResult } from './file-issue.js';
import { describeRedactions } from './sanitize.js';

function lines(values: string[]): string {
  return values.length === 0 ? '' : `${values.join('\n')}\n`;
}

/** Renders the intake CLI's existing messages plus the overlap decision. */
export function renderIntakeFileOutput(result: FileIntakeIssueResult): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  if (result.issueUrl) stdout.push(`[intake-file] filed: ${result.issueUrl}`);
  else stderr.push('[intake-file] filing did not return a canonical issue URL');
  stdout.push(`[intake-file] size=${result.size} (${result.sizeSource})`);
  stdout.push(`[intake-file] priority=${result.priority} (${result.prioritySource})`);
  if (result.dependsOnDecision === 'linked') {
    stdout.push(`[intake-file] depends-on: ${result.linked.join(', ') || '(none linked)'}`);
  } else {
    stdout.push('[intake-file] dependencies: none');
  }

  if (result.overlap) {
    if (result.overlap.kind === 'proceed') {
      if (result.overlap.accepted.length === 0 && result.overlap.declined.length === 0
        && result.overlap.advisory.length === 0 && result.overlap.skipNotes.length === 0
        && result.overlap.omittedCount === 0) {
        stdout.push('[intake-file] overlap check: no overlap');
      }
      for (const ref of result.overlap.accepted) {
        if (result.linked.includes(ref)) stdout.push(`[intake-file] overlap: linked ${ref}`);
        else if (result.unlinked.some((dependency) => dependency.ref === ref)) {
          stdout.push(`[intake-file] overlap: accepted ${ref} (not linked — see NOT LINKED below)`);
        }
      }
      for (const ref of result.overlap.declined) stdout.push(`[intake-file] overlap: declined ${ref}`);
    } else if (result.overlap.kind === 'refused') {
      for (const suggestion of result.overlap.undecided) {
        stdout.push(
          `[intake-file] overlap: undecided ${suggestion.issue} (${suggestion.sharedPaths.join(', ')}) ` +
            `— re-run with --depends-on ${suggestion.issue} or --decline-overlap ${suggestion.issue}`,
        );
      }
    } else {
      for (const value of result.overlap.invalid) {
        stdout.push(`[intake-file] overlap: invalid decline ${value} — not a current suggestion`);
      }
    }
    for (const advisory of result.overlap.advisory) {
      stdout.push(`[intake-file] overlap: advisory ${advisory.branch} (${advisory.sharedPaths.join(', ')})`);
    }
    for (const note of result.overlap.skipNotes) {
      stdout.push(`[intake-file] overlap: skipped ${note.part} — ${note.reason}`);
    }
    if (result.overlap.omittedCount > 0) {
      stdout.push(`[intake-file] overlap: ${result.overlap.omittedCount} more suggestion(s) omitted`);
    }
  }

  if (result.redactions.length > 0) {
    stderr.push(
      `[intake-file] redacted before filing: ${describeRedactions(result.redactions)} ` +
        '— review the filed issue and restore any evidence the scrub clipped',
    );
  }
  for (const warning of result.warnings) stderr.push(`[intake-file] warning: ${warning}`);
  for (const badRef of result.badRefs) stderr.push(`[intake-file] warning: bad --depends-on ref "${badRef}"`);
  for (const dependency of result.unlinked) {
    stderr.push(`[intake-file] NOT LINKED: ${result.issueUrl} is not blocked by ${dependency.ref} (${dependency.reason})`);
  }

  return {
    stdout: lines(stdout),
    stderr: lines(stderr),
    exitCode: result.overlap?.kind === 'refused' || result.overlap?.kind === 'invalid-decline' ? 1 : 0,
  };
}
