import { readdir, readFile, access } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { BacklogItem } from './daemon.js';
import { planHasDependencyTree } from './artifacts.js';

/**
 * Discover daemon-eligible features (Phase 6). The daemon consumes existing,
 * human-authored specs — it never authors them — so a feature is eligible only
 * when BOTH its stories and plan artifacts are present.
 *
 * Source of truth is `.docs/plans/*.md`: each plan names its stories file via a
 * `**Stories:** <path>` line (repo convention). The slug is the plan filename
 * stem. A feature already marked processed (via `isProcessed`) is skipped so the
 * daemon doesn't re-run shipped work.
 */
export async function discoverBacklog(
  projectRoot: string,
  isProcessed: (slug: string) => Promise<boolean> = async () => false,
  log: (msg: string) => void = () => {},
): Promise<BacklogItem[]> {
  const plansDir = join(projectRoot, '.docs/plans');
  let planFiles: string[];
  try {
    planFiles = (await readdir(plansDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // no plans dir → nothing to do
  }

  const items: BacklogItem[] = [];
  for (const file of planFiles.sort()) {
    const planPath = join(plansDir, file);
    const slug = basename(file, '.md');

    const storiesPath = await resolveStoriesPath(projectRoot, planPath);
    if (!storiesPath) continue; // no stories → not eligible (daemon doesn't author them)

    if (await isProcessed(slug)) continue;

    // Eligibility = APPROVED + well-formed. The daemon pre-seeds the front half
    // (stories/plan = done) and never re-runs their gates, so this is the only
    // place specs are vetted before autonomous build. Reject unapproved or
    // dependency-tree-less plans rather than silently building them.
    const storiesContent = await readFile(storiesPath, 'utf-8').catch(() => '');
    if (!isStoriesApproved(storiesContent)) {
      log(`skip ${slug}: stories not approved (need "Status: Accepted", no DRAFT)`);
      continue;
    }
    const planContent = await readFile(planPath, 'utf-8').catch(() => '');
    if (!planHasDependencyTree(planContent)) {
      log(
        `skip ${slug}: plan has no dependency tree ("## Task Dependency Graph" or "**Dependencies:**" lines)`,
      );
      continue;
    }

    items.push({ slug, storiesPath, planPath });
  }
  return items;
}

/**
 * Approval signal for autonomous (daemon) work: the stories declare
 * `Status: Accepted` and are not DRAFT. Mirrors the stories gate's Accepted/
 * DRAFT convention (artifacts.ts). When the Phase 9 brain lands, its human
 * approval gate is what sets this marker.
 */
function isStoriesApproved(content: string): boolean {
  if (/\bstatus\b[\s*:]*\bdraft\b/i.test(content)) return false;
  return /\bstatus\b[\s*:]*\baccepted\b/i.test(content);
}

/**
 * Resolve the stories file a plan depends on. Prefers the explicit
 * `**Stories:** <path>` line; falls back to a stories file whose stem matches
 * the plan's. Returns null if no existing stories file is found.
 */
async function resolveStoriesPath(
  projectRoot: string,
  planPath: string,
): Promise<string | null> {
  let content = '';
  try {
    content = await readFile(planPath, 'utf-8');
  } catch {
    return null;
  }

  const m = content.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m) {
    const ref = m[1];
    const abs = isAbsolute(ref) ? ref : resolve(projectRoot, ref);
    if (await fileExists(abs)) return abs;
  }

  // Fallback: a stories file with the same stem as the plan.
  const stem = basename(planPath, '.md');
  const candidate = join(projectRoot, '.docs/stories', `${stem}.md`);
  if (await fileExists(candidate)) return candidate;

  return null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
