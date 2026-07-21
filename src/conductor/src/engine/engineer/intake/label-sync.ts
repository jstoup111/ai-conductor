/**
 * label-sync: the Action-facing seam for "issue-form captures are born with
 * priority + size + linking" (Story 1, FR-1; #695 intake-only-enforcement).
 *
 * `syncIssueLabels` is what `.github/workflows/intake-label-sync.yml` (and any
 * other caller — `bin/intake-file`, `bin/intake-backfill`) drives directly: given
 * the parsed issue-form fields and the issue's ref, it
 *   1. resolves the priority/size value to a closed-vocab label, defaulting to
 *      `priority: medium` / `size: M` on anything unparsable,
 *   2. ensures the label exists (auto-create, mirrors engineer:handled) and
 *      applies it via the REST labels endpoint,
 *   3. links each well-formed `owner/repo#N` Depends-on ref as a `blocked_by`
 *      edge via the GET-before-POST additive writer, surfacing malformed refs
 *      in `badRefs` rather than failing.
 *
 * Composed from the existing gh idioms rather than reinventing REST calls:
 * label auto-create + apply reuse {@link ensureLabel}/{@link addLabel} from
 * `pr-labels.ts`; dependency linking reuses {@link createDependencyLinks} from
 * `issue-dep-migration.ts`. Best-effort / non-throwing throughout — a label
 * or link failure is logged and does not stop the rest of the sync.
 */

import { ensureLabel, addLabel, type GhRunner } from '../../pr-labels.js';
import { createDependencyLinks, type DependencyEdge } from '../issue-dep-migration.js';

export type { GhRunner } from '../../pr-labels.js';

export interface SyncIssueLabelsFields {
  priority?: string;
  size?: string;
  dependsOn?: string[];
}

export interface SyncIssueLabelsDeps {
  gh: GhRunner;
  cwd: string;
  log?: (msg: string) => void;
}

export interface SyncIssueLabelsResult {
  priorityLabel: string;
  sizeLabel: string;
  priorityDefaulted: boolean;
  sizeDefaulted: boolean;
  /** Depends-on refs successfully linked (created or already-present). */
  linked: string[];
  /** Depends-on entries that could not be parsed as `owner/repo#N`. */
  badRefs: string[];
}

const PRIORITY_VALUES = new Set(['critical', 'high', 'medium', 'low']);
const SIZE_VALUES = new Set(['S', 'M', 'L']);

const DEFAULT_PRIORITY = 'medium';
const DEFAULT_SIZE = 'M';

/** Label colors — arbitrary but stable, mirrors the closed-vocab bands. */
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'b60205',
  high: 'd93f0b',
  medium: 'fbca04',
  low: '0e8a16',
};
const SIZE_COLORS: Record<string, string> = {
  S: 'c5def5',
  M: 'bfd4f2',
  L: 'a2c4e0',
};

const SLUG_REF_RE = /^([\w.-]+\/[\w.-]+)#(\d+)$/;

/** Parse `owner/repo#N` into its repo-slug + issue-number parts, or null. */
function parseSlugRef(ref: string): { repo: string; number: string } | null {
  const m = SLUG_REF_RE.exec(ref);
  if (!m) return null;
  return { repo: m[1], number: m[2] };
}

/**
 * Sync an intake issue's priority/size labels and Depends-on links to GitHub.
 * Never throws: every gh call is routed through the non-throwing pr-labels /
 * issue-dep-migration helpers, and any residual error here is caught and
 * logged rather than propagated.
 */
export async function syncIssueLabels(
  fields: SyncIssueLabelsFields,
  issueRef: string,
  deps: SyncIssueLabelsDeps,
): Promise<SyncIssueLabelsResult> {
  const { gh, cwd } = deps;
  const log = deps.log ?? (() => {});

  const priorityDefaulted = !PRIORITY_VALUES.has(fields.priority ?? '');
  const priority = priorityDefaulted ? DEFAULT_PRIORITY : (fields.priority as string);
  const sizeDefaulted = !SIZE_VALUES.has(fields.size ?? '');
  const size = sizeDefaulted ? DEFAULT_SIZE : (fields.size as string);

  const priorityLabel = `priority: ${priority}`;
  const sizeLabel = `size: ${size}`;

  const badRefs: string[] = [];
  const linked: string[] = [];

  const ref = parseSlugRef(issueRef);
  if (!ref) {
    log(`[label-sync] syncIssueLabels: unparseable issue ref "${issueRef}"`);
    return {
      priorityLabel,
      sizeLabel,
      priorityDefaulted,
      sizeDefaulted,
      linked,
      badRefs: [...(fields.dependsOn ?? [])],
    };
  }

  try {
    await ensureLabel(gh, cwd, priorityLabel, PRIORITY_COLORS[priority], log);
    await ensureLabel(gh, cwd, sizeLabel, SIZE_COLORS[size], log);

    const issueUrl = `https://github.com/${ref.repo}/issues/${ref.number}`;
    await addLabel(gh, cwd, issueUrl, priorityLabel, log);
    await addLabel(gh, cwd, issueUrl, sizeLabel, log);
  } catch (err) {
    // ensureLabel/addLabel already swallow their own errors; this is a
    // last-resort guard so a truly unexpected throw still never escapes.
    log(`[label-sync] syncIssueLabels: label sync error: ${err}`);
  }

  const edges: DependencyEdge[] = [];
  for (const dep of fields.dependsOn ?? []) {
    if (SLUG_REF_RE.test(dep)) {
      edges.push({ source: issueRef, target: dep, kind: 'depends-on', blocked_by: true });
    } else {
      badRefs.push(dep);
    }
  }

  if (edges.length > 0) {
    try {
      const results = await createDependencyLinks(edges, { gh, cwd, log });
      for (const result of results) {
        if (result.status === 'created' || result.status === 'already-present') {
          linked.push(result.edge.target);
        } else {
          badRefs.push(result.edge.target);
        }
      }
    } catch (err) {
      log(`[label-sync] syncIssueLabels: dependency link error: ${err}`);
      for (const edge of edges) badRefs.push(edge.target);
    }
  }

  return { priorityLabel, sizeLabel, priorityDefaulted, sizeDefaulted, linked, badRefs };
}
