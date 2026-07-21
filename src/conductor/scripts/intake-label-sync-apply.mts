#!/usr/bin/env -S npx tsx
// Applies priority:/size:/blocked_by: labels to an intake issue at open/edit time,
// per .github/workflows/intake-label-sync.yml.
//
// Parsing/diff logic lives in src/engine/intake-label-sync.ts (unit-tested in
// test/intake-label-sync.test.ts) so the Action's own logic is testable without
// hitting the GitHub API. This script is the thin, side-effecting shell around it:
// read the event payload -> parse -> diff against current labels -> PATCH the issue.
//
// Failure isolation: this script must NEVER fail the workflow/build. Any error
// (auth, rate limit, malformed payload, network) is caught and logged; the process
// always exits 0. This is intake-only labeling — losing a label sync is recoverable
// (re-edit the issue), but failing CI over it is not acceptable (labels-only, isolated
// from ci.yml per the task spec).
import { readFileSync } from 'node:fs';
import { parseIntakeFormBody, computeLabelsToApply } from '../src/engine/intake-label-sync.js';

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

  const [owner, repo] = repoSlug.split('/');
  const body: string = issue.body ?? '';
  const currentLabels: string[] = (issue.labels ?? []).map((l: any) =>
    typeof l === 'string' ? l : l.name,
  );

  const parsed = parseIntakeFormBody(body);
  const nextLabels = computeLabelsToApply(parsed, currentLabels);

  // Idempotent no-op: skip the API call entirely if nothing changed.
  const same =
    nextLabels.length === currentLabels.length &&
    [...nextLabels].sort().every((l, i) => l === [...currentLabels].sort()[i]);
  if (same) {
    console.log('[intake-label-sync] labels already in sync; no-op');
    return;
  }

  // The "set labels" endpoint does not auto-create unknown labels — it 404s.
  // Explicitly ensure each label exists first (idempotent: creating an
  // already-existing label 422s, which we swallow).
  for (const name of nextLabels) {
    try {
      const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, color: 'ededed' }),
      });
      if (!createRes.ok && createRes.status !== 422) {
        const text = await createRes.text().catch(() => '');
        console.error(`[intake-label-sync] label create warning for "${name}": ${createRes.status} ${text}`);
      }
    } catch (error) {
      console.error(`[intake-label-sync] label create error for "${name}" (non-fatal):`, error);
    }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}/labels`;
  const res = await fetch(url, {
    method: 'PUT', // full replace — labels-only scope, auto-creates missing labels
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels: nextLabels }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[intake-label-sync] label PUT failed: ${res.status} ${text}`);
    return;
  }

  console.log(`[intake-label-sync] applied labels: ${nextLabels.join(', ')}`);
}

main().catch((error) => {
  // Never throw out of the entrypoint — a label-apply failure must not fail the workflow.
  console.error('[intake-label-sync] unexpected error (non-fatal):', error);
});
