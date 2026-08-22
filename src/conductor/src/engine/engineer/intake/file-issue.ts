// engineer/intake/file-issue.ts — deterministic-completeness issue filer.
//
// `bin/intake-file` delegates to `fileIntakeIssue` here: create the GitHub
// issue, resolve size/priority (prompt ▸ infer ▸ default), apply the
// `priority:`/`size:` labels, and record a `--depends-on` link (or an
// explicit "no dependencies" acknowledgement) — all as ONE atomic filing
// operation. A label-apply failure after a successful issue create is a
// warning, never a filing failure (exit 0).
//
// Reuses the existing REST idiom (`restAddLabelArgs`, `pr-labels.ts`) and the
// `owner/repo#N` ref parser (`parseSourceRef`, `issue-ref.ts`) rather than
// inventing new ones — see Task 4 of .docs/plans/intake-only-enforcement.md.

import { parseSizeLabel, parsePriorityLabels } from '../../backlog-priority.js';
import { restAddLabelArgs } from '../../pr-labels.js';
import { parseSourceRef } from '../issue-ref.js';
import { sanitizeIntakeText, type Redaction } from './sanitize.js';
import { createOrRecoverIssueBySourceRef, type TrackerClient } from '../../tracker-client.js';

export interface FileIntakeIssueOpts {
  title: string;
  body: string;
  size?: 'S' | 'M' | 'L';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: string[];
  interactive?: boolean;
  repo?: string;
  /** Caller-owned stable filing key, included in the public issue body. */
  sourceRef?: string;
}

export interface FileIntakeIssueDeps {
  tracker: TrackerClient;
  gh: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
  cwd: string;
  prompt?: (question: string) => Promise<string>;
}

export interface FileIntakeIssueResult {
  ok: boolean;
  issueUrl: string;
  size: 'S' | 'M' | 'L';
  priority: 'critical' | 'high' | 'medium' | 'low';
  sizeSource: 'given' | 'prompted' | 'inferred' | 'default';
  prioritySource: 'given' | 'prompted' | 'inferred' | 'default';
  dependsOnDecision: 'none' | 'linked';
  linked: string[];
  badRefs: string[];
  warnings: string[];
  /**
   * What the pre-publication scrub replaced in the title/body. Empty on a clean
   * filing. Reported to the operator so a redaction is never silent — the issue
   * is already public by then, and a clipped piece of evidence has to be
   * noticed to be restored.
   */
  redactions: Redaction[];
}

const SIZE_WORDS: Record<'S' | 'M' | 'L', RegExp> = {
  L: /\b(large|big|major|significant)\b/i,
  M: /\b(medium|moderate)\b/i,
  S: /\b(small|tiny|trivial|minor|quick)\b/i,
};

const PRIORITY_WORDS: Record<'critical' | 'high' | 'medium' | 'low', RegExp> = {
  critical: /\b(critical|urgent|outage|down|blocker|blocking)\b/i,
  high: /\b(high[- ]priority|important|asap)\b/i,
  medium: /\b(medium[- ]priority)\b/i,
  low: /\b(low[- ]priority|minor|whenever|no rush)\b/i,
};

function inferSize(body: string): 'S' | 'M' | 'L' | undefined {
  for (const size of ['L', 'M', 'S'] as const) {
    if (SIZE_WORDS[size].test(body)) return size;
  }
  return undefined;
}

function inferPriority(body: string): 'critical' | 'high' | 'medium' | 'low' | undefined {
  for (const p of ['critical', 'high', 'medium', 'low'] as const) {
    if (PRIORITY_WORDS[p].test(body)) return p;
  }
  return undefined;
}

/** Extract `owner/repo#N` from a `gh issue create` URL output. */
function issueUrlToRef(url: string): { repo: string; number: string } | null {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) return null;
  return { repo: m[1], number: m[2] };
}

export async function fileIntakeIssue(
  opts: FileIntakeIssueOpts,
  deps: FileIntakeIssueDeps,
): Promise<FileIntakeIssueResult> {
  const warnings: string[] = [];

  // ── Resolve size ──────────────────────────────────────────────────────────
  let size = opts.size;
  let sizeSource: FileIntakeIssueResult['sizeSource'] = 'given';
  if (!size) {
    if (opts.interactive && deps.prompt) {
      const answer = await deps.prompt('What size is this? (S/M/L)');
      const parsed = parseSizeLabel([`size: ${answer.trim()}`]);
      size = parsed ?? 'M';
      sizeSource = 'prompted';
    } else {
      const inferred = inferSize(opts.body);
      if (inferred) {
        size = inferred;
        sizeSource = 'inferred';
      } else {
        size = 'M';
        sizeSource = 'default';
      }
    }
  }

  // ── Resolve priority ─────────────────────────────────────────────────────
  let priority = opts.priority;
  let prioritySource: FileIntakeIssueResult['prioritySource'] = 'given';
  if (!priority) {
    if (opts.interactive && deps.prompt) {
      const answer = await deps.prompt('What priority is this? (critical/high/medium/low)');
      const parsed = parsePriorityLabels([`priority: ${answer.trim()}`]);
      priority = parsed ?? 'medium';
      prioritySource = 'prompted';
    } else {
      const inferred = inferPriority(opts.body);
      if (inferred) {
        priority = inferred;
        prioritySource = 'inferred';
      } else {
        priority = 'medium';
        prioritySource = 'default';
      }
    }
  }

  // ── Sanitize before publication ──────────────────────────────────────────
  // Filing publishes this text to a tracker that may be public and is in any
  // case off the operator's machine, so the scrub runs HERE — at the single
  // choke point every caller passes through — rather than as a rule the filer
  // is asked to remember. Size/priority inference above deliberately reads the
  // ORIGINAL body: a redaction must never change how the issue is labelled.
  const cleanTitle = sanitizeIntakeText(opts.title);
  const cleanBody = sanitizeIntakeText(`${opts.body}${opts.sourceRef ? `\n\nSource-Ref: ${opts.sourceRef}` : ''}`);
  const redactions = [...cleanTitle.redactions, ...cleanBody.redactions];

  // ── Recover or create the issue ──────────────────────────────────────────
  // Source-Ref is a durable idempotency key, not merely issue-body prose. A
  // retry after a successful create but before its local stamp must recover
  // this issue instead of creating a duplicate.
  const issueUrl = opts.sourceRef
    ? await createOrRecoverIssueBySourceRef(deps.tracker, opts.sourceRef,
      { title: cleanTitle.text, body: cleanBody.text, repo: opts.repo }, deps.cwd)
    : await deps.tracker.createIssue({ title: cleanTitle.text, body: cleanBody.text, repo: opts.repo }, deps.cwd);
  const ref = issueUrlToRef(issueUrl);

  const result: FileIntakeIssueResult = {
    ok: true,
    issueUrl,
    size,
    priority,
    sizeSource,
    prioritySource,
    dependsOnDecision: 'none',
    linked: [],
    badRefs: [],
    warnings,
    redactions,
  };

  // ── Apply labels (best-effort; failure is a warning, never a hard fail) ──
  if (ref) {
    try {
      await deps.gh(restAddLabelArgs(ref.repo, ref.number, `priority: ${priority}`), {
        cwd: deps.cwd,
      });
      await deps.gh(restAddLabelArgs(ref.repo, ref.number, `size: ${size}`), { cwd: deps.cwd });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`label-apply failed: ${msg}`);
    }
  } else {
    warnings.push(`could not parse issue URL "${issueUrl}" — labels not applied`);
  }

  // ── Record --depends-on link(s), or explicit "no dependencies" ──────────
  const dependsOn = opts.dependsOn ?? [];
  if (dependsOn.length === 0) {
    result.dependsOnDecision = 'none';
  } else {
    result.dependsOnDecision = 'linked';
    for (const dep of dependsOn) {
      const parsed = parseSourceRef(dep);
      if (!parsed) {
        result.badRefs.push(dep);
        warnings.push(`--depends-on ref "${dep}" is not a valid owner/repo#N reference`);
        continue;
      }
      if (ref) {
        try {
          // The GitHub issue-dependencies API keys on the dependency issue's
          // numeric database id, not its owner/repo#N ref, and the blocked_by
          // link is created with POST (not PUT). Resolve the id, then link.
          const { stdout: depIssueJson } = await deps.gh(
            ['api', `repos/${parsed.repo}/issues/${parsed.number}`],
            { cwd: deps.cwd },
          );
          const depId = (JSON.parse(depIssueJson) as { id: number }).id;
          await deps.gh(
            [
              'api',
              '--method',
              'POST',
              `repos/${ref.repo}/issues/${ref.number}/dependencies/blocked_by`,
              '-F',
              `issue_id=${depId}`,
            ],
            { cwd: deps.cwd },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`depends-on link failed for "${dep}": ${msg}`);
        }
      }
      result.linked.push(dep);
    }
  }

  return result;
}
