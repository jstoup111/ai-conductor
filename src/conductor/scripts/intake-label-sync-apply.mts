#!/usr/bin/env -S npx tsx
// Applies priority:/size:/blocked_by: labels (and dependency links) to an
// intake issue at open/edit time, per .github/workflows/intake-label-sync.yml.
//
// Delegates to the shared, acceptance-tested seam `syncIssueLabels`
// (src/engine/engineer/intake/label-sync.ts) — the same module used by
// bin/intake-file and bin/intake-backfill — so this script is a thin,
// side-effecting shell: read the event payload -> extract issue-form fields
// -> hand off to syncIssueLabels, which owns label auto-create/apply and
// blocked_by dependency linking via the real `gh` CLI.
//
// Failure isolation: this script must NEVER fail the workflow/build. Any error
// (auth, rate limit, malformed payload, network) is caught and logged; the process
// always exits 0. This is intake-only labeling — losing a label sync is recoverable
// (re-edit the issue), but failing CI over it is not acceptable (labels-only, isolated
// from ci.yml per the task spec).
import { readFileSync } from 'node:fs';
import { makeProductionGh } from '../src/engine/pr-labels.js';
import { syncIssueLabels } from '../src/engine/engineer/intake/label-sync.js';

/**
 * Extract the raw value submitted under a given issue-form field heading.
 *
 * Issue-form bodies render each field as:
 *   ### <Label>
 *
 *   <value>
 *
 * Returns the text of the first non-empty line following the heading, or
 * undefined if the heading isn't present or has no content (e.g.
 * "_No response_").
 */
function extractField(body: string, heading: string): string | undefined {
  const headingRegex = new RegExp(`^###\\s+${heading}\\s*$`, 'im');
  const match = headingRegex.exec(body);
  if (!match) return undefined;

  const rest = body.slice(match.index + match[0].length);
  const nextHeadingIdx = rest.search(/^###\s+/m);
  const section = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

  const lines = section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return undefined;
  const value = lines[0];
  if (value === '_No response_') return undefined;
  return value;
}

/**
 * Parse the "Depends on" field into fully-qualified `owner/repo#N` refs
 * (syncIssueLabels expects cross-repo-capable slug refs, not bare numbers).
 * Accepts "none", empty, or unparsable content as "no dependencies".
 */
function parseDependsOnField(body: string, repoSlug: string): string[] {
  const raw = extractField(body, 'Depends on');
  if (!raw) return [];
  const matches = raw.matchAll(/#(\d+)/g);
  const numbers = [...new Set([...matches].map((m) => m[1]))];
  return numbers.map((n) => `${repoSlug}#${n}`);
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.GITHUB_REPOSITORY; // "owner/repo"

  if (!eventPath || !token || !repoSlug) {
    console.error('[intake-label-sync] missing GITHUB_EVENT_PATH/GITHUB_TOKEN/GITHUB_REPOSITORY; skipping');
    return;
  }

  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const issue = event.issue;
  if (!issue) {
    console.error('[intake-label-sync] event payload has no issue; skipping');
    return;
  }

  const body: string = issue.body ?? '';
  const priority = extractField(body, 'Priority');
  const size = extractField(body, 'Size');
  const dependsOn = parseDependsOnField(body, repoSlug);

  const issueRef = `${repoSlug}#${issue.number}`;

  const result = await syncIssueLabels(
    { priority, size, dependsOn },
    issueRef,
    { gh: makeProductionGh(), cwd: process.cwd(), log: (msg) => console.error(msg) },
  );

  console.log(
    `[intake-label-sync] applied ${result.priorityLabel}, ${result.sizeLabel}` +
      (result.linked.length > 0 ? `; linked: ${result.linked.join(', ')}` : '') +
      (result.badRefs.length > 0 ? `; bad refs: ${result.badRefs.join(', ')}` : ''),
  );
}

main().catch((error) => {
  // Never throw out of the entrypoint — a label-apply failure must not fail the workflow.
  console.error('[intake-label-sync] unexpected error (non-fatal):', error);
});
